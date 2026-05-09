// ── Spotify Web API client (server-side) ─────────────────────
// Used for artist images. Spotify is the only major service that still
// hosts artist photos through a public API (Last.fm dropped them in 2019,
// MusicBrainz never had them).
//
// Auth: client_credentials flow — no user OAuth needed for read-only
// artist/album lookups. Token cached per Node instance (~1h TTL). On a
// cold start we burn one token request; subsequent calls reuse it.
//
// Rate limit: Spotify's published limits are vague. In practice 30-50
// req/sec is fine for client_credentials. We don't throttle here —
// callers limit at higher level.
//
// Caveat: Spotify deprecated /related-artists for new apps in Nov 2024.
// /search and /artists/{id} still work and that's what we need for images.

let _token  = null;
let _expiry = 0;

async function getToken() {
  if (_token && Date.now() < _expiry) return _token;
  const id     = process.env.SPOTIFY_CLIENT_ID;
  const secret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!id || !secret) return null;
  try {
    const r = await fetch('https://accounts.spotify.com/api/token', {
      method:  'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization:  'Basic ' + Buffer.from(id + ':' + secret).toString('base64'),
      },
      body: 'grant_type=client_credentials',
    });
    if (!r.ok) return null;
    const d = await r.json();
    _token  = d.access_token;
    _expiry = Date.now() + (d.expires_in - 60) * 1000;
    return _token;
  } catch {
    return null;
  }
}

// ── Find an artist's profile image ────────────────────────────
// Returns null silently if Spotify is unconfigured or no match found.
// We pick the largest image (Spotify returns images sorted largest-first
// in `.images[]`). For thumb usage callers can downscale via CSS.
export async function findArtistImage(name) {
  if (!name?.trim()) return null;
  const token = await getToken();
  if (!token) return null;
  try {
    const url = 'https://api.spotify.com/v1/search?type=artist&limit=1&q=' + encodeURIComponent(name);
    const r = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
    if (!r.ok) return null;
    const d = await r.json();
    const a = d.artists?.items?.[0];
    if (!a) return null;
    return {
      image:      a.images?.[0]?.url || null,
      thumb:      a.images?.find(i => i.height && i.height <= 320)?.url || a.images?.[0]?.url || null,
      genres:     a.genres || [],
      popularity: a.popularity || null,
      spotifyId:  a.id,
      spotifyUrl: a.external_urls?.spotify || null,
    };
  } catch {
    return null;
  }
}

// ── Batch lookup (parallel) ───────────────────────────────────
// For lists of artists in MemberCard / ArtistModal sections. Spotify
// has no batch endpoint for search-by-name, so we fan out — capped at
// `max` to avoid hammering on a long list.
export async function findArtistImages(names, max = 8) {
  if (!Array.isArray(names) || names.length === 0) return {};
  const slice = names.slice(0, max);
  const results = await Promise.all(slice.map(n => findArtistImage(n).then(d => [n, d])));
  return Object.fromEntries(results.filter(([, d]) => d?.image));
}

export function isSpotifyConfigured() {
  return !!(process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET);
}

// ── User OAuth — Authorization Code flow ───────────────────────
// Used by /api/spotify/oauth (build authorize URL) and
// /api/spotify/callback (exchange code → refresh_token).
// Scope deliberately minimal: `user-read-recently-played` only.
// We don't read playlists, library, or playback state.

export const SPOTIFY_USER_SCOPE = 'user-read-recently-played';

export function spotifyAuthorizeUrl({ redirectUri, state }) {
  const id = process.env.SPOTIFY_CLIENT_ID;
  if (!id) return null;
  const params = new URLSearchParams({
    client_id:     id,
    response_type: 'code',
    redirect_uri:  redirectUri,
    scope:         SPOTIFY_USER_SCOPE,
    state,
  });
  return 'https://accounts.spotify.com/authorize?' + params.toString();
}

export async function spotifyExchangeCode({ code, redirectUri }) {
  const id     = process.env.SPOTIFY_CLIENT_ID;
  const secret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!id || !secret) throw new Error('Spotify not configured');
  const r = await fetch('https://accounts.spotify.com/api/token', {
    method:  'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization:  'Basic ' + Buffer.from(id + ':' + secret).toString('base64'),
    },
    body: new URLSearchParams({
      grant_type:   'authorization_code',
      code,
      redirect_uri: redirectUri,
    }).toString(),
  });
  if (!r.ok) throw new Error('Spotify token exchange ' + r.status);
  return r.json();   // { access_token, refresh_token, scope, expires_in, token_type }
}

export async function spotifyRefreshAccessToken(refreshToken) {
  const id     = process.env.SPOTIFY_CLIENT_ID;
  const secret = process.env.SPOTIFY_CLIENT_SECRET;
  const r = await fetch('https://accounts.spotify.com/api/token', {
    method:  'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization:  'Basic ' + Buffer.from(id + ':' + secret).toString('base64'),
    },
    body: new URLSearchParams({
      grant_type:    'refresh_token',
      refresh_token: refreshToken,
    }).toString(),
  });
  if (!r.ok) throw new Error('Spotify refresh ' + r.status);
  return r.json();   // { access_token, expires_in, scope, token_type, refresh_token? }
}

// Fetch up to 50 most recently played tracks. `afterMs` is a unix
// timestamp in ms; Spotify only returns plays *after* this point.
export async function spotifyRecentlyPlayed({ accessToken, afterMs, limit = 50 }) {
  const params = new URLSearchParams({ limit: String(Math.min(limit, 50)) });
  if (afterMs) params.set('after', String(afterMs));
  const r = await fetch('https://api.spotify.com/v1/me/player/recently-played?' + params.toString(), {
    headers: { Authorization: 'Bearer ' + accessToken },
  });
  if (!r.ok) throw new Error('Spotify recently-played ' + r.status);
  return r.json();   // { items: [{ track: { name, artists, album }, played_at }, ...] }
}

export async function spotifyGetMe(accessToken) {
  const r = await fetch('https://api.spotify.com/v1/me', {
    headers: { Authorization: 'Bearer ' + accessToken },
  });
  if (!r.ok) throw new Error('Spotify /me ' + r.status);
  return r.json();
}
