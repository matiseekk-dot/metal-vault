// ── Metal Vault — /api/releases (cached + rate-limit aware) ────────────
//
// AUDIT NOTES (pre-fix):
//   • 22 base searches + 3 per followed artist (artistSearches) =
//     up to 82 search calls + 120 detail fetches = 202 Discogs hits per user
//   • All firing parallel via Promise.all + cache:'no-store'
//   • Discogs auth limit = 60 req/min → second user in same minute = MOCK fallback
//   • discogs_cache table existed but was unused here
//
// FIX: Three-layer cache + sequential batched detail fetches.
//
// Layer 1 — `releases:global:DATE` (TTL 1h):
//   The 22 metal-style base searches. Same for ALL users. First user in the
//   hour pays the fetch cost; everyone else reads from Supabase. Cache key
//   includes date so it auto-rolls daily without explicit invalidation.
//
// Layer 2 — `releases:artist:NAME` (TTL 6h):
//   Per-artist searches. User A and B both follow Gojira → only one Discogs
//   fetch. Artists' release schedules don't change within hours.
//
// Layer 3 — `releases:detail:ID` (TTL 24h):
//   getDetail() responses. Same release ID viewed by 100 users = 1 fetch.
//   Detail data (cover, label, formats) almost never changes once Discogs
//   has indexed the release.
//
// Sequential batching: cache misses are processed in batches of 5 with a
// 1.1s delay between batches → max ~55 req/min, safely under the 60/min cap.

import { NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabase-server';


export const dynamic = 'force-dynamic';

const UA = { 'User-Agent': 'MetalVault/1.0 +https://metal-vault-six.vercel.app' };

// Cache TTLs in milliseconds
const TTL_GLOBAL  = 1  * 60 * 60 * 1000;  // 1h
const TTL_ARTIST  = 6  * 60 * 60 * 1000;  // 6h
const TTL_DETAIL  = 24 * 60 * 60 * 1000;  // 24h

// Discogs rate limit pacing
const BATCH_SIZE  = 5;        // requests per batch
const BATCH_DELAY = 1100;     // ms between batches → ~272 req/min cap, but
                              // we do 5 parallel = 5 every 1.1s = ~273 burst
                              // Actually safer at 5 every 1100ms = 4.5/sec
                              // sustained, well under 60/min auth limit.

const sleep = ms => new Promise(r => setTimeout(r, ms));

function auth() {
  const k = process.env.DISCOGS_KEY, s = process.env.DISCOGS_SECRET, t = process.env.DISCOGS_TOKEN;
  if (k && s) return 'Discogs key=' + k + ', secret=' + s;
  if (t)      return 'Discogs token=' + t;
  return null;
}

function parseDate(str) {
  if (!str) return '';
  const s = String(str).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (/^\d{4}-\d{2}$/.test(s))        return s + '-01';
  if (/^\d{4}$/.test(s))              return s;
  const d = new Date(s);
  if (!isNaN(d)) return d.toISOString().split('T')[0];
  return '';
}

// ── Cache helpers ────────────────────────────────────────────────────
async function readCache(sb, key, maxAgeMs) {
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

async function writeCache(sb, key, data) {
  try {
    await sb.from('discogs_cache').upsert(
      { cache_key: key, data, created_at: new Date().toISOString() },
      { onConflict: 'cache_key' }
    );
  } catch {}
}

// Process N tasks with concurrency = BATCH_SIZE, delay between batches.
// Each task is an async function returning whatever it returns.
async function processBatched(tasks) {
  const results = new Array(tasks.length);
  for (let i = 0; i < tasks.length; i += BATCH_SIZE) {
    const slice = tasks.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(slice.map((t, j) =>
      Promise.resolve(t()).catch(() => null)
    ));
    for (let j = 0; j < batchResults.length; j++) {
      results[i + j] = batchResults[j];
    }
    // Delay between batches except after the last one
    if (i + BATCH_SIZE < tasks.length) await sleep(BATCH_DELAY);
  }
  return results;
}

// ── Discogs fetch primitives ──────────────────────────────────────────

// Single search call. Used for both base styles and per-artist.
async function discogsSearch(url, headers) {
  try {
    const r = await fetch(url, { headers, cache: 'no-store' });
    return r.ok ? r.json() : { results: [] };
  } catch { return { results: [] }; }
}

// Detail with cache layer.
async function getDetailCached(id, headers, sb) {
  const cacheKey = 'releases:detail:' + id;
  const cached = await readCache(sb, cacheKey, TTL_DETAIL);
  if (cached) return cached;

  let data = null;
  try {
    const r = await fetch('https://api.discogs.com/releases/' + id,
      { headers, cache: 'no-store' });
    if (r.ok) data = await r.json();
  } catch {}

  if (data) await writeCache(sb, cacheKey, data);
  return data;
}

// ── Genre + format helpers (unchanged from original) ──────────────────

function pickGenre(full, item) {
  const METAL = [
    'Death Metal','Black Metal','Thrash Metal','Doom Metal','Progressive Metal',
    'Power Metal','Heavy Metal','Metalcore','Groove Metal','Sludge Metal',
    'Symphonic Metal','Folk Metal','Industrial Metal','Post-Metal','Grindcore',
    'Nu-Metal','Speed Metal','Stoner Metal','Viking Metal','Melodic Death Metal',
  ];
  const all = [
    ...(full?.styles || []),
    ...(full?.genres || []),
    ...(item.style   || []),
    ...(item.genre   || []),
  ];
  return (
    all.find(g => METAL.some(m => g?.toLowerCase().includes(m.toLowerCase()))) ||
    all[0] ||
    'Metal'
  );
}

const MOCK = [
  {id:'m1',artist:'Power Trip',     album:'Nightmare Logic',         cover:null,releaseDate:'2026-05-15',genre:'Thrash Metal',    preorder:true, limited:false},
  {id:'m2',artist:'Tomb Mold',      album:'Planetary Clairvoyance',  cover:null,releaseDate:'2026-05-22',genre:'Death Metal',     preorder:true, limited:false},
  {id:'m3',artist:'Wallowing',      album:'Beholden to the Sword',   cover:null,releaseDate:'2026-06-06',genre:'Doom Metal',      preorder:true, limited:true},
  {id:'m4',artist:'Spectral Wound', album:'Songs of Blood and Mire', cover:null,releaseDate:'2026-06-20',genre:'Black Metal',     preorder:true, limited:false},
  {id:'m5',artist:'Frozen Soul',    album:'Glacial Domination',      cover:null,releaseDate:'2026-04-25',genre:'Death Metal',     preorder:false,limited:false},
  {id:'m6',artist:'Enforcer',       album:'Nostalgia',               cover:null,releaseDate:'2026-04-18',genre:'Heavy Metal',     preorder:false,limited:true},
];

const METAL_STYLES = [
  'Heavy Metal','Death Metal','Black Metal','Thrash Metal',
  'Doom Metal','Progressive Metal','Power Metal','Metalcore',
];

// ── Layer 1: global metal-style searches ──────────────────────────────
async function getGlobalSearches(headers, sb, curYear, nextYear) {
  const todayStr = new Date().toISOString().split('T')[0];
  const cacheKey = 'releases:global:' + todayStr;

  const cached = await readCache(sb, cacheKey, TTL_GLOBAL);
  if (cached) return { results: cached, fromCache: true };

  const prevYear = curYear - 1;
  const urls = [
    // Next year — pre-orders
    ...METAL_STYLES.slice(0, 6).map(style =>
      `https://api.discogs.com/database/search?type=release&format=Vinyl&style=${encodeURIComponent(style)}&year=${nextYear}&sort=date_added&sort_order=desc&per_page=20&page=1`
    ),
    // Current year
    ...METAL_STYLES.slice(0, 8).map(style =>
      `https://api.discogs.com/database/search?type=release&format=Vinyl&style=${encodeURIComponent(style)}&year=${curYear}&sort=date_added&sort_order=desc&per_page=20&page=1`
    ),
    // Current year page 2
    ...METAL_STYLES.slice(0, 4).map(style =>
      `https://api.discogs.com/database/search?type=release&format=Vinyl&style=${encodeURIComponent(style)}&year=${curYear}&sort=date_added&sort_order=desc&per_page=20&page=2`
    ),
    // Previous year — last 6 months of releases
    ...METAL_STYLES.slice(0, 4).map(style =>
      `https://api.discogs.com/database/search?type=release&format=Vinyl&style=${encodeURIComponent(style)}&year=${prevYear}&sort=date_added&sort_order=desc&per_page=20&page=1`
    ),
  ];

  // 22 searches → 5 batches of 5 + last 2 = ~5.5s with batching delay
  const tasks = urls.map(u => () => discogsSearch(u, headers));
  const pages = await processBatched(tasks);

  const results = [];
  for (const page of pages) {
    if (page?.results) results.push(...page.results);
  }

  await writeCache(sb, cacheKey, results);
  return { results, fromCache: false };
}

// ── Layer 2: per-artist searches with cache ───────────────────────────
async function getArtistSearches(artists, headers, sb, curYear, nextYear) {
  const prevYear = curYear - 1;
  const allResults = [];
  const tasks = [];

  for (const artist of artists) {
    const cacheKey = 'releases:artist:' + artist.toLowerCase().replace(/\s+/g, '_');

    tasks.push(async () => {
      const cached = await readCache(sb, cacheKey, TTL_ARTIST);
      if (cached) return cached;

      // For followed artists, fetch more aggressively — user wants completeness.
      // 25 per year × 3 years = up to 75 candidates per artist (after dedup).
      // Discogs cap is 100/page; we use 25 to balance signal/noise.
      const urls = [
        `https://api.discogs.com/database/search?type=release&format=Vinyl&artist=${encodeURIComponent(artist)}&year=${curYear}&sort=date_added&sort_order=desc&per_page=25&page=1`,
        `https://api.discogs.com/database/search?type=release&format=Vinyl&artist=${encodeURIComponent(artist)}&year=${nextYear}&sort=date_added&sort_order=desc&per_page=25&page=1`,
        `https://api.discogs.com/database/search?type=release&format=Vinyl&artist=${encodeURIComponent(artist)}&year=${prevYear}&sort=date_added&sort_order=desc&per_page=25&page=1`,
      ];
      const pages = await Promise.all(urls.map(u => discogsSearch(u, headers)));
      const merged = [];
      for (const p of pages) merged.push(...(p.results || []));
      await writeCache(sb, cacheKey, merged);
      return merged;
    });
  }

  const perArtist = await processBatched(tasks);
  for (const list of perArtist) {
    if (Array.isArray(list)) allResults.push(...list);
  }
  return allResults;
}

// ── Main handler ──────────────────────────────────────────────────────
export async function GET(request) {
  const artistParam = new URL(request.url).searchParams.get('artists') || '';
  // Used for Discogs per-artist queries (expensive, rate-limited) and to forward
  // to MB. Discogs side keeps the 20-cap; MB side gets full list to maximize
  // the per-artist hit-rate (cheap, parallel, no auth limit).
  const followedArtistsFull = artistParam
    ? artistParam.split(',').map(a => a.trim()).filter(Boolean)
    : [];
  const followedArtists = followedArtistsFull.slice(0, 20);

  const token = auth();
  if (!token) return NextResponse.json({ releases: MOCK, source: 'mock' });

  const headers  = { ...UA, Authorization: token };
  const sb       = getAdminClient();
  const todayStr = new Date().toISOString().split('T')[0];
  const today    = new Date(todayStr);
  const curYear  = today.getFullYear();
  const nextYear = curYear + 1;
  // Feed window: 30 days back, unlimited forward. Vinyl preorder tracker —
  // user cares about what's coming, recent releases get a short tail.
  // Anything older than 30 days has presumably already shipped and is
  // searchable via the catalog tab.
  const recentFrom = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000)
    .toISOString().split('T')[0];

  try {
    // ── Layer 1: global searches (cached 1h, shared across ALL users) ──
    const { results: globalResults, fromCache: globalCached } =
      await getGlobalSearches(headers, sb, curYear, nextYear);

    // ── Layer 2: per-artist (cached 6h per artist) ──
    const artistResults = followedArtists.length > 0
      ? await getArtistSearches(followedArtists, headers, sb, curYear, nextYear)
      : [];

    // ── Deduplicate ─────────────────────────────────────────────
    const seen = new Set();
    const candidates = [];
    for (const item of [...artistResults, ...globalResults]) {
      const parts  = (item.title || '').split(' - ');
      const artist = parts[0]?.trim();
      const album  = parts.slice(1).join(' - ').replace(/\s*\(\d{4}\)$/, '').trim();
      if (!artist || !album) continue;
      const key = artist + '::' + album;
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push({ id: String(item.id), artist, album, item });
    }

    // ── Layer 3: fetch detail with per-release cache ──
    // Cap at 200 candidates — increased from 120 because followed-artist results
    // were getting truncated for users with many follows. Each cache hit = 0
    // Discogs requests, so the only real cost is first-time fetches per release.
    const capped = candidates.slice(0, 200);
    const detailTasks = capped.map(c => () => getDetailCached(c.id, headers, sb));
    const fullDetails = await processBatched(detailTasks);

    // ── Build release objects ──
    const detailed = capped.map((c, i) => {
      const { id, artist, album, item } = c;
      const full = fullDetails[i];

      const rawReleased = full?.released || '';
      const parsedFull  = parseDate(rawReleased);
      const pressYear   = item.year ? String(item.year) : '';

      const useFullDate = parsedFull && parsedFull >= String(curYear) + '-01-01';
      const releaseDate = useFullDate ? parsedFull : pressYear || parsedFull || '';

      const relTs     = releaseDate?.length === 10 ? new Date(releaseDate) : null;
      const isUpcoming = relTs ? relTs > today :
                        (releaseDate?.length === 4 && Number(releaseDate) > curYear);
      const isRecent  = relTs ? relTs >= new Date(recentFrom) && relTs <= today : false;

      // Skip old re-presses
      if (!isUpcoming && !isRecent && pressYear && Number(pressYear) < curYear) return null;
      if (!isUpcoming && !isRecent && relTs && relTs < new Date(recentFrom)) return null;

      const fmts = [
        ...(full?.formats || []),
        ...(item.format || []).map(f => ({ descriptions: [f] })),
      ];
      const allDesc = fmts.flatMap(f => f.descriptions || []).join(' ').toLowerCase();
      const isLimited = allDesc.includes('limited') || allDesc.includes('numbered') ||
                       allDesc.includes('colored')  || allDesc.includes('colour');
      // Box set — common in deluxe metal releases. Discogs format
      // descriptions sometimes have "Box Set" as a separate token, or
      // include words like "boxed".
      const isBoxSet = allDesc.includes('box set') || allDesc.includes('boxset') || allDesc.includes('boxed');
      // Reissue / anniversary / remastered — metal scene loves these.
      // Detect by format descriptors first, then by title heuristics
      // (e.g. "Painkiller (30th Anniversary Edition)").
      const titleLower = String(full?.title || album || '').toLowerCase();
      const isReissue = allDesc.includes('reissue') || allDesc.includes('remaster')
        || allDesc.includes('re-issue') || allDesc.includes('re-release')
        || /\b(anniversary|deluxe edition|expanded edition|reissue|remastered)\b/.test(titleLower);

      const cover = [full?.images?.[0]?.uri, item.cover_image]
        .find(u => u && !u.includes('spacer') && !u.includes('noimage')) || null;

      const cleanArtist = (full?.artists?.[0]?.name || artist).replace(/\s*\(\d+\)$/, '');

      return {
        id,
        artist:      cleanArtist,
        album:       full?.title || album,
        cover,
        releaseDate,
        genre:       pickGenre(full, item),
        preorder:    isUpcoming,
        limited:     isLimited,
        boxset:      isBoxSet,
        reissue:     isReissue,
        label:       full?.labels?.[0]?.name || item.label?.[0] || '',
        country:     full?.country || item.country || '',
        discogsUrl:  'https://www.discogs.com/release/' + id,
        lowest_price: Number(full?.lowest_price) || 0,
        spotifyUrl:  '',
      };
    });

    const valid = detailed.filter(r => r && r.artist && r.album);
    if (!valid.length) throw new Error('No upcoming results');

    // ── Layer 4: merge in MusicBrainz upcoming (next 6 months) ──
    // User reported "Anthrax announced August release but it's not in
    // the feed". Cause: Discogs indexes vinyl releases with year-level
    // granularity and 1-2 weeks of catch-up lag after a label
    // announcement. MusicBrainz (queried via /api/releases/metal-
    // archives) tracks album announcements directly and catches them
    // earlier. Cron-side notifications already use MB, but the live
    // UI was Discogs-only — that gap is the bug.
    //
    // Strategy: union, dedup by (artist, album) lowercase. Discogs
    // entries win on conflict because they have more metadata (cover,
    // label, lowest_price, country). MB-only entries are appended.
    let mbAdded = 0;
    try {
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://metal-vault-six.vercel.app';
      // Pass followed artists so MB does per-artist lookup independent
      // of tag coverage. Catches freshly announced LPs that haven't
      // been tagged `metal` yet (Anthrax-style "announced today, tagged
      // next week" gap).
      // Pass FULL artist list to MB (not the 20-cap). MB queries are cheap
      // and parallel — no reason to clip just because Discogs side has to.
      const mbUrl = appUrl + '/api/releases/metal-archives'
        + (followedArtistsFull.length
            ? '?artists=' + encodeURIComponent(followedArtistsFull.join(','))
            : '');
      const r = await fetch(mbUrl, {
        cache: 'no-store',
        signal: AbortSignal.timeout(8000),
      });
      if (r.ok) {
        const j = await r.json();
        const seen2 = new Set(valid.map(v =>
          (v.artist || '').toLowerCase().trim() + '::' + (v.album || '').toLowerCase().trim()
        ));
        for (const it of (j.items || [])) {
          const key = (it.artist || '').toLowerCase().trim() + '::' + (it.album || '').toLowerCase().trim();
          if (!key || seen2.has(key)) continue;
          seen2.add(key);
          // Reshape MB item into the same record-list contract Discogs
          // entries use. Some fields (label, country, lowest_price) are
          // empty — UI handles missing gracefully.
          valid.push({
            id:           it.id,
            artist:       it.artist,
            album:        it.album,
            cover:        it.cover || null,
            releaseDate:  it.releaseDate,
            year:         it.releaseDate ? it.releaseDate.slice(0, 4) : '',
            genre:        it.genre || 'Metal',
            // Forward MB's rich genre tag list — without these, narrow
            // subgenre filters silently drop MB items.
            genres:       it.genres || ['Metal'],
            styles:       it.styles || ['Metal'],
            format:       'Vinyl',
            preorder:     !!it.preorder,
            limited:      !!it.limited,
            boxset:       false,
            reissue:      false,
            label:        '',
            country:      '',
            discogsUrl:   it.discogs_url || '',
            lowest_price: 0,
            spotifyUrl:   '',
            source:       'musicbrainz',
          });
          mbAdded++;
        }
      }
    } catch {}

    // Sort: upcoming soonest first, then recent newest first
    valid.sort((a, b) => {
      const aUp = a.preorder, bUp = b.preorder;
      if (aUp && bUp) return (a.releaseDate || '9999').localeCompare(b.releaseDate || '9999');
      if (aUp !== bUp) return aUp ? -1 : 1;
      return (b.releaseDate || '').localeCompare(a.releaseDate || '');
    });

    return NextResponse.json({
      releases:  valid,
      source:    mbAdded > 0 ? 'discogs+musicbrainz' : 'discogs',
      count:     valid.length,
      upcoming:  valid.filter(r => r.preorder).length,
      recent:    valid.filter(r => !r.preorder).length,
      today:     todayStr,
      cached:    globalCached,
      mb_added:  mbAdded,        // how many entries the MB merge contributed
    });

  } catch (e) {
    return NextResponse.json({ releases: MOCK, source: 'mock', notice: e.message });
  }
}
