// ── Metal Vault — OAuth 1.0a HMAC-SHA1 helper ───────────────────
// Replaces PLAINTEXT signatures with HMAC-SHA1 for all Discogs
// OAuth flows (request_token, access_token, identity, API calls).
//
// Why HMAC-SHA1 over PLAINTEXT?
//   PLAINTEXT sends consumerSecret verbatim in the Authorization header.
//   Even over HTTPS this leaks the secret into server logs, CDN edge
//   logs, and any proxy that inspects headers. HMAC-SHA1 signs a
//   request-specific base string — the secret is never transmitted.

import { createHmac } from 'crypto';

// RFC 3986 percent-encoding (stricter than encodeURIComponent)
function pct(str) {
  return encodeURIComponent(String(str ?? ''))
    .replace(/!/g,  '%21')
    .replace(/'/g,  '%27')
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29')
    .replace(/\*/g, '%2A');
}

// Parse a URL into { baseUrl, queryParams }
function parseUrl(rawUrl) {
  const u    = new URL(rawUrl);
  const base = u.origin + u.pathname;
  const qp   = {};
  u.searchParams.forEach((v, k) => { qp[k] = v; });
  return { base, qp };
}

// Build OAuth signature base string
function baseString(method, baseUrl, allParams) {
  const sorted = Object.entries(allParams)
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([k, v]) => pct(k) + '=' + pct(v))
    .join('&');
  return method.toUpperCase() + '&' + pct(baseUrl) + '&' + pct(sorted);
}

// HMAC-SHA1 and base64-encode
function hmac(signingKey, data) {
  return createHmac('sha1', signingKey).update(data).digest('base64');
}

/**
 * Build a complete `Authorization: OAuth …` header value using HMAC-SHA1.
 *
 * @param {string} method          HTTP verb (GET / POST)
 * @param {string} rawUrl          Full request URL (may include query string)
 * @param {object} extraOAuth      Extra OAuth params (e.g. oauth_callback, oauth_verifier)
 * @param {string} consumerKey
 * @param {string} consumerSecret
 * @param {string} [tokenKey]      Access / request token (empty for request_token step)
 * @param {string} [tokenSecret]   Access / request token secret (empty for request_token step)
 * @returns {string}               Value for the Authorization header
 */
export function buildOAuthHeader(
  method,
  rawUrl,
  extraOAuth = {},
  consumerKey,
  consumerSecret,
  tokenKey    = '',
  tokenSecret = '',
) {
  const { base, qp } = parseUrl(rawUrl);

  const nonce = Math.random().toString(36).slice(2) + Date.now().toString(36);

  const oauthParams = {
    oauth_consumer_key:     consumerKey,
    oauth_nonce:            nonce,
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp:        String(Math.floor(Date.now() / 1000)),
    oauth_version:          '1.0',
    ...extraOAuth,
  };
  if (tokenKey) oauthParams.oauth_token = tokenKey;

  // Combine all params for signing (OAuth + query string)
  const allParams = { ...qp, ...oauthParams };

  // Sign
  const signingKey = pct(consumerSecret) + '&' + pct(tokenSecret);
  const sig        = hmac(signingKey, baseString(method, base, allParams));
  oauthParams.oauth_signature = sig;

  // Build header value — only OAuth params, pct-encoded
  const header = 'OAuth ' + Object.entries(oauthParams)
    .map(([k, v]) => pct(k) + '="' + pct(v) + '"')
    .join(',');

  return header;
}

/**
 * Convenience: build full `{ Authorization, 'User-Agent' }` headers
 * for a Discogs API data call (collection / wantlist / identity).
 *
 * Returns null if credentials are missing.
 */
export function discogsApiHeaders(rawUrl, method, oauthTokenObj) {
  const UA = { 'User-Agent': 'MetalVault/1.0 +https://metal-vault-six.vercel.app' };

  const key    = process.env.DISCOGS_KEY;
  const secret = process.env.DISCOGS_SECRET;
  const token  = process.env.DISCOGS_TOKEN;

  // OAuth 1.0a HMAC-SHA1 (preferred — per-user access)
  if (oauthTokenObj?.access_token && oauthTokenObj?.access_secret && key && secret) {
    return {
      ...UA,
      Authorization: buildOAuthHeader(
        method, rawUrl, {}, key, secret,
        oauthTokenObj.access_token,
        oauthTokenObj.access_secret,
      ),
    };
  }

  // Personal token fallback (owner's collection only)
  if (token) return { ...UA, Authorization: 'Discogs token=' + token };

  return null;
}
