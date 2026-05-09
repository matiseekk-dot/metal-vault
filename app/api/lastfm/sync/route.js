// ── /api/lastfm/sync — paginated full-history scrobble import ──
//
// Why getRecentTracks (paginated) and not getTopAlbums (aggregate):
// the Vault → Listen tab needs CHRONOLOGICAL feed of individual
// scrobbles to be useful. getTopAlbums collapses to top-200 per
// period — fine for Discovery aggregation, useless for "what did
// I listen to last Tuesday".
//
// Discovery still works on this shape: every row has play_count = 1
// and Discovery SUMs it. Effectively the same numbers as the
// previous getTopAlbums approach, just with more granular data.
//
// Trade-off: first sync is paginated (~30-60s for a power scrobbler
// with 12k+ tracks in last 12 months). Subsequent syncs incremental
// since last_synced_at — typically <5s.

import { NextResponse } from 'next/server';
import { createClient, getAdminClient } from '@/lib/supabase-server';
import { lastfmRecentTracks, lastfmRecentTracksAll } from '@/lib/lastfm';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;   // 5 min — first-sync backfill headroom

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

export async function GET() {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ connected: false });
  const { data } = await sb.from('lastfm_tokens')
    .select('username, last_synced_at')
    .eq('user_id', user.id)
    .maybeSingle();
  return NextResponse.json({
    connected:    !!data,
    username:     data?.username || null,
    lastSyncedAt: data?.last_synced_at || null,
  });
}

export async function POST(request) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url   = new URL(request.url);
  const force = url.searchParams.get('force') === 'true';

  const admin = getAdminClient();
  const { data: tokenRow, error: tokenErr } = await admin
    .from('lastfm_tokens')
    .select('*')
    .eq('user_id', user.id)
    .single();
  if (tokenErr || !tokenRow) {
    return NextResponse.json({ error: 'Last.fm not connected' }, { status: 400 });
  }

  if (force) {
    await admin.from('lastfm_tokens')
      .update({ last_synced_at: null })
      .eq('user_id', user.id);
    try {
      await admin.from('streaming_history')
        .delete()
        .eq('user_id', user.id)
        .eq('source', 'lastfm');
    } catch {}
    tokenRow.last_synced_at = null;
  }

  // 1) Pull tracks. First sync = paginated up to 1 year back. Subsequent =
  // single page since last_synced_at.
  const isFirstSync = !tokenRow.last_synced_at;
  const fromSec = tokenRow.last_synced_at
    ? Math.floor(new Date(tokenRow.last_synced_at).getTime() / 1000)
    : null;
  const oneYearAgoSec = Math.floor((Date.now() - 365 * 24 * 60 * 60 * 1000) / 1000);

  let tracks;
  try {
    if (isFirstSync) {
      tracks = await lastfmRecentTracksAll({
        user:             tokenRow.username,
        fromSec:          null,
        maxPages:         60,
        pacingMs:         220,
        oldestAllowedSec: oneYearAgoSec,
      });
    } else {
      tracks = await lastfmRecentTracks({
        user:  tokenRow.username,
        fromSec,
        limit: 200,
      });
    }
  } catch (e) {
    return NextResponse.json({ error: 'Last.fm fetch failed: ' + e.message }, { status: 502 });
  }

  if (tracks.length === 0) {
    await admin.from('lastfm_tokens')
      .update({ last_synced_at: new Date().toISOString() })
      .eq('user_id', user.id);
    return NextResponse.json({ matched: 0, unmatched: 0, total: 0, message: 'No new plays' });
  }

  // 2) Build collection index for matching.
  const { data: collection } = await admin
    .from('collection')
    .select('id, artist, album')
    .eq('user_id', user.id);

  const index = new Map();
  for (const c of (collection || [])) {
    const k = normaliseArtist(c.artist) + '::' + normaliseAlbumTitle(c.album);
    if (!index.has(k)) index.set(k, c.id);
  }

  // 3) Build per-scrobble rows. play_count=1 — Discovery still aggregates
  //    correctly via SUM. No more aggregated entries — chronological feed
  //    needs every play to land as its own row.
  let matched   = 0;
  let unmatched = 0;
  const errors  = [];
  const rows    = [];
  const logRows = [];

  for (const t of tracks) {
    const artist = t.artist?.['#text'] || t.artist?.name || t.artist;
    const album  = t.album?.['#text']  || t.album?.name  || t.album;
    if (!artist || !album) continue;

    const artistNorm = normaliseArtist(artist);
    const albumNorm  = normaliseAlbumTitle(album);
    if (!artistNorm || !albumNorm) continue;

    const collectionItemId = index.get(artistNorm + '::' + albumNorm) || null;
    const playedAt = new Date(Number(t.date.uts) * 1000).toISOString();

    if (collectionItemId) matched++;
    else                  unmatched++;

    rows.push({
      user_id:               user.id,
      source:                'lastfm',
      artist,
      album,
      artist_norm:           artistNorm,
      album_norm:            albumNorm,
      played_at:             playedAt,
      matched_collection_id: collectionItemId,
      play_count:            1,
    });

    if (collectionItemId) {
      logRows.push({
        user_id:            user.id,
        collection_item_id: collectionItemId,
        played_at:          playedAt,
        source:             'lastfm',
        notes:              '[lastfm]',
      });
    }
  }

  // 4) Bulk upsert into streaming_history. ON CONFLICT DO NOTHING via
  //    ignoreDuplicates so re-syncing overlapping windows is safe.
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    let { error: insErr } = await admin
      .from('streaming_history')
      .upsert(slice, {
        onConflict: 'user_id,source,played_at,artist_norm,album_norm',
        ignoreDuplicates: true,
      });
    if (insErr && /column.*play_count|does not exist/i.test(insErr.message || '')) {
      // pre-035 fallback
      const stripped = slice.map(r => { const { play_count, ...rest } = r; return rest; });
      const r2 = await admin.from('streaming_history').upsert(stripped, {
        onConflict: 'user_id,source,played_at,artist_norm,album_norm',
        ignoreDuplicates: true,
      });
      insErr = r2.error;
    }
    if (insErr) errors.push('hist:' + (insErr.message || '').slice(0, 60));
  }

  // 5) Bulk insert matched into listen_logs — silent skip on
  //    duplicates (re-sync of overlapping window).
  for (let i = 0; i < logRows.length; i += CHUNK) {
    const slice = logRows.slice(i, i + CHUNK);
    let { error } = await admin.from('listen_logs').insert(slice);
    if (error && /column.*source|does not exist/i.test(error.message || '')) {
      const stripped = slice.map(r => { const { source, ...rest } = r; return rest; });
      const r2 = await admin.from('listen_logs').insert(stripped);
      error = r2.error;
    }
    if (error && !/duplicate key|unique constraint/i.test(error.message || '')) {
      errors.push('logs:' + (error.message || '').slice(0, 60));
    }
  }

  await admin.from('lastfm_tokens')
    .update({ last_synced_at: new Date().toISOString() })
    .eq('user_id', user.id);

  return NextResponse.json({
    matched,
    unmatched,
    total:    tracks.length,
    errors:   errors.slice(0, 5),
  });
}

export async function DELETE() {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { error } = await sb.from('lastfm_tokens').delete().eq('user_id', user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
