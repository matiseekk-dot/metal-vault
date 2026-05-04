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
