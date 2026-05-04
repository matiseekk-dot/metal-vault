// ── Cover Art Archive lazy fallback ───────────────────────────
//
// GET /api/cover-fallback?artist=<x>&album=<y>&size=250
//
// Resolves a Cover Art Archive URL for an album that Discogs didn't
// have a cover for. Decoupled from /api/search so the search response
// stays fast — the UI calls this only when an <img> errors or is null.
//
// Two MB-throttled hops happen here (artist+album → release-group MBID,
// then CAA URL build). 24h edge cache keeps repeat hits cheap.

import { NextResponse } from 'next/server';
import { rateLimit } from '@/lib/rate-limit';
import { findCoverByArtistAlbum } from '@/lib/coverart';

export const dynamic = 'force-dynamic';

export async function GET(req) {
  const rl = rateLimit(req, { max: 60, windowMs: 60_000 });
  if (!rl.ok) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }

  const { searchParams } = new URL(req.url);
  const artist = (searchParams.get('artist') || '').trim();
  const album  = (searchParams.get('album')  || '').trim();
  const size   = parseInt(searchParams.get('size') || '250', 10);

  if (!artist || !album) {
    return NextResponse.json({ error: 'Provide artist and album' }, { status: 400 });
  }

  const url = await findCoverByArtistAlbum(artist, album, size);

  return NextResponse.json(
    { artist, album, cover: url, source: url ? 'caa' : null },
    {
      headers: {
        // 24h edge cache — covers don't change. SWR for 7 days lets us
        // re-fetch in the background without making the user wait.
        'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=604800',
      },
    }
  );
}
