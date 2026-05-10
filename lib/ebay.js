// ── eBay Browse API client ────────────────────────────────────
//
// We use the Browse API (newer, REST-style) over the older Finding API.
// Only public reads, application-context OAuth2 — no per-user auth
// dance, the same token works for everyone.
//
// Setup:
//   1. Sign up at https://developer.ebay.com/ (free, immediate)
//   2. Create an Application Keyset → take "App ID" + "Cert ID"
//   3. Set EBAY_CLIENT_ID + EBAY_CLIENT_SECRET in env
//   4. Production tier gives 5000 calls/day, plenty for our cache hit
//      ratio (resolved albums hit the discogs_cache, not eBay).
//
// Without credentials this module returns null from every export so
// callers (the album-lookup route) silently degrade — no crash, the
// UI just doesn't show eBay prices.

const EBAY_API = 'https://api.ebay.com';

// Token is per-process. Browse API tokens last 2h; we refresh 1 minute
// before expiry to avoid mid-flight 401s.
let cachedToken     = null;
let tokenExpiresAt  = 0;

async function getEbayAppToken() {
  const id     = process.env.EBAY_CLIENT_ID;
  const secret = process.env.EBAY_CLIENT_SECRET;
  if (!id || !secret) return null;

  if (cachedToken && Date.now() < tokenExpiresAt - 60_000) return cachedToken;

  const basic = Buffer.from(id + ':' + secret).toString('base64');
  let r;
  try {
    r = await fetch(EBAY_API + '/identity/v1/oauth2/token', {
      method:  'POST',
      headers: {
        Authorization:  'Basic ' + basic,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials&scope=' +
            encodeURIComponent('https://api.ebay.com/oauth/api_scope'),
    });
  } catch { return null; }
  if (!r.ok) return null;

  let d;
  try { d = await r.json(); } catch { return null; }
  if (!d?.access_token) return null;

  cachedToken    = d.access_token;
  tokenExpiresAt = Date.now() + (Number(d.expires_in) || 7200) * 1000;
  return cachedToken;
}

// Search vinyl listings for one (artist, album) pair on eBay.
//
// Result shape mirrors the Discogs lookup so the frontend can treat
// them interchangeably:
//   { lowestPrice, currency, itemUrl, image, condition, sellerCountry }
// Returns null if eBay isn't configured, the search 4xx-ed, or there
// were no priced results.
//
// Marketplace defaults to EBAY_US — gives the broadest inventory and
// USD prices. Future improvement: pass a marketplace_id arg so EU
// users see EBAY_DE (EUR) or EBAY_GB (GBP) automatically.
export async function ebaySearchVinyl(artist, album, { marketplace = 'EBAY_US' } = {}) {
  const token = await getEbayAppToken();
  if (!token) return null;

  const q = ((artist || '') + ' ' + (album || '') + ' vinyl').trim();
  if (!q) return null;

  // category_ids=176985 = "Records" leaf on US tree (LP/vinyl).
  // Filtering by category eliminates CDs / digital that match the
  // keyword but aren't vinyl. Sort by price ascending so we see the
  // cheapest copy first — matches what the user actually wants to know.
  const url = EBAY_API + '/buy/browse/v1/item_summary/search'
    + '?q='            + encodeURIComponent(q)
    + '&category_ids=' + '176985'
    + '&filter='       + encodeURIComponent('buyingOptions:{FIXED_PRICE|AUCTION}')
    + '&sort='         + 'price'
    + '&limit='        + '10';

  let r;
  try {
    r = await fetch(url, {
      headers: {
        Authorization:              'Bearer ' + token,
        'X-EBAY-C-MARKETPLACE-ID':  marketplace,
      },
    });
  } catch { return null; }
  if (!r.ok) return null;

  let d;
  try { d = await r.json(); } catch { return null; }
  const items = Array.isArray(d?.itemSummaries) ? d.itemSummaries : [];

  // Filter to listings with a real price > 0. Sort by price ascending
  // to make sure we surface the cheapest (eBay's own sort sometimes
  // ranks "best match" first which can be a $300 collector item even
  // for a common pressing).
  const priced = items
    .map(it => ({
      raw:   it,
      price: parseFloat(it?.price?.value || 0),
    }))
    .filter(it => it.price > 0)
    .sort((a, b) => a.price - b.price);

  if (priced.length === 0) return null;
  const top = priced[0].raw;

  return {
    lowestPrice:    Number(top.price?.value),
    currency:       top.price?.currency || 'USD',
    itemUrl:        top.itemWebUrl || null,
    image:          top.image?.imageUrl || top.thumbnailImages?.[0]?.imageUrl || null,
    condition:      top.condition || null,
    sellerCountry:  top.itemLocation?.country || null,
    title:          top.title || null,
  };
}

export function isEbayConfigured() {
  return !!(process.env.EBAY_CLIENT_ID && process.env.EBAY_CLIENT_SECRET);
}
