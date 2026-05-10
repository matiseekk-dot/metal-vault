// ── /api/discogs/album-lookup — resolve cover + price for unmatched albums ─
//
// Used by the Listening tab to enrich Last.fm rows the user doesn't own.
// Each row arrives as just (artist, album) strings — no Discogs ID — so
// we have to:
//   1. Search Discogs for the best matching release
//   2. Pick the lowest-price master pressing
//   3. Cache the result so subsequent visitors hit instantly
//
// Cache strategy: GLOBAL (not per-user) via the existing discogs_cache
// table, keyed on `albumlookup:{artistNorm}::{albumNorm}`. If user A
// streams Ulver and user B streams Ulver, we only burn one Discogs
// lookup. TTL 7 days because marketplace prices drift.
//
// Rate budget: Discogs allows 60 req/min for authenticated calls. Our
// frontend batches 8 at a time with ~1.2s of internal pacing — that's
// well under the ceiling, but if a user has 1000 unresolved items the
// background fill takes ~2 min. Acceptable, runs once.
//
// Endpoint: POST with { items: [{ artist, album }, ...] }
// Returns:  { results: [{ artist, album, cover, lowestPrice, ... }, ...] }

import { NextResponse } from 'next/server';
import { createClient, getAdminClient } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;   // 7 days
const UA           = 'MetalVault/1.0 +https://metal-vault-six.vercel.app';
const MAX_BATCH    = 12;                          // hard ceiling per request
const PACING_MS    = 250;                         // 4 req/sec, well under 60/min

function discogsAuth() {
  const k = process.env.DISCOGS_KEY;
  const s = process.env.DISCOGS_SECRET;
  const t = process.env.DISCOGS_TOKEN;
  if (k && s) return 'Discogs key=' + k + ', secret=' + s;
  if (t)      return 'Discogs token=' + t;
  return null;
}

// Same normalisers as the sync routes — keeps cache keys consistent.
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

// One Discogs search for one (artist, album) pair. Picks the result
// with the lowest_price set + highest community.have count (best
// approximation of "the canonical pressing"). Falls back to first
// result if none have price data.
async function resolveOne(auth, artist, album) {
  const q = (artist + ' ' + album).trim();
  if (!q) return null;
  const url = 'https://api.discogs.com/database/search'
    + '?type=release'
    + '&format=vinyl'
    + '&artist=' + encodeURIComponent(artist)
    + '&release_title=' + encodeURIComponent(album)
    + '&per_page=10';
  let r;
  try {
    r = await fetch(url, {
      headers: { Authorization: auth, 'User-Agent': UA },
    });
  } catch (e) {
    return { error: 'fetch_failed', message: e.message };
  }
  if (!r.ok) {
    if (r.status === 429) return { error: 'rate_limited' };
    return { error: 'upstream_' + r.status };
  }
  const d = await r.json();
  const results = Array.isArray(d.results) ? d.results : [];
  if (results.length === 0) return { error: 'not_found' };

  // Score each candidate: prefer ones with marketplace price, then by
  // community.have count (popularity), then earliest year (canonical).
  const ranked = results
    .map(rr => ({
      raw:        rr,
      hasPrice:   typeof rr.community?.have === 'number' && rr.lowest_price != null,
      have:       rr.community?.have || 0,
      year:       Number(rr.year) || 9999,
    }))
    .sort((a, b) => {
      if (a.hasPrice !== b.hasPrice) return a.hasPrice ? -1 : 1;
      if (b.have !== a.have)         return b.have - a.have;
      return a.year - b.year;
    });

  const top = ranked[0].raw;
  return {
    releaseId:   top.id,
    masterId:    top.master_id || null,
    cover:       top.cover_image || top.thumb || null,
    lowestPrice: top.lowest_price ?? null,
    // Discogs returns prices in USD by default for unauthenticated, but
    // for authenticated it respects the account's currency setting. We
    // can't reliably know — record what came back and let UI display it.
    currency:    'USD',
    discogsUrl:  'https://www.discogs.com/release/' + top.id,
    title:       top.title || null,
    year:        top.year || null,
  };
}

export async function POST(request) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const auth = discogsAuth();
  if (!auth) return NextResponse.json({ error: 'Discogs not configured' }, { status: 503 });

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
    const artistNorm = normaliseArtist(artist);
    const albumNorm  = normaliseAlbumTitle(album);
    const cacheKey   = 'albumlookup:' + artistNorm + '::' + albumNorm;

    const cached = await readCache(admin, cacheKey);
    if (cached) {
      out.push({ artist, album, ...cached, fromCache: true });
      continue;
    }

    // Pace upstream calls — 250ms between Discogs hits.
    if (upstreamHits > 0) await new Promise(r => setTimeout(r, PACING_MS));
    upstreamHits++;

    const resolved = await resolveOne(auth, artist, album);
    if (resolved && !resolved.error) {
      await writeCache(admin, cacheKey, resolved);
      out.push({ artist, album, ...resolved, fromCache: false });
    } else {
      // Cache the negative result too — re-searching every time for
      // an album Discogs doesn't have wastes the rate budget. Negative
      // TTL is the same 7d (we'll retry next week in case it's added).
      const neg = { notFound: true, error: resolved?.error || 'not_found' };
      await writeCache(admin, cacheKey, neg);
      out.push({ artist, album, ...neg });
    }
  }

  return NextResponse.json({ results: out, upstreamHits });
}
