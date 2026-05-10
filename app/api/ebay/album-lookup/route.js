// ── /api/ebay/album-lookup — lowest eBay price for batch (artist, album) ──
//
// Mirror of /api/discogs/album-lookup but against eBay Browse API. Same
// shape so the frontend can call both in parallel and merge the results
// per-album. Cached in the same discogs_cache table (which was always a
// generic key/value cache anyway) under prefix `ebay-album:`.
//
// TTL: 7 days — eBay listings churn fast (auctions resolve, sellers
// relist) but a week-old "cheapest copy" is still a useful price floor
// signal. Negative results cached too so we don't keep hammering eBay
// for albums it doesn't carry.

import { NextResponse } from 'next/server';
import { createClient, getAdminClient } from '@/lib/supabase-server';
import { ebaySearchVinyl, isEbayConfigured } from '@/lib/ebay';

export const dynamic = 'force-dynamic';

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_BATCH    = 12;
const PACING_MS    = 200;   // eBay Browse API: 5000/day = ~3.5/sec safe

function normaliseAlbumTitle(s) {
  return String(s || '').toLowerCase().trim()
    .replace(/\s*[\[(].*?(remaster|reissue|deluxe|edition|expanded|anniversary).*?[\])]\s*/gi, '')
    .replace(/\s*-\s*(remaster|reissue|deluxe).*$/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}
function normaliseArtist(s) {
  return String(s || '').toLowerCase().trim()
    .replace(/\s*\(\d+\)\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function readCache(admin, key) {
  try {
    const { data } = await admin.from('discogs_cache')
      .select('data, created_at')
      .eq('cache_key', key)
      .single();
    if (!data) return null;
    const age = Date.now() - new Date(data.created_at).getTime();
    if (age > CACHE_TTL_MS) return null;
    return data.data;
  } catch { return null; }
}

async function writeCache(admin, key, payload) {
  try {
    await admin.from('discogs_cache').upsert(
      { cache_key: key, data: payload, created_at: new Date().toISOString() },
      { onConflict: 'cache_key' }
    );
  } catch {}
}

export async function POST(request) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (!isEbayConfigured()) {
    return NextResponse.json({ error: 'eBay not configured', results: [] }, { status: 503 });
  }

  let body;
  try { body = await request.json(); } catch { body = {}; }
  const items = Array.isArray(body.items) ? body.items.slice(0, MAX_BATCH) : [];
  if (items.length === 0) return NextResponse.json({ results: [] });

  const admin = getAdminClient();
  const out = [];
  let upstreamHits = 0;

  for (const it of items) {
    const artist = String(it.artist || '').trim();
    const album  = String(it.album  || '').trim();
    if (!artist || !album) {
      out.push({ artist, album, error: 'invalid' });
      continue;
    }
    const cacheKey = 'ebay-album:' + normaliseArtist(artist) + '::' + normaliseAlbumTitle(album);

    const cached = await readCache(admin, cacheKey);
    if (cached) {
      out.push({ artist, album, ...cached, fromCache: true });
      continue;
    }

    if (upstreamHits > 0) await new Promise(r => setTimeout(r, PACING_MS));
    upstreamHits++;

    const resolved = await ebaySearchVinyl(artist, album);
    if (resolved) {
      await writeCache(admin, cacheKey, resolved);
      out.push({ artist, album, ...resolved, fromCache: false });
    } else {
      // Cache the negative — albums eBay doesn't have stay missing for
      // the week, no point re-searching every reload.
      const neg = { notFound: true };
      await writeCache(admin, cacheKey, neg);
      out.push({ artist, album, ...neg });
    }
  }

  return NextResponse.json({ results: out, upstreamHits });
}
