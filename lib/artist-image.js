// ── Unified artist image lookup ──────────────────────────────
// Tries providers in order: Spotify → Deezer → Wikipedia.
//
// Why this order?
//   1. Spotify  — best quality + popularity score, but gated behind
//                 Premium app-owner since late 2024.
//   2. Deezer   — covers most mainstream catalog, free anonymous API.
//                 Filters out Deezer's silhouette placeholder so niche
//                 bands without a real photo fall through here.
//   3. Wikipedia — long-tail safety net. Many underground / niche
//                  metal bands have Wikipedia infobox photos even
//                  though no streaming service indexed them.
//
// Each provider's return shape is { image, thumb, ... }. The unified
// caller maps all three into the same envelope.

import { findArtistImage as findFromSpotify,   isSpotifyConfigured } from '@/lib/spotify';
import { findArtistImage as findFromDeezer }                         from '@/lib/deezer';
import { findArtistImage as findFromWikipedia }                      from '@/lib/wikipedia';

export async function findArtistImage(name, locale) {
  if (!name?.trim()) return null;

  // 1) Try Spotify if configured. If it returns a proper image, done.
  if (isSpotifyConfigured()) {
    try {
      const sp = await findFromSpotify(name);
      if (sp?.image) {
        return { ...sp, source: 'spotify' };
      }
    } catch {}
    // Spotify returned null (no match, 403, etc) — keep going.
  }

  // 2) Deezer fallback. No auth required, no premium required.
  try {
    const dz = await findFromDeezer(name);
    if (dz?.image) {
      return { ...dz, source: 'deezer' };
    }
  } catch {}

  // 3) Wikipedia infobox image. Free, no auth, covers the long tail
  //    of niche bands that streaming providers ignore.
  try {
    const wp = await findFromWikipedia(name, locale);
    if (wp?.image) {
      return { ...wp, source: 'wikipedia' };
    }
  } catch {}

  return null;
}

export async function findArtistImages(names, max = 8, locale) {
  if (!Array.isArray(names) || names.length === 0) return {};
  const slice = names.slice(0, max);
  const results = await Promise.all(
    slice.map(n => findArtistImage(n, locale).then(d => [n, d]))
  );
  return Object.fromEntries(results.filter(([, d]) => d?.image));
}

export function isAnyImageProviderConfigured() {
  // Deezer is always available (no key needed), so this is essentially
  // always true. Kept as a function for symmetry with isSpotifyConfigured.
  return true;
}
