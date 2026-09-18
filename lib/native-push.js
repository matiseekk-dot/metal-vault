'use client';
// ── Native push (FCM) client for the Capacitor Android app ────────
//
// The Android System WebView can't do Web Push, so the wrapper
// registers an FCM token via @capacitor/push-notifications and the
// server delivers through Firebase (lib/fcm.js → notifyUser).
//
// IMPORTANT — the web bundle is served remotely from Vercel, so it
// reaches installs of EVERY app version, including ones built before
// the native plugin existed. Everything here therefore starts from
// isNativePushAvailable() (plugin actually present in the native
// binary) and degrades to "not available" instead of throwing.

const CHANNEL_ID = 'metalvault_default';   // must match lib/fcm.js
const LS_TOKEN   = 'mv_fcm_token';

let listenersReady = false;
let pending  = null;  // resolver for the in-flight register() call
let inflight = null;  // de-dupes concurrent enableNativePush() calls

function isNative() {
  return typeof window !== 'undefined'
    && !!window.Capacitor?.isNativePlatform?.();
}

export function isNativePushAvailable() {
  return isNative() && !!window.Capacitor?.isPluginAvailable?.('PushNotifications');
}

export function getStoredToken() {
  try { return localStorage.getItem(LS_TOKEN) || ''; } catch { return ''; }
}

async function loadPlugin() {
  const { PushNotifications } = await import('@capacitor/push-notifications');
  return PushNotifications;
}

async function appVersion() {
  try {
    const { App } = await import('@capacitor/app');
    const info = await App.getInfo();
    return info?.version || null;
  } catch { return null; }
}

async function postToken(token) {
  try {
    const r = await fetch('/api/push/device', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ token, appVersion: await appVersion() }),
    });
    return r.ok;
  } catch { return false; }
}

// Only same-origin relative paths — a push payload must never be able
// to send the WebView to an arbitrary site.
function safeNavigate(url) {
  if (typeof url !== 'string' || !url.startsWith('/') || url.startsWith('//')) return;
  try { window.location.href = url; } catch {}
}

async function ensureListeners(PN) {
  if (listenersReady) return;
  listenersReady = true;

  // Fires on register() AND whenever FCM later rotates the token, so
  // the server row stays current without any user action.
  await PN.addListener('registration', async ({ value }) => {
    try { localStorage.setItem(LS_TOKEN, value); } catch {}
    const ok = await postToken(value);
    if (pending) { pending(ok); pending = null; }
  });

  await PN.addListener('registrationError', (err) => {
    console.warn('[native-push] registration error:', err?.error || err);
    if (pending) { pending(false); pending = null; }
  });

  // App is in the foreground — Android doesn't draw a system
  // notification for FCM "notification" messages then, so surface it in-app.
  await PN.addListener('pushNotificationReceived', async (n) => {
    try {
      const { toast } = await import('@/app/components/Toast');
      toast((n.title ? n.title + ' — ' : '') + (n.body || ''));
    } catch {}
  });

  // User tapped a notification (cold start or from the shade).
  await PN.addListener('pushNotificationActionPerformed', (a) => {
    safeNavigate(a?.notification?.data?.url);
  });
}

async function ensureChannel(PN) {
  try {
    await PN.createChannel({
      id:          CHANNEL_ID,
      name:        'Metal Vault',
      description: 'Premiery, alerty cenowe i koncerty',
      importance:  4,      // high — shows as heads-up
      visibility:  1,
      vibration:   true,
    });
  } catch {}
}

function registerAndWait(PN) {
  return new Promise(async (resolve) => {
    const timer = setTimeout(() => { if (pending) { pending(false); pending = null; } }, 15000);
    pending = (ok) => { clearTimeout(timer); resolve(ok); };
    try { await PN.register(); }
    catch (e) {
      // e.g. google-services.json missing from the build → Firebase
      // isn't initialised and register() rejects.
      console.warn('[native-push] register() failed:', e?.message || e);
      if (pending) { pending(false); pending = null; }
    }
  });
}

/**
 * Register this install for server push.
 *   prompt=true  — may show the system permission dialog (user tapped
 *                  the toggle). prompt=false — silent: only proceeds if
 *                  permission is already granted (app start, onboarding).
 * Returns { ok, reason? } — reason ∈ unavailable | denied | not-granted | failed
 */
export function enableNativePush(opts) {
  // App-start init and the Profile toggle can race; two register()
  // calls would fight over the single pending resolver.
  if (inflight) return inflight;
  inflight = doEnable(opts || {}).finally(() => { inflight = null; });
  return inflight;
}

async function doEnable({ prompt = true }) {
  if (!isNativePushAvailable()) return { ok: false, reason: 'unavailable' };
  try {
    const PN = await loadPlugin();
    await ensureListeners(PN);

    let perm = await PN.checkPermissions();
    if (perm.receive !== 'granted') {
      if (!prompt) return { ok: false, reason: 'not-granted' };
      perm = await PN.requestPermissions();
      if (perm.receive !== 'granted') return { ok: false, reason: 'denied' };
    }

    await ensureChannel(PN);
    const ok = await registerAndWait(PN);
    return ok ? { ok: true } : { ok: false, reason: 'failed' };
  } catch (e) {
    console.warn('[native-push] enable failed:', e?.message || e);
    return { ok: false, reason: 'failed' };
  }
}

/** Remove this install's token server-side and revoke it in Firebase. */
export async function disableNativePush() {
  if (!isNativePushAvailable()) return;
  const token = getStoredToken();
  if (token) {
    try {
      await fetch('/api/push/device', {
        method:  'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ token }),
      });
    } catch {}
  }
  try {
    const PN = await loadPlugin();
    await PN.unregister();
  } catch {}
  try { localStorage.removeItem(LS_TOKEN); } catch {}
}

/**
 * App-start hook for a signed-in user. Refreshes the token silently if
 * they already opted in (tokens rotate; a different account may have
 * signed in on this phone) and makes sure tap-to-open routing is armed.
 */
export async function initNativePush() {
  if (!isNativePushAvailable()) return;
  let optedIn = false;
  try { optedIn = localStorage.getItem('mv_local_notif_enabled') === 'true'; } catch {}
  if (!optedIn) return;
  await enableNativePush({ prompt: false });
}
