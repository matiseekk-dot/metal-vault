// ────────────────────────────────────────────────────────────────
// Upcoming releases via MusicBrainz.
// Route name kept (/api/releases/metal-archives) for backward compat.
//
// CRITICAL: MusicBrainz rate-limits anonymous traffic at 1 req/sec.
// Firing 57 parallel per-artist queries → most get 503, we silently
// see "zero results" and the user's followed artists disappear from
// the feed. Root cause of the "Anthrax LP never shows" bug.
//
// Architecture:
//   • Per-artist results cached in Supabase (`discogs_cache` table,
//     reused). TTL 24h. Pre-warmed by the daily cron.
//   • Tag-based bulk query cached separately (1h TTL).
//   • Cache misses go through a throttled queue (1 req per 1100ms)
//     so we never exceed MB's anon rate limit.
//   • Per-request budget: max ~5 niecached artists (5 * 1.1s = 5.5s,
//     well under Vercel's 10s function timeout). The rest are skipped
//     for THIS request but enqueued for the next cron tick.
//
// Two query modes (union + dedup by mbid):
//   1. Tag-based discovery — catches anything MB has tagged metal.
//   2. Per-artist lookup — catches fresh announcements before MB
//      community has applied genre tags (Anthrax case).
// ────────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';
// Hobby tier caps at 10s; Pro at 60s. Throttled MB queries at 1.1s
// each — with budget 8 we need ~9-10s headroom. Pro tier comfortable;
// Hobby will trim to 5 niecached per request.
export const maxDuration = 30;

const UA = 'MetalVault/1.0 (https://metal-vault-six.vercel.app)';
const METAL_TAGS = [
  'metal', 'black-metal', 'death-metal', 'thrash-metal', 'doom-metal',
  'heavy-metal', 'power-metal', 'progressive-metal', 'grindcore', 'sludge',
  'stoner-metal', 'folk-metal', 'melodic-death-metal', 'technical-death-metal',
];

const WINDOW_BACK_DAYS     = 30;
const WINDOW_FORWARD_YEARS = 3;
const PER_ARTIST_LIMIT     = 25;
const TAG_QUERY_LIMIT      = 100;
const MAX_ARTISTS          = 100;

// Cache TTLs
const TAG_CACHE_MS    = 60 * 60 * 1000;          // 1h — tag query
const ARTIST_CACHE_MS = 24 * 60 * 60 * 1000;     // 24h — per-artist
// Per-request MB rate limit budget. MB allows 1 req/sec anonymous.
// We use 1100ms to leave safety margin. With Vercel 10s timeout we
// can do at most ~8 niecached queries; we cap at 5 to leave slack
// for the tag query + JSON marshaling.
const RL_DELAY_MS         = 1100;
const NICACHED_BUDGET     = 8;          // 8 * 1.1s = 8.8s, fits under maxDuration=30

const sleep = ms => new Promise(r => setTimeout(r, ms));

function toISO(d) { return d.toISOString().split('T')[0]; }

function escArtist(name) {
  return '"' + String(name).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}

function prettyTag(t) {
  return String(t).replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// ── Supabase cache helpers ───────────────────────────────────────
async function cacheRead(sb, key, maxAgeMs) {
  try {
    const { data } = await sb
      .from('discogs_cache')
      .select('data, created_at')
      .eq('cache_key', key)
      .single();
    if (!data) return null;
    const age = Date.now() - new Date(data.created_at).getTime();
    if (age > maxAgeMs) return null;
    return data.data;
  } catch { return null; }
}

async function cacheWrite(sb, key, data) {
  try {
    await sb.from('discogs_cache').upsert(
      { cache_key: key, data, created_at: new Date().toISOString() },
      { onConflict: 'cache_key' }
    );
  } catch {}
}

// ── MB raw fetch (no caching here — caller decides) ──────────────
async function mbRawFetch(query, limit) {
  const url = 'https://musicbrainz.org/ws/2/release-group/'
    + '?query=' + encodeURIComponent(query)
    + '&limit=' + limit
    + '&offset=0&fmt=json';
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': UA, 'Accept': 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(4000),
    });
    if (!r.ok) return { ok: false, status: r.status, groups: [] };
    const data = await r.json();
    return { ok: true, groups: data['release-groups'] || [] };
  } catch (e) {
    return { ok: false, status: 0, groups: [], error: e.message };
  }
}

// ── Reshape MB release-group into our feed-item contract ─────────
function reshapeGroup(g) {
  const mbid       = g.id;
  const artists    = (g['artist-credit'] || []).map(a => a.name || a.artist?.name).filter(Boolean);
  const artistName = artists.join(', ') || 'Unknown';
  const releaseDate = g['first-release-date'] || null;
  const tagNames   = (g.tags || []).map(t => t.name);
  const metalSubTags = tagNames.filter(t => METAL_TAGS.includes(t));
  const allMetalTags = ['metal', ...metalSubTags];
  const uniqueTags   = Array.from(new Set(allMetalTags));
  const prettyTags   = uniqueTags.map(prettyTag);
  const primaryTag   = metalSubTags[0] || tagNames[0] || 'metal';
  const cover        = 'https://coverartarchive.org/release-group/' + mbid + '/front-250';

  return {
    id:             'mb_' + mbid,
    mbid,
    source:         'musicbrainz',
    artist:         artistName,
    album:          g.title || '',
    cover,
    releaseDate,
    releaseDateRaw: releaseDate,
    genre:          prettyTag(primaryTag),
    genres:         prettyTags,
    styles:         prettyTags,
    preorder:       releaseDate ? new Date(releaseDate) > new Date() : true,
    limited:        false,
    type:           g['primary-type'] || 'Album',
    discogs_url:    'https://musicbrainz.org/release-group/' + mbid,
  };
}

// ── Per-artist fetch with Supabase cache (24h) ───────────────────
async function getArtistItems(sb, artist, dateFilter, typeFilter, rlState) {
  const key = 'mb:artist:' + artist.toLowerCase().replace(/\s+/g, '_');

  // Try cache first — independent of rate-limit budget.
  const cached = await cacheRead(sb, key, ARTIST_CACHE_MS);
  if (cached) return { items: cached, cached: true };

  // Niecached → check per-request budget.
  if (rlState.budget <= 0) {
    return { items: [], cached: false, skipped: true };
  }
  rlState.budget--;

  // Throttle: enforce 1.1s gap between MB hits within this request.
  const now = Date.now();
  const wait = Math.max(0, rlState.nextOkAt - now);
  if (wait > 0) await sleep(wait);
  rlState.nextOkAt = Date.now() + RL_DELAY_MS;

  const q = 'artist:' + escArtist(artist) + ' AND ' + dateFilter + ' AND ' + typeFilter;
  const res = await mbRawFetch(q, PER_ARTIST_LIMIT);
  if (!res.ok) {
    // Don't poison cache on transient errors — let next request retry.
    return { items: [], cached: false, error: res.status };
  }

  const items = res.groups.map(reshapeGroup).filter(it => it.artist && it.album && it.releaseDate);
  await cacheWrite(sb, key, items);
  return { items, cached: false };
}

// ── Tag-based bulk fetch with 1h cache ───────────────────────────
async function getTagItems(sb, dateFilter, typeFilter, rlState) {
  const key = 'mb:tag:global:' + toISO(new Date()).slice(0, 7);  // monthly key — query window changes daily but pop is stable enough

  const cached = await cacheRead(sb, key, TAG_CACHE_MS);
  if (cached) return { items: cached, cached: true };

  // Tag query gets priority — it's the broadest discovery.
  // Bypass budget (cost: 1 query).
  const now = Date.now();
  const wait = Math.max(0, rlState.nextOkAt - now);
  if (wait > 0) await sleep(wait);
  rlState.nextOkAt = Date.now() + RL_DELAY_MS;

  const q = '(' + METAL_TAGS.map(t => 'tag:' + t).join(' OR ') + ')'
    + ' AND ' + dateFilter + ' AND ' + typeFilter;
  const res = await mbRawFetch(q, TAG_QUERY_LIMIT);
  if (!res.ok) return { items: [], cached: false, error: res.status };

  const items = res.groups.map(reshapeGroup).filter(it => it.artist && it.album && it.releaseDate);
  await cacheWrite(sb, key, items);
  return { items, cached: false };
}

export async function GET(request) {
  try {
    const today  = new Date();
    const past   = new Date(today.getTime() - WINDOW_BACK_DAYS * 24 * 60 * 60 * 1000);
    const future = new Date();
    future.setFullYear(future.getFullYear() + WINDOW_FORWARD_YEARS);
    const dateFilter = 'firstreleasedate:[' + toISO(past) + ' TO ' + toISO(future) + ']';
    const typeFilter = '(primarytype:Album OR primarytype:EP)';

    const artistParam = new URL(request.url).searchParams.get('artists') || '';
    const followedArtists = artistParam
      ? artistParam.split(',').map(a => a.trim()).filter(Boolean).slice(0, MAX_ARTISTS)
      : [];

    const sb = getAdminClient();
    const rlState = { budget: NICACHED_BUDGET, nextOkAt: 0 };

    // 1. Tag-based bulk (cached 1h)
    const tagRes = await getTagItems(sb, dateFilter, typeFilter, rlState);

    // 2. Per-artist — all from cache OR small budget for fresh ones.
    //    Sequential so we respect the rate-limit budget correctly.
    let perArtistResults = [];
    let cachedCount = 0;
    let freshCount = 0;
    let skippedCount = 0;
    for (const artist of followedArtists) {
      const r = await getArtistItems(sb, artist, dateFilter, typeFilter, rlState);
      if (r.cached) cachedCount++;
      else if (r.skipped) { skippedCount++; continue; }
      else freshCount++;
      perArtistResults.push(...r.items);
    }

    // 3. Union + dedup by mbid, filter by window.
    const seen = new Set();
    const items = [];
    for (const it of [...(tagRes.items || []), ...perArtistResults]) {
      if (!it.mbid || seen.has(it.mbid)) continue;
      seen.add(it.mbid);
      const rd = new Date(it.releaseDate);
      if (rd < past || rd > future) continue;
      items.push(it);
    }

    items.sort((a, b) => new Date(a.releaseDate) - new Date(b.releaseDate));

    return NextResponse.json({
      items,
      count:  items.length,
      source: 'musicbrainz',
      debug: {
        artistsQueried:     followedArtists.length,
        artistsFromCache:   cachedCount,
        artistsFreshFetched: freshCount,
        artistsBudgetSkipped: skippedCount,  // niecached + budget exhausted; pre-warm via cron
        tagFromCache:       !!tagRes.cached,
        queryWindow:        toISO(past) + ' → ' + toISO(future),
      },
    });
  } catch (e) {
    console.error('[MB] error:', e);
    return NextResponse.json({ items: [], error: e.message, count: 0 }, { status: 500 });
  }
}
