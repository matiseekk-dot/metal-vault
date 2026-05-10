// ── /api/recommendations — "if you like X+Y try Z" ─────────────
//
// Pulls the user's top engaged artists (from streaming + vinyl plays)
// and queries Last.fm getSimilar for each. Aggregates the results by
// artist with a "score" = sum of (similarity × source weight) so artists
// matching MULTIPLE of your favourites rank higher than ones similar to
// just one. Filters out artists you already follow / own.
//
// Why this works: getSimilarArtists is Last.fm's own collaborative
// filtering output — "people who listen to Mayhem also listen to..."
// Aggregating across 5 of your top artists removes the worst noise
// (e.g. "Mayhem similar = Burzum" by itself is obvious; cross-referencing
// with your other faves picks the less obvious recommendations they BOTH
// share, which is where the discovery value lives).
//
// Cache: 24h per-user in discogs_cache (`recos:user:{userId}`). Last.fm
// data doesn't change fast enough to warrant fresher; computation is
// 5 × ~300ms = ~1.5s, fine to do on demand if cache is cold.

import { NextResponse } from 'next/server';
import { createClient, getAdminClient } from '@/lib/supabase-server';
import { getSimilarArtists } from '@/lib/lastfm';

export const dynamic = 'force-dynamic';

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const TOP_N_SEEDS  = 5;     // pull 5 most-engaged artists as similarity seeds
const PER_SEED     = 20;    // Last.fm returns up to 20 similar per seed
const RESULT_LIMIT = 12;    // recommendations returned to UI

// Cheap normaliser for deduping — matches the ones in the sync routes
// so "Mayhem" / "Mayhem (2)" / "MAYHEM" collide correctly.
function norm(s) {
  return String(s || '').toLowerCase().trim()
    .replace(/\s*\(\d+\)\s*$/, '')
    .replace(/\s+/g, ' ');
}

async function readCache(admin, key) {
  try {
    const { data } = await admin.from('discogs_cache')
      .select('data, created_at')
      .eq('cache_key', key)
      .single();
    if (!data) return null;
    if (Date.now() - new Date(data.created_at).getTime() > CACHE_TTL_MS) return null;
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

export async function GET() {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = getAdminClient();
  const cacheKey = 'recos:user:' + user.id;

  const force = false;   // hook for ?force=1 if we ever need it
  if (!force) {
    const cached = await readCache(admin, cacheKey);
    if (cached) return NextResponse.json({ ...cached, fromCache: true });
  }

  // ── 1. Build the "seed" list: top engaged artists ────────────
  // Three signal sources, weighted by trust:
  //   • vinyl spins   — strongest, user physically chose to play
  //   • Spotify       — moderate, automated but per-track
  //   • Last.fm       — high volume, may include incidental scrobbles
  // Sum play_count per artist across sources; pick top N.
  const seedMap = new Map();   // artistNorm → { name, score }
  const seedKey = (raw) => {
    const k = norm(raw);
    return k || null;
  };

  // Listening logs (vinyl + spotify) — these are FK-bound to collection,
  // so the join brings the canonical artist name.
  try {
    const { data: logs } = await admin
      .from('listen_logs')
      .select('source, collection:collection_item_id(artist)')
      .eq('user_id', user.id)
      .limit(5000);
    for (const r of (logs || [])) {
      const name = r.collection?.artist;
      const k = seedKey(name);
      if (!k) continue;
      const weight = r.source === 'vinyl' ? 3 : 1;
      const ex = seedMap.get(k) || { name, score: 0 };
      ex.score += weight;
      seedMap.set(k, ex);
    }
  } catch {}

  // Streaming history (Last.fm aggregated) — each row carries play_count
  // so engagement is proportional.
  try {
    const { data: stream } = await admin
      .from('streaming_history')
      .select('artist, play_count')
      .eq('user_id', user.id)
      .eq('source', 'lastfm')
      .order('play_count', { ascending: false })
      .limit(500);
    for (const r of (stream || [])) {
      const k = seedKey(r.artist);
      if (!k) continue;
      // Last.fm playcount can be huge (hundreds), normalise to a 0-30 band
      // so a single super-heavy artist doesn't dominate the seed pool.
      const w = Math.min(30, Math.log2(Math.max(1, Number(r.play_count) || 1)) * 3);
      const ex = seedMap.get(k) || { name: r.artist, score: 0 };
      ex.score += w;
      seedMap.set(k, ex);
    }
  } catch {}

  // Rank seeds and trim to top N.
  const seeds = [...seedMap.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, TOP_N_SEEDS);

  if (seeds.length === 0) {
    return NextResponse.json({
      seeds: [],
      recommendations: [],
      message: 'Not enough listening data yet — play some records or scrobble.',
    });
  }

  // ── 2. For each seed, fetch similar artists from Last.fm ────
  // Sequential to keep us safely under Last.fm's 5/sec ceiling. 5 calls
  // × ~300ms = ~1.5s total per cold request.
  const similarLists = [];
  for (const seed of seeds) {
    try {
      const sim = await getSimilarArtists(seed.name, PER_SEED);
      similarLists.push({ seed: seed.name, list: sim });
    } catch {
      similarLists.push({ seed: seed.name, list: [] });
    }
  }

  // ── 3. Exclude artists the user already engages with ─────────
  // Owned + already-followed = "stop recommending things I obviously know".
  const excludeKeys = new Set();
  try {
    const { data: collection } = await admin
      .from('collection').select('artist').eq('user_id', user.id);
    for (const r of (collection || [])) {
      const k = norm(r.artist);
      if (k) excludeKeys.add(k);
    }
  } catch {}
  try {
    const { data: follows } = await admin
      .from('artist_follows').select('artist_name').eq('user_id', user.id);
    for (const r of (follows || [])) {
      const k = norm(r.artist_name);
      if (k) excludeKeys.add(k);
    }
  } catch {}
  // Also exclude the seeds themselves — recommending "you might like Mayhem"
  // to a Mayhem fan is useless.
  for (const seed of seeds) {
    const k = norm(seed.name);
    if (k) excludeKeys.add(k);
  }

  // ── 4. Aggregate: artists appearing across multiple seeds rank
  //    highest. Score per artist = sum(similarity × seedWeight).
  const recoMap = new Map();   // artistNorm → { name, score, becauseOf: [] }
  for (const { seed, list } of similarLists) {
    const seedObj = seeds.find(s => s.name === seed);
    const seedWeight = seedObj ? Math.log2(2 + seedObj.score) : 1;
    for (const sim of list) {
      const k = norm(sim.name);
      if (!k || excludeKeys.has(k)) continue;
      const ex = recoMap.get(k) || { name: sim.name, score: 0, becauseOf: [], url: sim.url, mbid: sim.mbid };
      ex.score += (sim.match || 0) * seedWeight;
      // Track which of your seeds led us to this rec — UI shows it as
      // "because you listen to Mayhem + Burzum".
      if (!ex.becauseOf.includes(seed)) ex.becauseOf.push(seed);
      recoMap.set(k, ex);
    }
  }

  const recommendations = [...recoMap.values()]
    .sort((a, b) => {
      // Multi-seed matches first (genuine collaborative-filter signal),
      // then by aggregate score.
      if (b.becauseOf.length !== a.becauseOf.length) {
        return b.becauseOf.length - a.becauseOf.length;
      }
      return b.score - a.score;
    })
    .slice(0, RESULT_LIMIT)
    .map(r => ({
      name:      r.name,
      url:       r.url,
      mbid:      r.mbid,
      score:     Math.round(r.score * 100) / 100,
      becauseOf: r.becauseOf.slice(0, 3),   // UI shows max 3 to stay compact
    }));

  const payload = {
    seeds: seeds.map(s => s.name),
    recommendations,
    generatedAt: new Date().toISOString(),
  };
  await writeCache(admin, cacheKey, payload);
  return NextResponse.json({ ...payload, fromCache: false });
}
