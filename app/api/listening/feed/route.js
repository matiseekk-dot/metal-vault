// ── /api/listening/feed — unified vinyl + streaming feed ─────────
//
// Powers the Vault → Scrobbling tab. Merges three sources into one
// chronological list, filterable by source:
//
//   1. listen_logs source='vinyl'    → physical spins (manual ListenButton)
//   2. listen_logs source='spotify'  → Spotify per-track scrobbles (matched)
//   3. streaming_history source='lastfm' → Last.fm aggregated top-album rows
//
// Each item carries enough info for the UI to render the correct
// badge + action without further fetches:
//   - kind: 'vinyl' | 'spotify' | 'lastfm'
//   - artist, album, cover
//   - played_at (timestamp; for Last.fm aggregates this is the synced-at
//     marker, NOT actual play time, so the UI labels these as "top albums"
//     not "played at HH:MM")
//   - in_collection (bool) — drives the ✓ badge vs "Brak na winylu" CTA
//   - collection_id (nullable) — links the row to VinylModal on tap
//   - play_count (int) — 1 for individual scrobbles, N for Last.fm aggregates
//   - watched (bool, lastfm only) — already in user's watchlist
//
// Query: ?source=all|vinyl|streaming|spotify|lastfm&limit=50
// Default: all sources, 50 items.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';

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

export async function GET(request) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url    = new URL(request.url);
  const source = url.searchParams.get('source') || 'all';
  // Cap at 5000 — power users with 15+ years of scrobbling commonly hit
  // 1k-3k unique albums; we need headroom to return "the whole history"
  // in a single call. 5000 rows × ~250 bytes payload = ~1.2MB JSON, fine
  // for one page render. Anything beyond that is paginated client-side.
  const limit  = Math.min(parseInt(url.searchParams.get('limit') || '50', 10), 5000);

  // Time-range filter. Applied to listen_logs.played_at (vinyl + spotify
  // have real per-event timestamps). Last.fm aggregates use synthetic
  // played_at (sync time) so a since-filter would be meaningless — for
  // any non-"all" range we skip the lastfm pull entirely.
  const sinceParam = url.searchParams.get('since') || 'all';
  let sinceIso = null;
  if (sinceParam === '30d')  sinceIso = new Date(Date.now() -  30*86400000).toISOString();
  else if (sinceParam === '90d')  sinceIso = new Date(Date.now() -  90*86400000).toISOString();
  else if (sinceParam === '365d') sinceIso = new Date(Date.now() - 365*86400000).toISOString();

  const items = [];

  // ── 1. Pull listen_logs (vinyl + spotify) ───────────────────
  // Both source types aggregated per album now: each row in the feed
  // represents one album with play_count = number of spins/scrobbles
  // and played_at = most recent. User wanted symmetry between vinyl
  // and digital views — "5× plays" reads the same for both sources.
  // Per-event detail still available in VinylModal on row tap.
  if (source === 'all' || source === 'vinyl' || source === 'spotify' || source === 'streaming') {
    const sourceFilter = source === 'vinyl'    ? ['vinyl']
                       : source === 'spotify'  ? ['spotify']
                       : source === 'streaming'? ['spotify']  // listen_logs only has spotify under "streaming"
                       :                         ['vinyl', 'spotify'];

    // Pull a wide window so per-album aggregation has enough raw events
    // to roll up. 5 spins of an album collapse to 1 row, but we need
    // the raw 5 to count them.
    const RAW_LIMIT = 5000;

    let q = sb.from('listen_logs')
      .select('id, played_at, source, collection_item_id, collection:collection_item_id(id, artist, album, cover)')
      .eq('user_id', user.id)
      .in('source', sourceFilter)
      .order('played_at', { ascending: false })
      .limit(RAW_LIMIT);
    if (sinceIso) q = q.gte('played_at', sinceIso);
    let r1 = await q;
    if (r1.error && /column.*source|does not exist/i.test(r1.error.message || '')) {
      // pre-033 fallback: no source column, treat all as vinyl
      let q2 = sb.from('listen_logs')
        .select('id, played_at, collection_item_id, collection:collection_item_id(id, artist, album, cover)')
        .eq('user_id', user.id)
        .order('played_at', { ascending: false })
        .limit(RAW_LIMIT);
      if (sinceIso) q2 = q2.gte('played_at', sinceIso);
      r1 = await q2;
    }

    // Per-album buckets, keyed by (kind, collection.id). Same album played
    // on vinyl AND via Spotify gets two rows so the user can see both
    // engagement modes side by side.
    const buckets = new Map();   // key = `${kind}::${collectionId}`

    for (const row of (r1.data || [])) {
      if (!row.collection) continue;   // FK orphan — skip
      const kind = row.source || 'vinyl';
      const id   = row.collection.id;
      const key  = kind + '::' + id;
      let b = buckets.get(key);
      if (!b) {
        b = {
          kind,
          played_at:     row.played_at,
          artist:        row.collection.artist,
          album:         row.collection.album,
          cover:         row.collection.cover,
          in_collection: true,
          collection_id: id,
          play_count:    0,
          watched:       false,
        };
        buckets.set(key, b);
      }
      b.play_count++;
      // rows arrive ordered by played_at desc, so the first time we see
      // a bucket its played_at is already the most recent — leave it.
    }

    items.push(...buckets.values());
  }

  // ── 2. Pull streaming_history rows (Last.fm aggregates) ────
  // Only when filter allows lastfm/streaming. Each row = one album
  // with play_count = N. matched_collection_id tells us if user owns it.
  //
  // Last.fm: played_at is now the REAL date of the most-recent scrobble
  // per album (sync route writes date.uts × 1000 from getRecentTracks).
  // So the since-filter naturally semantics-matches: "albums played in
  // the last 30 days" → played_at >= now - 30d. Old sync rows (pre-fix)
  // still carry a synthetic played_at ≈ sync time, which for users who
  // sync'd recently lands inside the 30d window anyway (visible, just
  // not date-accurate per individual play) — next sync upgrades them.
  if (source === 'all' || source === 'lastfm' || source === 'streaming') {
    // Pull a buffer beyond the requested limit so the dedupe pass below
    // has enough source rows to merge — old syncs (pre-dedup fix) may
    // have inserted the same album 3-5x, so without padding we'd return
    // fewer unique albums than the user asked for. Post-fix syncs are
    // already clean so the buffer mostly doesn't kick in.
    //
    // Supabase + PostgREST default has a soft cap around 1000 rows per
    // query unless ranged. We use range() to defeat that ceiling for
    // power users with thousands of unique albums.
    const RAW_LIMIT = Math.min(limit + 500, 10000);

    // Order column: when the user picks the 30d range, sort by
    // recent_play_count so the top of the list is "what you actually
    // played this month, most-played first". Other ranges sort by
    // lifetime play_count (the recent column is a single 30-day window
    // — meaningless for the 90d/365d/all-time views).
    const orderColumn = sinceParam === '30d' ? 'recent_play_count' : 'play_count';

    let q2 = sb
      .from('streaming_history')
      .select('artist, album, artist_norm, album_norm, played_at, source, matched_collection_id, play_count, recent_play_count')
      .eq('user_id', user.id)
      .eq('source', 'lastfm');
    if (sinceIso) q2 = q2.gte('played_at', sinceIso);
    let r2 = await q2
      .order(orderColumn, { ascending: false })
      .range(0, RAW_LIMIT - 1);
    // Migration 045 (recent_play_count) not applied yet — retry without it.
    // Fall back to play_count even for the 30d view (better than no data).
    if (r2.error && /recent_play_count/i.test(r2.error.message || '')) {
      let q2r = sb
        .from('streaming_history')
        .select('artist, album, artist_norm, album_norm, played_at, source, matched_collection_id, play_count')
        .eq('user_id', user.id)
        .eq('source', 'lastfm');
      if (sinceIso) q2r = q2r.gte('played_at', sinceIso);
      r2 = await q2r
        .order('play_count', { ascending: false })
        .range(0, RAW_LIMIT - 1);
    }
    if (r2.error && /column.*play_count|does not exist/i.test(r2.error.message || '')) {
      let q2b = sb
        .from('streaming_history')
        .select('artist, album, artist_norm, album_norm, played_at, source, matched_collection_id')
        .eq('user_id', user.id)
        .eq('source', 'lastfm');
      if (sinceIso) q2b = q2b.gte('played_at', sinceIso);
      r2 = await q2b
        .order('played_at', { ascending: false })
        .range(0, RAW_LIMIT - 1);
    }

    if (r2.error && /relation.*streaming_history|does not exist/i.test(r2.error.message || '')) {
      // Migration 034 not applied yet — silent skip, vinyl items still flow.
    } else if (r2.data) {
      // Dedupe by (artist_norm, album_norm) — old sync runs (pre-dedup
      // fix) may have inserted the same album multiple times. We sum
      // their play_counts and keep the row with a matched_collection_id
      // (so the OWNED badge survives the merge).
      const lastfmBuckets = new Map();
      for (const row of r2.data) {
        const key = (row.artist_norm || normaliseArtist(row.artist)) + '::' +
                    (row.album_norm  || normaliseAlbumTitle(row.album));
        const existing = lastfmBuckets.get(key);
        if (existing) {
          existing.play_count += Number(row.play_count) || 1;
          existing.recent_play_count += Number(row.recent_play_count) || 0;
          existing.matched_collection_id = existing.matched_collection_id || row.matched_collection_id;
          if (row.played_at > existing.played_at) existing.played_at = row.played_at;
        } else {
          lastfmBuckets.set(key, {
            artist:                row.artist,
            album:                 row.album,
            artist_norm:           row.artist_norm,
            album_norm:            row.album_norm,
            played_at:             row.played_at,
            matched_collection_id: row.matched_collection_id,
            play_count:            Number(row.play_count) || 1,
            recent_play_count:     Number(row.recent_play_count) || 0,
          });
        }
      }
      const deduped = [...lastfmBuckets.values()];

      // Resolve cover for matched ones in one batch.
      const matchedIds = deduped
        .map(r => r.matched_collection_id)
        .filter(Boolean);
      const coversByCollectionId = new Map();
      if (matchedIds.length > 0) {
        const { data: cols } = await sb
          .from('collection')
          .select('id, cover')
          .in('id', matchedIds);
        for (const c of (cols || [])) coversByCollectionId.set(c.id, c.cover);
      }

      // Pull watchlist once for "watched" badge.
      const { data: watchlist } = await sb.from('watchlist')
        .select('artist, album')
        .eq('user_id', user.id);
      const watchKeys = new Set(
        (watchlist || []).map(w => normaliseArtist(w.artist) + '::' + normaliseAlbumTitle(w.album))
      );

      for (const row of deduped) {
        items.push({
          kind:          'lastfm',
          played_at:     row.played_at,
          artist:        row.artist,
          album:         row.album,
          cover:         row.matched_collection_id
            ? coversByCollectionId.get(row.matched_collection_id) || null
            : null,
          in_collection: !!row.matched_collection_id,
          collection_id: row.matched_collection_id || null,
          play_count:    Number(row.play_count) || 1,
          // recent_play_count (migration 045) — populated by the sync
          // route counting scrobbles whose date.uts is within 30 days.
          // UI shows this instead of lifetime play_count when the
          // user selects '30 days' in the listening tab filter.
          recent_play_count: Number(row.recent_play_count) || 0,
          watched:       watchKeys.has((row.artist_norm || normaliseArtist(row.artist)) + '::' + (row.album_norm || normaliseAlbumTitle(row.album))),
        });
      }
    }
  }

  // Unified sort. When the 30d range is active and the item carries
  // recent_play_count (Last.fm rows do; vinyl/spotify don't yet — they
  // fall back to play_count), sort by recent count so 'most listened
  // last month' surfaces at the top. Otherwise sort by lifetime.
  // Tiebreaker: most recent activity wins, so two albums each played
  // 3 times put yesterday's above the one from 6 months ago.
  const sortFieldOf = sinceParam === '30d'
    ? (x) => (typeof x.recent_play_count === 'number'
        ? x.recent_play_count
        : (x.play_count || 0))
    : (x) => (x.play_count || 0);

  items.sort((a, b) => {
    const pc = sortFieldOf(b) - sortFieldOf(a);
    if (pc !== 0) return pc;
    return String(b.played_at || '').localeCompare(String(a.played_at || ''));
  });

  return NextResponse.json({
    items: items.slice(0, limit),
    total: items.length,
  });
}
