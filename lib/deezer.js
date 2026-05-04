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

// ── Find artist image by name ─────────────────────────────────
// Returns { image, thumb, deezerId, deezerUrl } or null. Picks the
// top search hit. Deezer's match quality on rock / metal is very good
// because they index a wider catalog than Spotify cares about.
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
    if (!picture) return null;

    return {
      image:      picture,
      thumb:      top.picture_medium || top.picture,
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
