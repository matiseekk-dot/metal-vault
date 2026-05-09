// ── Listen stats aggregation ─────────────────────────────────
//
// GET /api/listens/stats
//
// Returns a single payload with everything the Stats UI needs:
//   {
//     total:     { allTime, last30d, last90d, last365d },     // VINYL only
//     topPlayed: [{ id, artist, album, play_count, cover, last_played_at }, ...],
//     dust:      [{ id, artist, album, days_since, cover }, ...],
//     streak:    { current_days, longest_days, last_played_at },
//     heatmap:   { '2026-04-30': 3, '2026-05-01': 1, ... },   // last 12 mo, VINYL
//     streaming: {                                              // NEW (033)
//       total: { allTime, last30d },
//       topStreamed: [{ id, artist, album, streaming_count, cover }, ...],
//       sources: { spotify: <count>, lastfm: <count> }
//     }
//   }
//
// All counts are VINYL-only by default — the original use case
// ("dust collection", "haven't played in N days", "longest streak")
// only makes sense for physical interaction. Streaming gets its own
// block so the UI can render a separate card without conflating
// the two signals.
//
// Why one route instead of four? The Stats tab renders all sections
// together — one round-trip is faster and cheaper than four.
//
// Auth: standard. Anonymous → 401.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';

const DAY_MS  = 24 * 60 * 60 * 1000;
const NOW     = () => Date.now();

// ── Compute current + longest streak from a list of unique play days
function computeStreak(playDays /* sorted asc */) {
  if (playDays.length === 0) return { current_days: 0, longest_days: 0 };

  const today    = new Date(); today.setHours(0,0,0,0);
  const todayMs  = today.getTime();
  const dayKey   = (ms) => { const d = new Date(ms); d.setHours(0,0,0,0); return d.getTime(); };
  const days     = [...new Set(playDays.map(dayKey))].sort((a, b) => a - b);

  // Longest streak — walk forward grouping consecutive days
  let longest = 1, run = 1;
  for (let i = 1; i < days.length; i++) {
    if (days[i] - days[i - 1] === DAY_MS) { run++; longest = Math.max(longest, run); }
    else                                  { run = 1; }
  }

  // Current streak — count back from today (or yesterday if no play today)
  let current = 0;
  let cursor  = todayMs;
  if (!days.includes(cursor)) cursor -= DAY_MS;   // grace: yesterday counts
  while (days.includes(cursor)) {
    current++;
    cursor -= DAY_MS;
  }

  return { current_days: current, longest_days: longest };
}

export async function GET(req) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const now      = NOW();
  const cut30    = new Date(now - 30  * DAY_MS).toISOString();
  const cut90    = new Date(now - 90  * DAY_MS).toISOString();
  const cut365   = new Date(now - 365 * DAY_MS).toISOString();

  // Single fetch of the last year of VINYL play timestamps + item_ids
  // — drives total counts, heatmap, and streak. Streaming is a
  // separate query at the end so the original signals stay clean.
  //
  // FALLBACK: migration 033 added the `source` column. If it hasn't
  // run yet, filtering by `source='vinyl'` 500s on the column-not-found
  // PG error and the whole stats endpoint goes dark — which the user
  // sees as "scrobbling section disappeared". Try the new query first;
  // on a 42703-class error fall back to the legacy query that uses
  // `notes` markers ('[spotify]' / '[lastfm]') the sync routes
  // historically wrote, so an unmigrated database degrades gracefully
  // rather than crashing.
  let recentLogs = null;
  let logsErr    = null;
  {
    const r1 = await sb
      .from('listen_logs')
      .select('id, collection_item_id, played_at, source')
      .eq('user_id', user.id)
      .eq('source', 'vinyl')
      .gte('played_at', cut365)
      .order('played_at', { ascending: true });
    if (r1.error && /column.*source|does not exist/i.test(r1.error.message || '')) {
      // migration 033 not applied — legacy fallback
      const r2 = await sb
        .from('listen_logs')
        .select('id, collection_item_id, played_at, notes')
        .eq('user_id', user.id)
        .gte('played_at', cut365)
        .order('played_at', { ascending: true });
      recentLogs = (r2.data || []).filter(l => l.notes !== '[spotify]' && l.notes !== '[lastfm]');
      logsErr    = r2.error;
    } else {
      recentLogs = r1.data;
      logsErr    = r1.error;
    }
  }
  if (logsErr) return NextResponse.json({ error: logsErr.message }, { status: 500 });

  const logs    = recentLogs || [];
  const ms30    = now - 30  * DAY_MS;
  const ms90    = now - 90  * DAY_MS;

  let count30 = 0, count90 = 0;
  for (const l of logs) {
    const t = new Date(l.played_at).getTime();
    if (t >= ms30) count30++;
    if (t >= ms90) count90++;
  }

  // All-time count from the cheap `play_count` column
  const { data: allCount } = await sb
    .from('collection')
    .select('play_count.sum()')
    .eq('user_id', user.id)
    .single();
  const totalAllTime = allCount?.sum || logs.length;   // fallback for older PostgREST

  // ── Top-played records (denormalized counter — fast) ────────
  const { data: topPlayed } = await sb
    .from('collection')
    .select('id, artist, album, cover, play_count, last_played_at')
    .eq('user_id', user.id)
    .gt('play_count', 0)
    .order('play_count', { ascending: false })
    .order('last_played_at', { ascending: false })
    .limit(10);

  // ── Dust collection: 0 plays OR not played in 90+ days ──────
  // Only show records actually in the collection (some users have huge
  // wantlists but no plays — that's expected, not "dust").
  const dustCutoff = new Date(now - 90 * DAY_MS).toISOString();
  const { data: dustItems } = await sb
    .from('collection')
    .select('id, artist, album, cover, last_played_at, play_count, added_at')
    .eq('user_id', user.id)
    .or(`last_played_at.is.null,last_played_at.lt.${dustCutoff}`)
    .order('last_played_at', { ascending: true, nullsFirst: true })
    .limit(8);

  const dust = (dustItems || []).map(i => {
    const ref = i.last_played_at || i.added_at;
    const days = ref ? Math.floor((now - new Date(ref).getTime()) / DAY_MS) : null;
    return {
      id:         i.id,
      artist:     i.artist,
      album:      i.album,
      cover:      i.cover,
      play_count: i.play_count,
      days_since: days,
      // never_played helps the UI render different copy ("never played"
      // vs "haven't played in N days")
      never_played: i.play_count === 0,
    };
  });

  // ── Streak (current + longest) ──────────────────────────────
  const playMs = logs.map(l => new Date(l.played_at).getTime());
  const streak = computeStreak(playMs);
  const lastPlayedAt = logs.length > 0 ? logs[logs.length - 1].played_at : null;

  // ── Heatmap (last 12 mo, count per day) ─────────────────────
  // Date keys in YYYY-MM-DD. Skip days with zero — UI shows blanks.
  const heatmap = {};
  for (const l of logs) {
    const key = l.played_at.slice(0, 10);   // ISO is YYYY-MM-DDT...
    heatmap[key] = (heatmap[key] || 0) + 1;
  }

  // ── Streaming block ────────────────────────────────────────
  // Source of truth is streaming_history (migrations 034 + 035) —
  // for Last.fm we sync via getTopAlbums which writes one
  // pre-aggregated row per album with play_count = the API's
  // playcount, so SUM(play_count) IS the total. The previous
  // version read `collection.streaming_count` denormalized counter,
  // but that's only updated by the listen_logs trigger — Last.fm's
  // top-albums sync bypasses listen_logs entirely so the denormalized
  // counter stayed at 0 even with thousands of scrobbles imported.
  //
  // Fault-tolerance: any branch that 42703s (column missing) or
  // 42P01s (table missing) silently zeroes its segment so stats
  // payload always returns something the UI can render.
  let streaming = { total: { allTime: 0, last30d: 0 }, topStreamed: [], sources: {} };
  try {
    const sources = { spotify: 0, lastfm: 0 };
    let stream30      = 0;
    let streamAllTime = 0;
    let topStream     = [];

    // All-time aggregate from streaming_history.
    const rAll = await sb
      .from('streaming_history')
      .select('source, play_count, played_at, matched_collection_id')
      .eq('user_id', user.id);
    if (!rAll.error) {
      for (const row of (rAll.data || [])) {
        const n = Number(row.play_count) || 1;
        streamAllTime += n;
        // Per-source breakdown — last 30d
        if (new Date(row.played_at).getTime() >= now - 30 * DAY_MS) {
          stream30 += n;
          if (sources[row.source] != null) sources[row.source] += n;
        }
      }
    } else if (!/relation.*streaming_history|column.*play_count|does not exist/i.test(rAll.error.message || '')) {
      // Unknown error — keep silent.
    }

    // Top streamed FROM the user's collection (= albums you own AND
    // stream a lot). Reuses the matched_collection_id link from
    // sync time — single query, no extra join.
    const rTop = await sb
      .from('streaming_history')
      .select('matched_collection_id, play_count')
      .eq('user_id', user.id)
      .not('matched_collection_id', 'is', null);
    if (!rTop.error) {
      const sums = new Map();
      for (const row of (rTop.data || [])) {
        const id = row.matched_collection_id;
        const n  = Number(row.play_count) || 1;
        sums.set(id, (sums.get(id) || 0) + n);
      }
      const topIds = [...sums.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([id]) => id);
      if (topIds.length > 0) {
        const { data: collRows } = await sb
          .from('collection')
          .select('id, artist, album, cover, play_count')
          .in('id', topIds);
        topStream = (collRows || [])
          .map(c => ({ ...c, streaming_count: sums.get(c.id) || 0 }))
          .sort((a, b) => b.streaming_count - a.streaming_count);
      }
    }

    streaming = {
      total: { allTime: streamAllTime, last30d: stream30 },
      topStreamed: topStream,
      sources,
    };
  } catch {
    // never propagate — UI hides the streaming card when allTime===0
  }

  return NextResponse.json({
    total: {
      allTime:   totalAllTime,
      last30d:   count30,
      last90d:   count90,
      last365d:  logs.length,
    },
    topPlayed: topPlayed || [],
    dust,
    streak: { ...streak, last_played_at: lastPlayedAt },
    heatmap,
    streaming,
  });
}
