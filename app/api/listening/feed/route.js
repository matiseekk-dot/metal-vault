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
  const limit  = Math.min(parseInt(url.searchParams.get('limit') || '50', 10), 200);

  const items = [];

  // ── 1. Pull listen_logs (vinyl + spotify per-track) ─────────
  // Only when filter allows. listen_logs has collection_item_id FK
  // so we already know in_collection = true for every row here.
  if (source === 'all' || source === 'vinyl' || source === 'spotify' || source === 'streaming') {
    const sourceFilter = source === 'vinyl'    ? ['vinyl']
                       : source === 'spotify'  ? ['spotify']
                       : source === 'streaming'? ['spotify']  // listen_logs only has spotify under "streaming"
                       :                         ['vinyl', 'spotify'];

    let q = sb.from('listen_logs')
      .select('id, played_at, source, collection_item_id, collection:collection_item_id(id, artist, album, cover)')
      .eq('user_id', user.id)
      .order('played_at', { ascending: false })
      .limit(limit);

    // source filter — listen_logs migrated table
    let r1 = await q.in('source', sourceFilter);
    if (r1.error && /column.*source|does not exist/i.test(r1.error.message || '')) {
      // pre-033 fallback: no source column, treat all as vinyl
      r1 = await sb.from('listen_logs')
        .select('id, played_at, collection_item_id, collection:collection_item_id(id, artist, album, cover)')
        .eq('user_id', user.id)
        .order('played_at', { ascending: false })
        .limit(limit);
    }

    for (const row of (r1.data || [])) {
      if (!row.collection) continue;   // FK orphan — skip
      items.push({
        kind:           row.source || 'vinyl',
        played_at:      row.played_at,
        artist:         row.collection.artist,
        album:          row.collection.album,
        cover:          row.collection.cover,
        in_collection:  true,
        collection_id:  row.collection.id,
        play_count:     1,
        watched:        false,
      });
    }
  }

  // ── 2. Pull streaming_history rows (Last.fm aggregates) ────
  // Only when filter allows lastfm/streaming. Each row = one album
  // with play_count = N. matched_collection_id tells us if user owns it.
  if (source === 'all' || source === 'lastfm' || source === 'streaming') {
    let r2 = await sb
      .from('streaming_history')
      .select('artist, album, artist_norm, album_norm, played_at, source, matched_collection_id, play_count')
      .eq('user_id', user.id)
      .eq('source', 'lastfm')
      .order('play_count', { ascending: false })
      .limit(limit);
    if (r2.error && /column.*play_count|does not exist/i.test(r2.error.message || '')) {
      r2 = await sb
        .from('streaming_history')
        .select('artist, album, artist_norm, album_norm, played_at, source, matched_collection_id')
        .eq('user_id', user.id)
        .eq('source', 'lastfm')
        .order('played_at', { ascending: false })
        .limit(limit);
    }

    if (r2.error && /relation.*streaming_history|does not exist/i.test(r2.error.message || '')) {
      // Migration 034 not applied yet — silent skip, vinyl items still flow.
    } else if (r2.data) {
      // Resolve cover for matched ones in one batch.
      const matchedIds = r2.data
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

      for (const row of r2.data) {
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
          watched:       watchKeys.has(row.artist_norm + '::' + row.album_norm),
        });
      }
    }
  }

  // Sort:
  //   • Last.fm aggregates by play_count desc (high engagement on top)
  //   • listen_logs by played_at desc (recent on top)
  // Mixed source default: aggregates first, then chronological vinyl/spotify.
  if (source === 'lastfm') {
    items.sort((a, b) => (b.play_count || 0) - (a.play_count || 0));
  } else if (source === 'vinyl' || source === 'spotify') {
    items.sort((a, b) => String(b.played_at).localeCompare(String(a.played_at)));
  } else {
    // ALL — show Last.fm top first, then chronological listens
    const aggs    = items.filter(i => i.kind === 'lastfm');
    const tracks  = items.filter(i => i.kind !== 'lastfm');
    aggs.sort((a, b) => (b.play_count || 0) - (a.play_count || 0));
    tracks.sort((a, b) => String(b.played_at).localeCompare(String(a.played_at)));
    items.length = 0;
    items.push(...aggs, ...tracks);
  }

  return NextResponse.json({
    items: items.slice(0, limit),
    total: items.length,
  });
}
