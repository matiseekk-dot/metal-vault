// ── Cache warmer for /api/releases + MusicBrainz per-artist ─────────
// Runs daily at 7:30 UTC (~30 min before daily-digest cron at 8:00).
//
// Two warm-ups:
//
// 1. /api/releases — populates the Discogs Layer 1 + Layer 3 caches.
//
// 2. Per-artist MB cache (NEW) — collects every artist that ANY user
//    follows, fires per-artist MB queries throttled at 1.1s each, and
//    persists results in `discogs_cache` for 24h. Without this, the
//    user-facing /api/releases/metal-archives request burns its
//    5-niecached budget on whichever 5 followed artists hit first;
//    the rest are dropped silently. Pre-warming guarantees every
//    followed band shows up in the feed regardless of who calls
//    when. Critical for the "Anthrax LP missing" class of bugs.

import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';

export const dynamic     = 'force-dynamic';
// Vercel kills /api at 10s/60s without this. MB at 1 req/sec, hundreds
// of unique followed artists across all users — we need minutes.
export const maxDuration = 300;

const MB_UA = 'MetalVault/1.0 (https://metal-vault-six.vercel.app)';
const METAL_TAGS = [
  'metal', 'black-metal', 'death-metal', 'thrash-metal', 'doom-metal',
  'heavy-metal', 'power-metal', 'progressive-metal', 'grindcore', 'sludge',
  'stoner-metal', 'folk-metal', 'melodic-death-metal', 'technical-death-metal',
];
const RL_DELAY_MS = 1100;       // MB anon rate limit: 1 req/sec, +safety margin
const PER_ARTIST_LIMIT = 25;
const WARM_BUDGET_MS = 4 * 60 * 1000;  // 4min; rest of 5min cap for /api/releases warmup

// Baseline popular metal artists — guaranteed coverage for "All Metal"
// feed even if no user follows them yet. Curated for vinyl-collecting
// audience. Same list as in /api/releases/metal-archives route.
const POPULAR_METAL_ARTISTS = [
  'Metallica', 'Megadeth', 'Slayer', 'Anthrax', 'Iron Maiden', 'Judas Priest',
  'Black Sabbath', 'Motörhead', 'Pantera', 'Sepultura', 'Testament', 'Exodus',
  'Overkill', 'Kreator', 'Destruction', 'Sodom', 'Death Angel',
  'Death', 'Morbid Angel', 'Cannibal Corpse', 'Deicide', 'Obituary', 'Suffocation',
  'Immolation', 'Nile', 'Behemoth', 'Vader', 'Decapitated', 'Bloodbath',
  'At the Gates', 'In Flames', 'Dark Tranquillity', 'Arch Enemy', 'Amon Amarth',
  'Children of Bodom', 'Carcass', 'Entombed', 'Dismember', 'Bolt Thrower',
  'Gojira', 'Cattle Decapitation', 'Tomb Mold', 'Blood Incantation',
  'Mayhem', 'Burzum', 'Darkthrone', 'Emperor', 'Immortal', 'Marduk',
  'Dimmu Borgir', 'Cradle of Filth', 'Watain', 'Mgła', 'Batushka',
  'Behexen', 'Taake', 'Enslaved', 'Wolves in the Throne Room',
  'Spectral Wound', 'Krallice',
  'Candlemass', 'Electric Wizard', 'Sleep', 'Saint Vitus', 'Yob',
  'Pallbearer', 'Bell Witch', 'Mastodon', 'Baroness', 'High on Fire',
  'Boris', 'Conan',
  'Tool', 'Opeth', 'Dream Theater', 'Devin Townsend',
  'Between the Buried and Me', 'Leprous', 'Haken', 'Voivod',
  'Blind Guardian', 'Helloween', 'Stratovarius', 'Symphony X', 'Kamelot',
  'Sonata Arctica', 'Wintersun', 'Nightwish', 'Epica',
  'Lamb of God', 'Killswitch Engage', 'Trivium', 'Architects',
  'Parkway Drive', 'August Burns Red', 'Whitechapel', 'Suicide Silence',
  'Lorna Shore', 'Thy Art Is Murder', 'Born of Osiris', 'Veil of Maya',
  'After the Burial', 'Periphery', 'Meshuggah', 'Animals as Leaders',
  'Bring Me the Horizon', 'Spiritbox', 'Sleep Token',
  'Ensiferum', 'Eluveitie', 'Korpiklaani', 'Finntroll', 'Moonsorrow',
  'Tyr', 'Heilung',
  'Furia', 'Riverside', 'Hate', 'Vesania',
  'Sumac', 'Cult of Luna', 'Russian Circles', 'Pelican', 'ISIS',
  'Neurosis', 'Converge', 'Dillinger Escape Plan',
  'Ghost', 'Power Trip', 'Knocked Loose', 'Code Orange',
  'Fit for an Autopsy', 'Frozen Soul',
];

const sleep = ms => new Promise(r => setTimeout(r, ms));

function escArtist(name) {
  return '"' + String(name).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}
function prettyTag(t) {
  return String(t).replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}
function toISO(d) { return d.toISOString().split('T')[0]; }

async function mbFetchArtist(artist, dateFilter, typeFilter) {
  const q = 'artist:' + escArtist(artist) + ' AND ' + dateFilter + ' AND ' + typeFilter;
  const url = 'https://musicbrainz.org/ws/2/release-group/'
    + '?query=' + encodeURIComponent(q)
    + '&limit=' + PER_ARTIST_LIMIT
    + '&offset=0&fmt=json';
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': MB_UA, 'Accept': 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    });
    if (!r.ok) return { ok: false, status: r.status, items: [] };
    const data = await r.json();
    const groups = data['release-groups'] || [];
    const items = groups.map(g => {
      const mbid = g.id;
      const credits = (g['artist-credit'] || []).map(a => a.name || a.artist?.name).filter(Boolean);
      const tagNames = (g.tags || []).map(t => t.name);
      const metalSubTags = tagNames.filter(t => METAL_TAGS.includes(t));
      const allMetalTags = ['metal', ...metalSubTags];
      const uniqueTags = Array.from(new Set(allMetalTags));
      const prettyTags = uniqueTags.map(prettyTag);
      const primaryTag = metalSubTags[0] || tagNames[0] || 'metal';
      const releaseDate = g['first-release-date'] || null;
      return {
        id:             'mb_' + mbid,
        mbid,
        source:         'musicbrainz',
        artist:         credits.join(', ') || 'Unknown',
        album:          g.title || '',
        cover:          'https://coverartarchive.org/release-group/' + mbid + '/front-250',
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
    }).filter(it => it.artist && it.album && it.releaseDate);
    return { ok: true, items };
  } catch (e) {
    return { ok: false, status: 0, items: [], error: e.message };
  }
}

async function warmPerArtistMB(startedAt) {
  // Collect every unique followed artist across all users.
  const { data: follows } = await supabaseAdmin
    .from('artist_follows')
    .select('artist_name');
  const followNames = follows
    ? follows.map(f => (f.artist_name || '').trim()).filter(Boolean)
    : [];

  // Union with hardcoded popular list — guaranteed baseline coverage
  // for the global "All Metal" feed. Dedup case-insensitively.
  const unique = Array.from(new Set(
    [...followNames, ...POPULAR_METAL_ARTISTS].map(n => n.trim()).filter(Boolean)
  ));

  // Build window matching the live endpoint
  const today  = new Date();
  const past   = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
  const future = new Date();
  future.setFullYear(future.getFullYear() + 3);
  const dateFilter = 'firstreleasedate:[' + toISO(past) + ' TO ' + toISO(future) + ']';
  const typeFilter = '(primarytype:Album OR primarytype:EP)';

  let warmed = 0;
  let errors = 0;
  for (const artist of unique) {
    if (Date.now() - startedAt > WARM_BUDGET_MS) {
      return { artistsWarmed: warmed, totalUnique: unique.length, budgetHit: true, errors };
    }
    const key = 'mb:artist:' + artist.toLowerCase().replace(/\s+/g, '_');

    // Skip if already fresh (<22h old) — leave 2h margin for tomorrow's cron
    const { data: existing } = await supabaseAdmin
      .from('discogs_cache')
      .select('created_at')
      .eq('cache_key', key)
      .maybeSingle();
    if (existing) {
      const ageMs = Date.now() - new Date(existing.created_at).getTime();
      if (ageMs < 22 * 60 * 60 * 1000) continue;
    }

    const r = await mbFetchArtist(artist, dateFilter, typeFilter);
    if (r.ok) {
      await supabaseAdmin.from('discogs_cache').upsert(
        { cache_key: key, data: r.items, created_at: new Date().toISOString() },
        { onConflict: 'cache_key' }
      );
      warmed++;
    } else {
      errors++;
    }

    // Throttle to MB's anon rate limit
    await sleep(RL_DELAY_MS);
  }
  return { artistsWarmed: warmed, totalUnique: unique.length, errors };
}

export async function GET(request) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Server misconfigured: CRON_SECRET unset' }, { status: 500 });
  }
  const auth = request.headers.get('authorization');
  if (auth !== 'Bearer ' + process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const start = Date.now();
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://metal-vault-six.vercel.app';

  // Step 1: warm MB per-artist cache (4min budget) — most important for feed quality.
  let mbWarm;
  try {
    mbWarm = await warmPerArtistMB(start);
  } catch (e) {
    mbWarm = { error: e.message };
  }

  // Step 2: warm /api/releases (remaining budget). Discogs auth allows
  // 60 req/min, so Layer 1 finishes inside a minute.
  let dRes;
  try {
    const r = await fetch(baseUrl + '/api/releases', {
      headers: { 'User-Agent': 'MetalVault-CacheWarmer/1.0' },
    });
    dRes = await r.json();
  } catch (e) {
    dRes = { error: e.message };
  }

  return NextResponse.json({
    success:    true,
    mbWarm,
    discogs: {
      source:    dRes?.source,
      cached:    dRes?.cached,
      count:     dRes?.count || 0,
      upcoming:  dRes?.upcoming || 0,
      recent:    dRes?.recent || 0,
      mb_added:  dRes?.mb_added || 0,
    },
    durationMs: Date.now() - start,
  });
}
