// ── Portfolio value — single source of truth ────────────────────
// Centralised so /api/collection summary, /api/portfolio summary,
// /api/portfolio/change history, and updateSnapshot all agree on
// how to value a row. Three rules:
//
//   1. Use the market price (median_price preferred, current_price
//      as fallback) ONLY when at least 3 active Discogs listings
//      back it up. Below 3 listings the median is dominated by
//      whatever one seller decided to ask, and we've seen €999
//      single-offer outliers turn into "your portfolio value" —
//      misleading and demoralising.
//   2. Gifts have no purchase cost basis, so if they don't have a
//      trustworthy market price we count them as 0 (rather than
//      faking a cost the user never paid).
//   3. Everything else falls back to purchase_price. That's the
//      user's real cost basis — a safer floor than an outlier
//      single-listing market price.

export const MIN_LISTINGS_FOR_TRUST = 3;

export function marketValueOf(item) {
  if (!item) return 0;
  const offers = Number(item.num_for_sale) || 0;
  const market = Number(item.median_price || item.current_price) || 0;
  if (market > 0 && offers >= MIN_LISTINGS_FOR_TRUST) return market;
  if (item.is_gift) return 0;
  return Number(item.purchase_price) || 0;
}

// Row counted as "low confidence" — has a market price but it's
// based on too few listings to trust. Surfaced in summary so the
// UI can hint 'X records have unreliable valuations'.
export function isLowConfidence(item) {
  if (!item) return false;
  const offers   = Number(item.num_for_sale) || 0;
  const hasMarket = (Number(item.median_price || item.current_price) || 0) > 0;
  return hasMarket && offers < MIN_LISTINGS_FOR_TRUST;
}

// Convenience reducer for arrays.
export function sumMarketValue(items) {
  return (items || []).reduce((s, i) => s + marketValueOf(i), 0);
}
