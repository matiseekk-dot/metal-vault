// ── Genre normalization ────────────────────────────────────────
// Discogs splits music into `genres` (broad: Rock, Pop, Electronic) and
// `styles` (specific: Death Metal, Black Metal, Doom). For metal collectors,
// `styles` are the identity — `genres` are misleading parent buckets.
//
// These helpers always PREFER styles, and when showing genres they filter
// out generic parents when a matching specific style exists.

// Broad "parent" genres that we should demote when a specific style is present
const GENERIC_PARENTS = new Set([
  'Rock', 'Pop', 'Folk, World, & Country', 'Folk', 'Electronic',
  'Funk / Soul', 'Jazz', 'Blues', 'Classical', 'Reggae', 'Latin',
  'Stage & Screen', 'Non-Music', 'Children\'s', 'Brass & Military',
]);

// Genres that ARE the specific style (keep them)
const METAL_KEYWORDS = /metal|doom|sludge|grind|thrash|death|black|hardcore|crust|grindcore|stoner|hard rock|heavy|core$|speed|power|prog/i;

/**
 * Return the "real" specific genre of an item — prefers styles over generic genres.
 * Used anywhere we display a single dominant genre (cards, persona, breakdown).
 */
export function realGenre(item) {
  const styles = Array.isArray(item?.styles) ? item.styles.filter(Boolean) : [];
  const genres = Array.isArray(item?.genres) ? item.genres.filter(Boolean) : [];

  // 1) Styles always win if present (most specific)
  if (styles.length > 0) return styles[0];

  // 2) Non-generic genre next (e.g. "Heavy Metal" is genre, not style)
  const specificGenre = genres.find(g => !GENERIC_PARENTS.has(g));
  if (specificGenre) return specificGenre;

  // 3) Fall back to first genre, even if generic
  if (genres.length > 0) return genres[0];

  // 4) Or legacy `.genre` single field
  if (item?.genre && typeof item.genre === 'string') return item.genre;

  return 'Unknown';
}

/**
 * Build weighted genre tags — all specific styles count, generic genres
 * only count if no specific style exists for that item.
 * Used for persona calculations, genre distribution breakdowns.
 */
export function genreTagsForItem(item) {
  const styles = Array.isArray(item?.styles) ? item.styles.filter(Boolean) : [];
  const genres = Array.isArray(item?.genres) ? item.genres.filter(Boolean) : [];

  // If item has ANY styles, use only styles (ignore generic genres entirely)
  if (styles.length > 0) return styles;

  // No styles — fall back to non-generic genres, else anything
  const specificGenres = genres.filter(g => !GENERIC_PARENTS.has(g));
  if (specificGenres.length > 0) return specificGenres;

  if (genres.length > 0) return genres;
  if (item?.genre) return [item.genre];
  return [];
}

/**
 * Describes whether a genre tag is considered "metal-family" — used for
 * archetype selection, so a user mostly tagged "Heavy Metal" counts as metal.
 */
export function isMetalFamily(tag) {
  return METAL_KEYWORDS.test(String(tag || ''));
}
