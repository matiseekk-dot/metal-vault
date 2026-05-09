// ── /api/lastfm/sync — full all-time top albums (paginated) ────
//
// Uses user.getTopAlbums(period='overall') paginated to the end —
// that gives EVERY unique album the user has ever scrobbled, with
// playcount aggregated server-side. For a user since 2008 with
// 100k scrobbles, this typically resolves to 500-3000 distinct
// albums — much smaller than per-track recenttracks (which would
// need to paginate through 100k rows for the same coverage).
//
// Each row in streaming_history = one album with play_count = N.
// Listen tab "Cyfrowo" filter shows these as albums sorted by
// play_count desc. Discovery aggregates via SUM(play_count).
//
// Why all-time (overall) not 12month: user explicitly asked for the
// "full history". Last.fm's overall period IS that — covers the
// account from creation. Cap at 30 pages × 1000 = 30k unique albums
// is a safety net for the most extreme users; nobody actually has
// that many distinct albums in real life.

import { NextResponse } from 'next/server';
import { createClient, getAdminClient } from '@/lib/supabase-server';
import { lastfmTopAlbumsAll } from '@/lib/lastfm';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;   // 5 min — pagination headroom

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

  // Every sync = full replace — getTopAlbums(overall) returns the
  // canonical top-of-all-time, so an old subset would just be stale.
  // No incremental path; this is a periodic full refresh model.
  try {
    await admin.from('streaming_history')
      .delete()
      .eq('user_id', user.id)
      .eq('source', 'lastfm');
  } catch {}

  // 1) Pull all top albums.
  let albums;
  try {
    albums = await lastfmTopAlbumsAll({
      user:      tokenRow.username,
      period:    'overall',
      maxPages:  30,
      pacingMs:  250,
    });
  } catch (e) {
    return NextResponse.json({ error: 'Last.fm fetch failed: ' + e.message }, { status: 502 });
  }

  if (albums.length === 0) {
    await admin.from('lastfm_tokens')
      .update({ last_synced_at: new Date().toISOString() })
      .eq('user_id', user.id);
    return NextResponse.json({
      matched: 0, unmatched: 0, total: 0,
      message: 'No top albums in Last.fm history',
    });
  }

  // 2) Build collection index.
  const { data: collection } = await admin
    .from('collection')
    .select('id, artist, album')
    .eq('user_id', user.id);

  const index = new Map();
  for (const c of (collection || [])) {
    const k = normaliseArtist(c.artist) + '::' + normaliseAlbumTitle(c.album);
    if (!index.has(k)) index.set(k, c.id);
  }

  // 3) Dedupe by (artist_norm, album_norm) — Last.fm sometimes returns
  // the same album under multiple MBIDs (live vs studio metadata, locale
  // variants, capitalisation drift), or duplicates across pagination
  // pages when the user has < 1000 unique albums. Without this collapse
  // we'd insert N near-identical rows per album, each with playcount=1
  // — and the user sees "Ulver · Flowers Of Evil · 1 play" four times
  // in the feed.
  const merged = new Map();   // key = artistNorm::albumNorm
  for (const a of albums) {
    const artistNorm = normaliseArtist(a.artist);
    const albumNorm  = normaliseAlbumTitle(a.album);
    if (!artistNorm || !albumNorm) continue;
    const key = artistNorm + '::' + albumNorm;
    const existing = merged.get(key);
    if (existing) {
      existing.playcount += Number(a.playcount) || 0;
    } else {
      merged.set(key, {
        artist:     a.artist,
        album:      a.album,
        artistNorm,
        albumNorm,
        playcount:  Number(a.playcount) || 0,
      });
    }
  }

  // Build per-album rows. play_count = aggregate from Last.fm (post-dedupe).
  // played_at is synthetic (now() − i*1s) so the unique index
  // (user, source, played_at, artist_norm, album_norm) doesn't collide.
  // Listen UI's FormatPlayedAt swaps timestamp for "{N} plays" when
  // kind === 'lastfm', so the synthetic value is never displayed.
  const nowMs = Date.now();
  let matched   = 0;
  let unmatched = 0;
  const errors  = [];
  const rows    = [];
  let i = 0;
  for (const a of merged.values()) {
    const collectionItemId = index.get(a.artistNorm + '::' + a.albumNorm) || null;
    if (collectionItemId) matched++;
    else                  unmatched++;

    rows.push({
      user_id:               user.id,
      source:                'lastfm',
      artist:                a.artist,
      album:                 a.album,
      artist_norm:           a.artistNorm,
      album_norm:            a.albumNorm,
      played_at:             new Date(nowMs - i * 1000).toISOString(),
      matched_collection_id: collectionItemId,
      play_count:            a.playcount,
    });
    i++;
  }

  // 4) Bulk insert in chunks. 30k rows × ~250 bytes = ~7.5 MB total —
  //    easily fits chunked at 500/insert.
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    let { error: insErr } = await admin
      .from('streaming_history')
      .insert(slice);
    if (insErr && /column.*play_count|does not exist/i.test(insErr.message || '')) {
      // pre-035 fallback
      const stripped = slice.map(r => { const { play_count, ...rest } = r; return rest; });
      const r2 = await admin.from('streaming_history').insert(stripped);
      insErr = r2.error;
    }
    if (insErr) errors.push('hist:' + (insErr.message || '').slice(0, 60));
  }

  await admin.from('lastfm_tokens')
    .update({ last_synced_at: new Date().toISOString() })
    .eq('user_id', user.id);

  return NextResponse.json({
    matched,
    unmatched,
    // Post-dedup count = what's actually in the DB. albums.length would
    // be inflated by Last.fm returning the same album under multiple
    // MBIDs, which would mislead the user about how much they have.
    total:    rows.length,
    rawCount: albums.length,
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
