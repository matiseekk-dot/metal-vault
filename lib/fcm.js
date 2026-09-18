// ── FCM HTTP v1 sender (no firebase-admin dependency) ─────────────
//
// Native push for the Capacitor Android app. Web Push (VAPID) can't be
// produced by the Android System WebView, so the app registers an FCM
// token and the server delivers through Firebase Cloud Messaging.
//
// Auth: a Firebase service-account key, supplied as either
//   FIREBASE_SERVICE_ACCOUNT_JSON  — the raw JSON, or
//   FIREBASE_SERVICE_ACCOUNT_B64   — the same JSON base64-encoded
// (base64 exists because multi-line JSON pasted into some env UIs gets
// its "\n" escapes mangled and JSON.parse then fails).
//
// We sign the OAuth JWT with node:crypto and call the two Google
// endpoints directly — firebase-admin is ~10 MB of dependency for what
// is one token exchange and one POST per device.

import crypto from 'crypto';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE     = 'https://www.googleapis.com/auth/firebase.messaging';
export const ANDROID_CHANNEL_ID = 'metalvault_default';

let _sa = undefined;      // undefined = not read yet, null = unavailable
let _access = null;       // { token, expiresAtMs }

function readServiceAccount() {
  if (_sa !== undefined) return _sa;
  _sa = null;
  let raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw && process.env.FIREBASE_SERVICE_ACCOUNT_B64) {
    try { raw = Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_B64, 'base64').toString('utf8'); } catch {}
  }
  if (!raw) return _sa;
  try {
    const sa = JSON.parse(raw);
    if (sa.client_email && sa.private_key && sa.project_id) {
      // Belt and braces: a key that lost its real newlines still signs
      // once the escaped ones are restored.
      sa.private_key = String(sa.private_key).replace(/\\n/g, '\n');
      _sa = sa;
    }
  } catch {}
  return _sa;
}

export function isFcmConfigured() {
  return !!readServiceAccount();
}

const b64url = (buf) =>
  Buffer.from(buf).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

async function getAccessToken() {
  const sa = readServiceAccount();
  if (!sa) throw new Error('FCM not configured');
  if (_access && _access.expiresAtMs - Date.now() > 60_000) return _access.token;

  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(JSON.stringify({
    iss: sa.client_email, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600,
  }));
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(header + '.' + claims);
  const assertion = header + '.' + claims + '.' + b64url(signer.sign(sa.private_key));

  const r = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion,
    }).toString(),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.access_token) {
    throw new Error('FCM auth failed: ' + (d.error_description || d.error || r.status));
  }
  _access = { token: d.access_token, expiresAtMs: Date.now() + (Number(d.expires_in) || 3600) * 1000 };
  return _access.token;
}

// Map our web-push style payload ({title, body, icon, url, tag}) onto an
// FCM v1 message. data values MUST be strings.
function buildMessage(token, payload) {
  const data = {};
  if (payload.url) data.url = String(payload.url);
  if (payload.tag) data.tag = String(payload.tag);

  const notification = { title: String(payload.title || 'Metal Vault'), body: String(payload.body || '') };
  // Only absolute https images (release covers) — the relative
  // /icons/... paths the web payloads carry mean nothing to Android.
  if (typeof payload.icon === 'string' && /^https:\/\//i.test(payload.icon)) {
    notification.image = payload.icon;
  }

  return {
    message: {
      token,
      notification,
      data,
      android: {
        priority: 'HIGH',
        notification: {
          channel_id: ANDROID_CHANNEL_ID,
          ...(payload.tag ? { tag: String(payload.tag) } : {}),
        },
      },
    },
  };
}

/**
 * Send one message. Resolves { ok, invalid }:
 *   ok      — FCM accepted it
 *   invalid — the token is dead (uninstalled / expired); caller should
 *             delete the row
 * Any other failure throws so it lands in the caller's error handling.
 */
export async function sendFcm(token, payload) {
  const sa = readServiceAccount();
  if (!sa) throw new Error('FCM not configured');
  const access = await getAccessToken();

  const r = await fetch(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + access, 'Content-Type': 'application/json' },
    body: JSON.stringify(buildMessage(token, payload)),
  });
  if (r.ok) return { ok: true, invalid: false };

  const d = await r.json().catch(() => ({}));
  const status = d?.error?.status;
  const code = (d?.error?.details || []).map(x => x?.errorCode).find(Boolean);
  const msg = String(d?.error?.message || '');
  const dead = code === 'UNREGISTERED' || status === 'NOT_FOUND'
    || (status === 'INVALID_ARGUMENT' && /registration token/i.test(msg));
  if (dead) return { ok: false, invalid: true };
  throw new Error('FCM send failed: ' + (status || r.status) + ' ' + msg);
}
