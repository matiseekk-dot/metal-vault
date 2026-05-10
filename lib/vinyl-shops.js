// ── Vinyl-shop deep-search registry ─────────────────────────────
//
// For each unowned-streamed album in the Listening tab we render a
// compact row of "where to buy" chips. The user clicks a chip and
// lands on that shop's search results page for the exact (artist,
// album) — letting them comparison-shop in one tap without us needing
// scrape-to-show prices we have no licence for.
//
// API status — checked May 2026:
//   • Discogs        — full public API (price + cover); we use it
//   • eBay           — Browse API (price + image); we use it with
//                      EBAY_CLIENT_ID/SECRET. Falls back to keyword
//                      search URL if creds aren't set.
//   • iMusic         — no public API, internal search URL unstable
//   • Groovespin     — no public API (small WooCommerce shop)
// For shops without an API we use Google site-search, which is
// resilient to shop URL refactors and always lands the user on the
// product page when one exists.
//
// Adding a shop:
//   1. Push a new entry below.
//   2. If the shop has a stable direct search URL, prefer that over
//      Google site-search (one fewer redirect for the user).
//   3. Keep `abbr` to ≤2 characters — the chip is tiny.

export const VINYL_SHOPS = [
  {
    id:      'discogs',
    name:    'Discogs',
    abbr:    'DG',
    bg:      '#333',
    color:   '#fff',
    // Direct Discogs marketplace search (preferred over Google).
    searchUrl: (artist, album) =>
      'https://www.discogs.com/search?type=release&q=' +
      encodeURIComponent((artist || '') + ' ' + (album || '')).trim(),
  },
  {
    id:      'imusic',
    name:    'iMusic',
    abbr:    'iM',
    bg:      '#0066cc',
    color:   '#fff',
    // iMusic's internal search is at /search/<term> but their PL site
    // uses regional redirects that 404 from outside PL. Google
    // site-search dodges all that and works in any locale.
    searchUrl: (artist, album) =>
      'https://www.google.com/search?q=' +
      encodeURIComponent('site:imusic.pl ' + (artist || '') + ' ' + (album || '') + ' vinyl'),
  },
  {
    id:      'groovespin',
    name:    'Groovespin',
    abbr:    'GS',
    bg:      '#dc2626',
    color:   '#fff',
    // Groovespin is WooCommerce — direct ?s= would work, but their
    // search throws off accents (Mayhem ≠ Mayhém). Google site-search
    // handles diacritics correctly.
    searchUrl: (artist, album) =>
      'https://www.google.com/search?q=' +
      encodeURIComponent('site:groovespin.pl ' + (artist || '') + ' ' + (album || '')),
  },
];
