// ── Wikipedia artist image lookup ─────────────────────────────
// Final fallback in the artist-image chain. Wikipedia covers the
// long tail of niche / underground metal bands that Spotify and
// Deezer don't bother indexing photos for.
//
// Endpoint: action=query&prop=pageimages — free, no auth, no rate
// limit (anonymous fair-use ~200 req/sec).
//
// Tries the active locale's Wikipedia first (de.wikipedia.org for DE,
// pl.wikipedia.org for PL) so Polish bands get Polish-language
// articles where likely to be more accurate. Falls back to en for
// universal coverage.

const WIKI_LANGS = ['en'];   // searched in order; en is the catch-all

export async function findArtistImage(name, locale = 'en') {
  if (!name?.trim()) return null;
  const langs = locale && locale !== 'en'
    ? [locale, ...WIKI_LANGS]
    : WIKI_LANGS;

  for (const lang of langs) {
    try {
      const url = `https://${lang}.wikipedia.org/w/api.php?action=query`
        + `&prop=pageimages|pageterms`
        + `&format=json&pithumbsize=600&piprop=original|thumbnail`
        + `&redirects=1&origin=*`
        + `&titles=${encodeURIComponent(name)}`;
      const r = await fetch(url, {
        headers: { 'Accept': 'application/json' },
      });
      if (!r.ok) continue;
      const d = await r.json();
      const pages = d.query?.pages || {};
      const page  = Object.values(pages)[0];
      if (!page || page.missing !== undefined) continue;

      // pageimages returns { original: { source, width, height }, thumbnail: { source, width } }
      const original  = page.original?.source;
      const thumbnail = page.thumbnail?.source;
      if (!original && !thumbnail) continue;

      return {
        image: original || thumbnail,
        thumb: thumbnail || original,
        wikipediaUrl: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(page.title || name)}`,
        popularity:   null,
      };
    } catch {
      // try next language
    }
  }
  return null;
}

export function isWikipediaConfigured() {
  return true;   // no key needed
}
