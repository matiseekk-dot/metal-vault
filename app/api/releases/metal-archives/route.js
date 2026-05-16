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

// Popular metal artists — hardcoded baseline so the "All Metal" feed
// has guaranteed coverage of major bands even before any user follows
// them, and even when MB hasn't tagged a release yet. Cron warms these
// nightly into the global cache; live endpoint unions them in.
// Curated for relevance to the vinyl-collecting metal community.
const POPULAR_METAL_ARTISTS = [
  // Big 4 thrash + classic
  'Metallica', 'Megadeth', 'Slayer', 'Anthrax', 'Iron Maiden', 'Judas Priest',
  'Black Sabbath', 'Motörhead', 'Pantera', 'Sepultura', 'Testament', 'Exodus',
  'Overkill', 'Kreator', 'Destruction', 'Sodom', 'Death Angel',
  // Death metal classics + active
  'Death', 'Morbid Angel', 'Cannibal Corpse', 'Deicide', 'Obituary', 'Suffocation',
  'Immolation', 'Nile', 'Behemoth', 'Vader', 'Decapitated', 'Bloodbath',
  'At the Gates', 'In Flames', 'Dark Tranquillity', 'Arch Enemy', 'Amon Amarth',
  'Children of Bodom', 'Carcass', 'Entombed', 'Dismember', 'Bolt Thrower',
  'Gojira', 'Cattle Decapitation', 'Tomb Mold', 'Blood Incantation',
  // Black metal
  'Mayhem', 'Burzum', 'Darkthrone', 'Emperor', 'Immortal', 'Marduk',
  'Dimmu Borgir', 'Cradle of Filth', 'Watain', 'Mgła', 'Batushka',
  'Behexen', 'Taake', 'Enslaved', 'Wolves in the Throne Room',
  'Spectral Wound', 'Krallice',
  // Doom / sludge / stoner
  'Candlemass', 'Electric Wizard', 'Sleep', 'Saint Vitus', 'Yob',
  'Pallbearer', 'Bell Witch', 'Mastodon', 'Baroness', 'High on Fire',
  'Sleep', 'Boris', 'Conan',
  // Progressive / power
  'Tool', 'Opeth', 'Dream Theater', 'Mastodon', 'Devin Townsend',
  'Between the Buried and Me', 'Leprous', 'Haken', 'Voivod',
  'Blind Guardian', 'Helloween', 'Stratovarius', 'Symphony X', 'Kamelot',
  'Sonata Arctica', 'Wintersun', 'Nightwish', 'Epica',
  // Modern / metalcore / deathcore
  'Lamb of God', 'Killswitch Engage', 'Trivium', 'Architects',
  'Parkway Drive', 'August Burns Red', 'Whitechapel', 'Suicide Silence',
  'Lorna Shore', 'Thy Art Is Murder', 'Born of Osiris', 'Veil of Maya',
  'After the Burial', 'Periphery', 'Meshuggah', 'Animals as Leaders',
  'Bring Me the Horizon', 'Spiritbox', 'Sleep Token',
  // Folk / viking
  'Ensiferum', 'Eluveitie', 'Korpiklaani', 'Finntroll', 'Moonsorrow',
  'Tyr', 'Heilung',
  // Polish scene (app's main audience)
  'Vader', 'Behemoth', 'Decapitated', 'Mgła', 'Batushka', 'Furia',
  'Riverside', 'Mastodon', 'Hate', 'Vesania',
  // Recent buzz / underground darlings
  'Sumac', 'Cult of Luna', 'Russian Circles', 'Pelican', 'ISIS',
  'Neurosis', 'Converge', 'Dillinger Escape Plan',
  'Ghost', 'Power Trip', 'Knocked Loose', 'Code Orange',
  'Fit for an Autopsy', 'Frozen Soul',
];

// Cache TTLs
const TAG_CACHE_MS    = 60 * 60 * 1000;          // 1h — tag query
const ARTIST_CACHE_MS = 24 * 60 * 60 * 1000;     // 24h — per-artist
// Per-request MB rate limit budget. MB allows 1 req/sec anonymous.
// We use 1100ms to leave safety margin. With Vercel 10s timeout we
// can do at most ~8 niecached queries; we cap at 5 to leave slack
// for the tag query + JSON marshaling.
const RL_DELAY_MS         = 1100;
// 15 = enough for: 1 tag query + ~8 popular-list batches + ~3 followed
// batches + 3 budget margin. Worst-case ~17s with throttling, still
// under maxDuration=30. Subsequent requests hit cache → <500ms.
const NICACHED_BUDGET     = 15;

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

// ── Batched per-artist fetch ─────────────────────────────────────
// Instead of one MB query per artist (budget-limited), pack 20 artists
// into a single Lucene OR query: (artist:"A1" OR artist:"A2" OR ...).
// 57 followed artists → 3 batched queries → ~3.5s total. All hit.
//
// Per-artist Supabase cache (24h) is still maintained — we split the
// batched result back to individual artists by name match. Cached
// artists are skipped, so a warm user pays zero MB cost.
async function getBatchedArtistItems(sb, artists, dateFilter, typeFilter, rlState) {
  // 1. Partition: cache hits vs misses.
  const cachedItems = [];
  const niecached = [];
  await Promise.all(artists.map(async (artist) => {
    const key = 'mb:artist:' + artist.toLowerCase().replace(/\s+/g, '_');
    const cached = await cacheRead(sb, key, ARTIST_CACHE_MS);
    if (cached) {
      cachedItems.push(...cached);
    } else {
      niecached.push(artist);
    }
  }));

  // 2. Batch niecached into groups of BATCH_SIZE and fire one MB query per batch.
  const BATCH_SIZE = 20;
  const batches = [];
  for (let i = 0; i < niecached.length; i += BATCH_SIZE) {
    batches.push(niecached.slice(i, i + BATCH_SIZE));
  }

  let freshItems = [];
  let batchErrors = 0;
  let batchesProcessed = 0;
  let artistsProcessed = 0;
  for (const batch of batches) {
    if (rlState.budget <= 0) break;
    rlState.budget--;
    batchesProcessed++;
    artistsProcessed += batch.length;

    // Throttle to MB's 1 req/sec
    const now = Date.now();
    const wait = Math.max(0, rlState.nextOkAt - now);
    if (wait > 0) await sleep(wait);
    rlState.nextOkAt = Date.now() + RL_DELAY_MS;

    const orList = batch.map(a => 'artist:' + escArtist(a)).join(' OR ');
    const q = '(' + orList + ') AND ' + dateFilter + ' AND ' + typeFilter;
    // Limit scales with batch size — 20 artists * ~5 LPs each = ~100 max.
    const limit = Math.min(100, batch.length * 8);
    const res = await mbRawFetch(q, limit);
    if (!res.ok) { batchErrors++; continue; }

    const batchItems = res.groups
      .map(reshapeGroup)
      .filter(it => it.artist && it.album && it.releaseDate);
    freshItems.push(...batchItems);

    // 3. Split batch result back to per-artist cache.
    // An item's `artist` field may be "Anthrax" or "Anthrax & Public Enemy"
    // (collabs/credits). Match each batch artist by case-insensitive
    // substring on the credit field.
    for (const artist of batch) {
      const artistLower = artist.toLowerCase();
      const itemsForArtist = batchItems.filter(it =>
        (it.artist || '').toLowerCase().includes(artistLower)
      );
      const key = 'mb:artist:' + artist.toLowerCase().replace(/\s+/g, '_');
      // Persist even empty arrays — distinguishes "never queried" from
      // "queried, MB has nothing" so we don't waste budget re-querying.
      await cacheWrite(sb, key, itemsForArtist);
    }
  }

  return {
    items: [...cachedItems, ...freshItems],
    cachedArtists: artists.length - niecached.length,
    freshArtists: niecached.length - (batches.length > 0 && rlState.budget < 0 ? 0 : 0),
    batchesFired: Math.min(batches.length, batches.length - batchErrors),
    batchErrors,
  };
}

// ── Scan ALL cached artists in Supabase ──────────────────────────
// The global "All Metal" feed shows everything anyone has ever pre-
// warmed: every followed artist of every user, plus every entry in
// the hardcoded popular-artists list. Without this scan the feed
// would only show tag-tagged MB items (very narrow) + the calling
// user's followed artists (zero, if they didn't follow anyone).
//
// Anthrax / Megadeth / any major metal band lands here regardless
// of who follows them — that's the user's expectation for "All Metal".
async function getGlobalCachedArtistItems(sb) {
  try {
    const { data } = await sb
      .from('discogs_cache')
      .select('data, created_at')
      .like('cache_key', 'mb:artist:%');
    if (!data) return [];
    const fresh = data.filter(row =>
      Date.now() - new Date(row.created_at).getTime() < ARTIST_CACHE_MS
    );
    const all = [];
    for (const row of fresh) {
      if (Array.isArray(row.data)) all.push(...row.data);
    }
    return all;
  } catch {
    return [];
  }
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

    // 1. Tag-based bulk (cached 1h) — anything MB tagged metal.
    const tagRes = await getTagItems(sb, dateFilter, typeFilter, rlState);

    // 2. Popular metal artists — hardcoded baseline. Batched MB
    //    queries cached 24h per artist. First call seeds the cache
    //    (~5s for all ~150 artists across ~8 batches); subsequent
    //    calls are instant. Means Anthrax/Megadeth/Slayer always
    //    appear in "All Metal" — even for users following nobody,
    //    even when MB hasn't tagged a release yet.
    const popularRes = await getBatchedArtistItems(
      sb, POPULAR_METAL_ARTISTS, dateFilter, typeFilter, rlState
    );

    // 3. Global cached artists — every artist EVER pre-warmed by any
    //    user's follow + cron. Pulled from Supabase, ~zero latency.
    const globalCachedItems = await getGlobalCachedArtistItems(sb);

    // 4. Caller's followed artists — batched MB queries with 24h cache.
    //    Niecached → fired now; cached → instant.
    const batchedRes = followedArtists.length > 0
      ? await getBatchedArtistItems(sb, followedArtists, dateFilter, typeFilter, rlState)
      : { items: [], cachedArtists: 0, freshArtists: 0, batchesFired: 0, batchErrors: 0 };
    const perArtistResults = batchedRes.items;

    // 5. Union + dedup by mbid, filter by window.
    const seen = new Set();
    const items = [];
    for (const it of [
      ...(tagRes.items || []),
      ...(popularRes.items || []),
      ...globalCachedItems,
      ...perArtistResults,
    ]) {
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
        artistsQueried:    followedArtists.length,
        artistsFromCache:  batchedRes.cachedArtists,
        artistsFresh:      batchedRes.freshArtists,
        batchesFired:      batchedRes.batchesFired,
        batchErrors:       batchedRes.batchErrors,
        popularFromCache:  popularRes.cachedArtists,
        popularFresh:      popularRes.freshArtists,
        popularBatches:    popularRes.batchesFired,
        globalCachedItems: globalCachedItems.length,
        tagFromCache:      !!tagRes.cached,
        queryWindow:       toISO(past) + ' → ' + toISO(future),
      },
    });
  } catch (e) {
    console.error('[MB] error:', e);
    return NextResponse.json({ items: [], error: e.message, count: 0 }, { status: 500 });
  }
}
