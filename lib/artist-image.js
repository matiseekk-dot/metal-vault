// ── Unified artist image lookup ──────────────────────────────
// Tries providers in order: Spotify → Deezer.
//
// Why Spotify first? When the operator has Premium it's fine and the
// search-quality / popularity scores are richer.
//
// Why Deezer fallback? Spotify's late-2024 policy change requires the
// app owner to hold Premium even for client_credentials flow — apps
// without Premium get HTTP 403 with "Active premium subscription
// required". Deezer has no such restriction (anonymous public reads),
// so we use it whenever Spotify fails.
//
// Each provider's return shape is { image, thumb, ... }. The unified
// caller maps both into the same envelope.

import { findArtistImage as findFromSpotify, isSpotifyConfigured } from '@/lib/spotify';
import { findArtistImage as findFromDeezer }                       from '@/lib/deezer';

export async function findArtistImage(name) {
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

  return null;
}

export async function findArtistImages(names, max = 8) {
  if (!Array.isArray(names) || names.length === 0) return {};
  const slice = names.slice(0, max);
  const results = await Promise.all(
    slice.map(n => findArtistImage(n).then(d => [n, d]))
  );
  return Object.fromEntries(results.filter(([, d]) => d?.image));
}

export function isAnyImageProviderConfigured() {
  // Deezer is always available (no key needed), so this is essentially
  // always true. Kept as a function for symmetry with isSpotifyConfigured.
  return true;
}
