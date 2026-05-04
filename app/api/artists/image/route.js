// ── Artist photo lookup ───────────────────────────────────────
//
// GET  /api/artists/image?name=<x>          → single artist
// POST /api/artists/image  body: { names[] } → batch (≤ 12)
//
// Returns Spotify-hosted artist images. Used to decorate ArtistCard /
// MemberCard rows in the search results without making the search call
// itself slower — UI fetches images after the list paints.
//
// Caching: only positive results get cached at the edge (7 days).
// Empty / unauthenticated responses use no-store to avoid poisoning
// the cache before keys land in Vercel — see lessons learned where the
// CDN remembered "no Spotify configured" for a week after the operator
// finally added credentials.

import { NextResponse } from 'next/server';
import { rateLimit } from '@/lib/rate-limit';
import { findArtistImage, findArtistImages, isAnyImageProviderConfigured } from '@/lib/artist-image';

export const dynamic = 'force-dynamic';

const CACHE_HIT  = 'public, s-maxage=604800, stale-while-revalidate=2592000';
const CACHE_MISS = 'no-store';

function cacheHeaders(hasContent) {
  return { 'Cache-Control': hasContent ? CACHE_HIT : CACHE_MISS };
}

export async function GET(req) {
  const rl = rateLimit(req, { max: 60, windowMs: 60_000 });
  if (!rl.ok) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }
  const name = (new URL(req.url).searchParams.get('name') || '').trim();
  if (!name) return NextResponse.json({ error: 'Provide name' }, { status: 400 });

  // Unified lookup: Spotify first if configured, Deezer fallback.
  // Deezer is always available (no key required) so this never short-
  // circuits — we always at least try one provider.
  const meta = await findArtistImage(name);
  const payload = { name, ...(meta || { image: null }), configured: isAnyImageProviderConfigured() };
  return NextResponse.json(payload, { headers: cacheHeaders(!!meta?.image) });
}

export async function POST(req) {
  const rl = rateLimit(req, { max: 30, windowMs: 60_000 });
  if (!rl.ok) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }
  let body;
  try { body = await req.json(); } catch { body = {}; }
  const names = Array.isArray(body.names) ? body.names.slice(0, 12) : [];
  if (names.length === 0) {
    return NextResponse.json({ images: {} }, { headers: cacheHeaders(false) });
  }

  const images = await findArtistImages(names, 12);
  const compact = Object.fromEntries(
    Object.entries(images).map(([n, m]) => [n, m.thumb || m.image])
  );
  // Only cache the response if at least one image actually came back —
  // otherwise the empty "no match" response gets pinned at the edge for
  // a week. With Spotify configured most batches return >=1 hit.
  const hit = Object.keys(compact).length > 0;
  return NextResponse.json(
    { images: compact, configured: true },
    { headers: cacheHeaders(hit) }
  );
}
