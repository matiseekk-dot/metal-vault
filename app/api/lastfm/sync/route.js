// ── /api/lastfm/sync — pull recent + match + auto-log listens ──
//
// User-triggered (Last.fm card "Sync now" button). Mirrors
// /api/spotify/sync end-to-end:
//   1. Read lastfm_tokens row for the user
//   2. Pull user.getRecentTracks since last_synced_at
//   3. Normalise (artist, album) → match collection
//   4. Insert listen_logs idempotently on (collection_item_id, played_at)
//   5. Update last_synced_at to now
//
// Last.fm timestamps are unix seconds, we convert to ISO before the
// dedupe lookup. The `notes` marker '[lastfm]' lets the user filter
// auto-imports apart from manual ones.

import { NextResponse } from 'next/server';
import { createClient, getAdminClient } from '@/lib/supabase-server';
import { lastfmRecentTracks } from '@/lib/lastfm';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

function normaliseAlbumTitle(s) {
  return String(s || '')
    .toLowerCase()
    .trim()
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
  // Status — UI uses this to decide Connect vs Sync UI state.
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

export async function POST() {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = getAdminClient();
  const { data: tokenRow, error: tokenErr } = await admin
    .from('lastfm_tokens')
    .select('*')
    .eq('user_id', user.id)
    .single();
  if (tokenErr || !tokenRow) {
    return NextResponse.json({ error: 'Last.fm not connected' }, { status: 400 });
  }

  // `from` parameter is unix seconds. Last.fm returns plays *after*
  // (inclusive) that timestamp. On first run last_synced_at is NULL
  // → we pull the whole 200-track window (Last.fm cap).
  const fromSec = tokenRow.last_synced_at
    ? Math.floor(new Date(tokenRow.last_synced_at).getTime() / 1000)
    : null;

  let tracks;
  try {
    tracks = await lastfmRecentTracks({
      user:    tokenRow.username,
      fromSec,
      limit:   200,
    });
  } catch (e) {
    return NextResponse.json({ error: 'Last.fm fetch failed: ' + e.message }, { status: 502 });
  }

  if (tracks.length === 0) {
    await admin.from('lastfm_tokens')
      .update({ last_synced_at: new Date().toISOString() })
      .eq('user_id', user.id);
    return NextResponse.json({ matched: 0, total: 0, skipped: 0, message: 'No new plays' });
  }

  const { data: collection } = await admin
    .from('collection')
    .select('id, artist, album')
    .eq('user_id', user.id);

  const index = new Map();
  for (const c of (collection || [])) {
    const k = normaliseArtist(c.artist) + '::' + normaliseAlbumTitle(c.album);
    if (!index.has(k)) index.set(k, c.id);
  }

  let matched   = 0;
  let unmatched = 0;
  let skipped   = 0;
  const errors  = [];
  for (const t of tracks) {
    // Last.fm shape: { name (track), artist: { '#text': name }, album: { '#text': name }, date: { uts, '#text' } }
    const artist = t.artist?.['#text'] || t.artist?.name || t.artist;
    const album  = t.album?.['#text']  || t.album?.name  || t.album;
    if (!artist || !album) continue;

    const artistNorm = normaliseArtist(artist);
    const albumNorm  = normaliseAlbumTitle(album);
    const key = artistNorm + '::' + albumNorm;
    const collectionItemId = index.get(key) || null;
    const playedAt = new Date(Number(t.date.uts) * 1000).toISOString();

    // Best-effort streaming_history (migration 034). Same defensive
    // pattern as Spotify sync — see comment there.
    try {
      const { error: histErr } = await admin
        .from('streaming_history')
        .upsert({
          user_id:               user.id,
          source:                'lastfm',
          artist:                artist,
          album:                 album,
          artist_norm:           artistNorm,
          album_norm:            albumNorm,
          played_at:             playedAt,
          matched_collection_id: collectionItemId,
        }, { onConflict: 'user_id,source,played_at,artist_norm,album_norm', ignoreDuplicates: true });
      if (histErr && !/relation.*streaming_history|does not exist/i.test(histErr.message || '')) {
        errors.push('hist:' + (histErr.message || '').slice(0, 30));
      }
    } catch {}

    if (!collectionItemId) {
      unmatched++;
      continue;
    }

    const { data: existing } = await admin
      .from('listen_logs')
      .select('id')
      .eq('collection_item_id', collectionItemId)
      .eq('played_at', playedAt)
      .maybeSingle();
    if (existing) {
      skipped++;
      continue;
    }

    // listen_logs insert with source-column fallback for unmigrated DBs.
    const baseRow = {
      user_id:            user.id,
      collection_item_id: collectionItemId,
      played_at:          playedAt,
      notes:              '[lastfm]',
    };
    let insErr = null;
    {
      const r = await admin.from('listen_logs').insert({ ...baseRow, source: 'lastfm' });
      insErr = r.error;
      if (insErr && /column.*source|does not exist/i.test(insErr.message || '')) {
        const r2 = await admin.from('listen_logs').insert(baseRow);
        insErr = r2.error;
      }
    }
    if (insErr) {
      errors.push((insErr.message || '').slice(0, 40));
      continue;
    }
    matched++;
  }

  await admin.from('lastfm_tokens')
    .update({ last_synced_at: new Date().toISOString() })
    .eq('user_id', user.id);

  return NextResponse.json({
    matched, skipped, unmatched,
    total: tracks.length,
    errors: errors.slice(0, 5),
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
