// ── Artist photo lookup ───────────────────────────────────────
//
// GET  /api/artists/image?name=<x>          → single artist
// POST /api/artists/image  body: { names[] } → batch (≤ 12)
//
// Returns Spotify-hosted artist images. Used to decorate ArtistCard /
// MemberCard rows in the search results without making the search call
// itself slower — UI fetches images after the list paints.
//
// Cache: 7 days at the edge. Spotify image URLs are stable for years.

import { NextResponse } from 'next/server';
import { rateLimit } from '@/lib/rate-limit';
import { findArtistImage, findArtistImages } from '@/lib/spotify';

export const dynamic = 'force-dynamic';

const CACHE_HEADERS = {
  'Cache-Control': 'public, s-maxage=604800, stale-while-revalidate=2592000',
};

export async function GET(req) {
  const rl = rateLimit(req, { max: 60, windowMs: 60_000 });
  if (!rl.ok) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }
  const name = (new URL(req.url).searchParams.get('name') || '').trim();
  if (!name) return NextResponse.json({ error: 'Provide name' }, { status: 400 });
  const meta = await findArtistImage(name);
  return NextResponse.json({ name, ...(meta || { image: null }) }, { headers: CACHE_HEADERS });
}

export async function POST(req) {
  const rl = rateLimit(req, { max: 30, windowMs: 60_000 });
  if (!rl.ok) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }
  let body;
  try { body = await req.json(); } catch { body = {}; }
  const names = Array.isArray(body.names) ? body.names.slice(0, 12) : [];
  if (names.length === 0) return NextResponse.json({ images: {} });
  const images = await findArtistImages(names, 12);
  // Reduce payload — only return name → thumb URL pairs.
  const compact = Object.fromEntries(
    Object.entries(images).map(([n, m]) => [n, m.thumb || m.image])
  );
  return NextResponse.json({ images: compact }, { headers: CACHE_HEADERS });
}
