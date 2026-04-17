// ── Metal Vault — OAuth 1.0a PLAINTEXT helper ───────────────────
// Discogs officially supports PLAINTEXT signatures over HTTPS.
// This is the standard documented approach:
//   https://www.discogs.com/developers#page:authentication
//
// PLAINTEXT signature format:
//   oauth_signature = consumerSecret & tokenSecret
// The secret is sent inside a TLS-encrypted header — same security
// profile as any API key sent over HTTPS.

const UA = { 'User-Agent': 'MetalVault/1.0 +https://metal-vault-six.vercel.app' };

function nonce() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function ts() {
  return Math.floor(Date.now() / 1000);
}

/**
 * Build the Authorization header for Step 1 (request_token).
 * Signature = consumerSecret + '&' (empty token secret).
 */
export function requestTokenHeader(consumerKey, consumerSecret, callbackUrl) {
  return (
    'OAuth ' +
    'oauth_consumer_key="' + consumerKey + '",' +
    'oauth_nonce="' + nonce() + '",' +
    'oauth_timestamp="' + ts() + '",' +
    'oauth_callback="' + encodeURIComponent(callbackUrl) + '",' +
    'oauth_signature_method="PLAINTEXT",' +
    'oauth_version="1.0",' +
    'oauth_signature="' + consumerSecret + '%26"'
  );
}

/**
 * Build the Authorization header for Step 2 (access_token exchange).
 * Uses the request token + its secret retrieved from Step 1.
 */
export function accessTokenHeader(consumerKey, consumerSecret, requestToken, requestTokenSecret, verifier) {
  return (
    'OAuth ' +
    'oauth_consumer_key="' + consumerKey + '",' +
    'oauth_nonce="' + nonce() + '",' +
    'oauth_timestamp="' + ts() + '",' +
    'oauth_token="' + requestToken + '",' +
    'oauth_verifier="' + verifier + '",' +
    'oauth_signature_method="PLAINTEXT",' +
    'oauth_version="1.0",' +
    'oauth_signature="' + consumerSecret + '%26' + requestTokenSecret + '"'
  );
}

/**
 * Build the Authorization header for user-authenticated API calls
 * (identity, collection, wantlist, etc).
 */
export function apiCallHeader(consumerKey, consumerSecret, accessToken, accessSecret) {
  return (
    'OAuth ' +
    'oauth_consumer_key="' + consumerKey + '",' +
    'oauth_token="' + accessToken + '",' +
    'oauth_signature_method="PLAINTEXT",' +
    'oauth_signature="' + consumerSecret + '%26' + accessSecret + '",' +
    'oauth_version="1.0",' +
    'oauth_timestamp="' + ts() + '",' +
    'oauth_nonce="' + nonce() + '"'
  );
}

/**
 * Convenience: full `{ Authorization, User-Agent }` headers for Discogs API.
 * Prefers user's OAuth access token; falls back to the app's personal token.
 * Returns null if nothing is configured.
 *
 * @param {{access_token:string, access_secret:string}} [oauthTokenObj]
 */
export function discogsApiHeaders(oauthTokenObj) {
  const key    = process.env.DISCOGS_KEY;
  const secret = process.env.DISCOGS_SECRET;
  const token  = process.env.DISCOGS_TOKEN;

  if (oauthTokenObj?.access_token && oauthTokenObj?.access_secret && key && secret) {
    return { ...UA, Authorization: apiCallHeader(key, secret, oauthTokenObj.access_token, oauthTokenObj.access_secret) };
  }
  if (token) return { ...UA, Authorization: 'Discogs token=' + token };
  return null;
}
