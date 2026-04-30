// ── Rarity score helper — based on Discogs num_for_sale ──
// Single source of truth for rarity classification across the app.
// Used by collection cards (badge), stats (filter), insurance PDF.
//
// num_for_sale is fetched from Discogs API for each release.
// Smaller number = rarer record on the global market.

export const RARITY_LEVELS = {
  ULTRA_RARE: { score: 5, label: 'Ultra Rare', color: '#f5c842',
                threshold: 2,    description: '≤2 copies for sale globally' },
  RARE:       { score: 4, label: 'Rare',       color: '#dc2626',
                threshold: 9,    description: '3-9 copies' },
  UNCOMMON:   { score: 3, label: 'Uncommon',   color: '#a855f7',
                threshold: 29,   description: '10-29 copies' },
  COMMON:     { score: 2, label: 'Common',     color: '#629aa9',
                threshold: 99,   description: '30-99 copies' },
  AVAILABLE:  { score: 1, label: 'Available',  color: '#888',
                threshold: Infinity, description: '100+ copies' },
};

export function rarityFromCount(numForSale) {
  if (numForSale == null) return null;
  const n = Number(numForSale);
  if (isNaN(n) || n < 0) return null;
  if (n <= RARITY_LEVELS.ULTRA_RARE.threshold) return RARITY_LEVELS.ULTRA_RARE;
  if (n <= RARITY_LEVELS.RARE.threshold)       return RARITY_LEVELS.RARE;
  if (n <= RARITY_LEVELS.UNCOMMON.threshold)   return RARITY_LEVELS.UNCOMMON;
  if (n <= RARITY_LEVELS.COMMON.threshold)     return RARITY_LEVELS.COMMON;
  return RARITY_LEVELS.AVAILABLE;
}
