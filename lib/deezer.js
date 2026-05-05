// ── Deezer API client ─────────────────────────────────────────
// Free, no auth, public read-only. Used as a fallback for artist
// images when Spotify returns 403 — Spotify changed their policy in
// late 2024 to require Premium subscription on the app owner's account
// even for client_credentials flow.
//
// Deezer doesn't have that nonsense: anonymous GET on api.deezer.com
// just works. Terms of service allow commercial display of artist
// metadata + pictures as long as we attribute when prominent.
//
// Docs: https://developers.deezer.com/api
//
// Rate limit: 50 req / 5s per IP per Deezer's published limits. We
// don't throttle here — UI calls are sparse.

const DZ_BASE = 'https://api.deezer.com';

// ── Detect Deezer's "no photo" placeholder ───────────────────
// When an artist has no real photo, Deezer returns its generic dark
// silhouette / pebble image. The URL has a tell-tale empty hash
// segment between /artist/ and the size suffix:
//   https://e-cdns-images.dzcdn.net/images/artist//1000x1000-...jpg
//                                          ^^ empty
// We treat these as null so the UI falls back to a letter circle
// instead of confusing every band-without-a-photo with a generic
// "metal silhouette in a desert" backdrop.
function isPlaceholderUrl(url) {
  if (!url) return true;
  if (url.includes('/artist//'))               return true;          // empty hash
  if (/\/d41d8cd98f00b204e9800998ecf8427e\//.test(url)) return true;  // md5 of empty string
  return false;
}

// ── Find artist image by name ─────────────────────────────────
// Returns { image, thumb, deezerId, deezerUrl } or null. Picks the
// top search hit AND requires the photo to be a real one (not Deezer's
// silhouette placeholder). When Deezer has the artist but no photo we
// still surface deezerId/deezerUrl in case the caller wants the link.
export async function findArtistImage(name) {
  if (!name?.trim()) return null;
  try {
    const url = `${DZ_BASE}/search/artist?q=${encodeURIComponent(name)}&limit=3&order=RANKING`;
    const r = await fetch(url, { headers: { 'Accept': 'application/json' } });
    if (!r.ok) return null;
    const d = await r.json();
    const items = d.data || [];
    if (items.length === 0) return null;

    // Prefer an exact case-insensitive name match if present (Deezer
    // sometimes returns the right artist as #2 when an unrelated band
    // shares a similar name).
    const exact   = items.find(a => a.name?.toLowerCase() === name.toLowerCase());
    const top     = exact || items[0];
    const picture = top.picture_xl || top.picture_big || top.picture_medium || top.picture;

    // Filter out the placeholder. Returning null here lets the caller
    // chain onto the next provider (or the letter fallback in UI).
    if (!picture || isPlaceholderUrl(picture)) return null;

    return {
      image:      picture,
      thumb:      top.picture_medium && !isPlaceholderUrl(top.picture_medium)
                    ? top.picture_medium : picture,
      deezerId:   top.id,
      deezerUrl:  top.link,
      // Deezer doesn't expose popularity directly via /search — would
      // need a follow-up /artist/{id} call; not worth the round-trip
      // when Spotify already provides this for non-403 cases.
      popularity: null,
    };
  } catch {
    return null;
  }
}

// ── Batch helper ──────────────────────────────────────────────
// Parallelized; capped at `max` to keep the burst under Deezer's 50/5s.
export async function findArtistImages(names, max = 8) {
  if (!Array.isArray(names) || names.length === 0) return {};
  const slice = names.slice(0, max);
  const results = await Promise.all(slice.map(n => findArtistImage(n).then(d => [n, d])));
  return Object.fromEntries(results.filter(([, d]) => d?.image));
}

// Deezer needs no key — always "configured".
export function isDeezerConfigured() {
  return true;
}
