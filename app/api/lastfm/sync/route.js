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
import { lastfmTopAlbumsAll, lastfmRecentTracksAll } from '@/lib/lastfm';

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

  // Diagnostic counts — surface to the UI so the user can immediately
  // see whether the sync actually populated streaming_history. If the
  // card says "Connected · 0 albums" they know to tap SYNC NOW; if it
  // says "1,247 albums" but the feed shows fewer, the issue is in the
  // feed query, not the sync.
  let albumCount  = 0;
  let scrobbleSum = 0;
  if (data) {
    try {
      const { count } = await sb.from('streaming_history')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('source', 'lastfm');
      albumCount = count || 0;

      // Sum play_count via a tiny aggregation page — Supabase doesn't
      // expose SQL SUM directly, so we paginate the play_count column
      // in big chunks and sum in JS. For typical ≤ 10k row counts this
      // is one round trip.
      const { data: pcRows } = await sb.from('streaming_history')
        .select('play_count')
        .eq('user_id', user.id)
        .eq('source', 'lastfm')
        .range(0, 9999);
      for (const r of (pcRows || [])) scrobbleSum += Number(r.play_count) || 1;
    } catch {}
  }

  return NextResponse.json({
    connected:    !!data,
    username:     data?.username || null,
    lastSyncedAt: data?.last_synced_at || null,
    albumCount,
    scrobbleSum,
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

  // 1) Pull RAW scrobbles via getRecentTracks paginated to all-time.
  //
  // Why not getTopAlbums? Because Last.fm's server-side aggregator
  // silently drops scrobbles whose album metadata wasn't tagged at
  // scrobble time — Spotify/Apple Music scrobblers historically didn't
  // always include album info, so for many users "top albums" is far
  // sparser than what they actually listened to. getRecentTracks gives
  // us the complete scrobble stream (with whatever album info each
  // scrobble carries), and we aggregate per album client-side.
  //
  // We ALSO call getTopAlbums as a backstop: it surfaces albums the
  // server has aggregated from sources getRecentTracks may not include
  // (e.g. older purged tracks, MBID-resolved entries). The two get
  // merged later, summing playcounts where they overlap.
  //
  // 500 pages × 200 tracks = 100k scrobble cap. Most users top out
  // well below this; the cap exists for the most extreme histories.
  // Vercel maxDuration=300s headroom: 500 × 220ms = 110s, plenty.
  // Serialize the two API calls — running them in parallel doubles
  // the effective rate against Last.fm's 5 req/sec ceiling and we were
  // hitting silent throttle errors mid-pagination (causing only ~190
  // tracks to land instead of thousands).
  let tracks = [];
  let topAlbums = [];
  try {
    tracks = await lastfmRecentTracksAll({
      user:      tokenRow.username,
      maxPages:  250,        // 250 × 200 = 50k scrobble cap (most users)
      pacingMs:  240,        // ~4 req/sec, comfortably under 5/sec limit
      deadlineMs: 200_000,   // 200s soft cap → leaves headroom for inserts
    });
  } catch (e) {
    return NextResponse.json({ error: 'Last.fm getRecentTracks failed: ' + e.message }, { status: 502 });
  }
  try {
    topAlbums = await lastfmTopAlbumsAll({
      user:      tokenRow.username,
      period:    'overall',
      maxPages:  30,
      pacingMs:  240,
    });
  } catch {
    topAlbums = [];   // backstop is optional, swallow errors
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

  // 3) Aggregate scrobbles per album. Each track that has album metadata
  // contributes +1 to that album's playcount. Tracks without album info
  // are dropped (can't classify them — Last.fm sometimes scrobbles
  // singles or radio shows without album).
  const merged = new Map();   // key = artistNorm::albumNorm

  for (const t of tracks) {
    const artistName = t.artist?.name || t.artist?.['#text'] || '';
    const albumName  = t.album?.['#text'] || (typeof t.album === 'string' ? t.album : '') || '';
    if (!artistName || !albumName) continue;
    const artistNorm = normaliseArtist(artistName);
    const albumNorm  = normaliseAlbumTitle(albumName);
    if (!artistNorm || !albumNorm) continue;
    // Real scrobble timestamp from Last.fm. date.uts is a Unix timestamp
    // in seconds; missing for the "currently playing" item (no .date at
    // all on that one). We use the most-recent date.uts across tracks
    // sharing an album as that album's `played_at` — enables the
    // listening feed's 30d/90d/365d time-range filter to actually
    // include Last.fm rows. Previously played_at was synthetic (sync
    // time) so the time-range filter silently omitted EVERY Last.fm
    // album, making /vault/listening?since=30d look empty.
    const playedTs = Number(t.date?.uts) > 0 ? Number(t.date.uts) * 1000 : 0;
    const key = artistNorm + '::' + albumNorm;
    const existing = merged.get(key);
    if (existing) {
      existing.playcount += 1;
      if (playedTs > existing.lastPlayedMs) existing.lastPlayedMs = playedTs;
    } else {
      merged.set(key, {
        artist:       artistName,
        album:        albumName,
        artistNorm,
        albumNorm,
        playcount:    1,
        lastPlayedMs: playedTs,
      });
    }
  }

  // Backstop merge: getTopAlbums may know about albums getRecentTracks
  // didn't return (deep history, MBID-resolved). For each album we add,
  // take MAX of (our scrobble count, server's playcount) so we don't
  // under-count if our window missed something the server tracked.
  for (const a of topAlbums) {
    const artistNorm = normaliseArtist(a.artist);
    const albumNorm  = normaliseAlbumTitle(a.album);
    if (!artistNorm || !albumNorm) continue;
    const key = artistNorm + '::' + albumNorm;
    const existing = merged.get(key);
    const serverCount = Number(a.playcount) || 0;
    if (existing) {
      if (serverCount > existing.playcount) existing.playcount = serverCount;
    } else {
      merged.set(key, {
        artist:     a.artist,
        album:      a.album,
        artistNorm,
        albumNorm,
        playcount:  serverCount,
      });
    }
  }

  if (merged.size === 0) {
    await admin.from('lastfm_tokens')
      .update({ last_synced_at: new Date().toISOString() })
      .eq('user_id', user.id);
    return NextResponse.json({
      matched: 0, unmatched: 0, total: 0,
      message: 'No albums found in Last.fm history',
    });
  }

  // Build per-album rows. play_count = aggregate from Last.fm (post-dedupe).
  // played_at = the MOST RECENT real scrobble of this album from Last.fm
  // (lastPlayedMs). When unavailable — typical for getTopAlbums entries
  // that fall OUTSIDE the getRecentTracks window (e.g. an album last
  // listened to 5 years ago, with 500+ lifetime plays) — we fall back
  // to NEAR-EPOCH instead of "now". Reason: synthetic "now" timestamps
  // made every untracked-date album look like it was just played, so a
  // user filtering for "last 30 days" saw BLINDEAD 591x even though they
  // hadn't listened to it in years. Epoch puts them in a window no
  // since-filter selects (all-time view still includes them).
  //
  // Use a tiny incrementing offset so the unique composite index
  // (user, source, played_at, artist_norm, album_norm) doesn't collide
  // when many albums share the no-real-date fallback.
  const nowMs = Date.now();
  let matched   = 0;
  let unmatched = 0;
  const errors  = [];
  const rows    = [];
  let i = 0;
  let undatedIdx = 0;
  for (const a of merged.values()) {
    const collectionItemId = index.get(a.artistNorm + '::' + a.albumNorm) || null;
    if (collectionItemId) matched++;
    else                  unmatched++;

    const playedAt = a.lastPlayedMs > 0
      ? new Date(a.lastPlayedMs).toISOString()
      // Epoch + small offset so each undated row gets a unique value.
      // 1970-01-01T00:00:00Z + N seconds — billion seconds = 2001, plenty
      // of headroom even for 100k undated albums.
      : new Date(undatedIdx++ * 1000).toISOString();

    rows.push({
      user_id:               user.id,
      source:                'lastfm',
      artist:                a.artist,
      album:                 a.album,
      artist_norm:           a.artistNorm,
      album_norm:            a.albumNorm,
      played_at:             playedAt,
      matched_collection_id: collectionItemId,
      play_count:            a.playcount,
    });
    i++;
  }

  // 4) Atomic-ish swap: DELETE old data immediately before INSERT, so
  // the user's listening tab stays populated through the slow Last.fm
  // fetch above and only flickers empty for the brief insert window
  // (typically <2s for 2k rows).
  try {
    await admin.from('streaming_history')
      .delete()
      .eq('user_id', user.id)
      .eq('source', 'lastfm');
  } catch {}

  // 5) Bulk insert in chunks. 30k rows × ~250 bytes = ~7.5 MB total —
  //    easily fits chunked at 500/insert.
  let inserted = 0;
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
    if (insErr) {
      errors.push('hist:' + (insErr.message || '').slice(0, 60));
    } else {
      inserted += slice.length;
    }
  }

  await admin.from('lastfm_tokens')
    .update({ last_synced_at: new Date().toISOString() })
    .eq('user_id', user.id);

  return NextResponse.json({
    matched,
    unmatched,
    // Post-aggregation count = unique albums actually in the DB. The
    // raw scrobble stream count goes in `scrobbles` for diagnostics
    // (helps the user understand why an active scrobbler with 100k
    // tracks ends up with ~2k albums after grouping).
    total:        rows.length,
    inserted,
    scrobbles:    tracks.length,
    rawCount:     topAlbums.length,
    // Pagination diagnostics — if pagesProcessed is much smaller than
    // totalPagesAvailable, Last.fm has more data we didn't reach (raise
    // maxPages or deadlineMs). If pagesProcessed === totalPagesAvailable
    // and scrobbles is still small, the user genuinely has that many.
    pagesProcessed:      tracks.__pages         || 0,
    totalPagesAvailable: tracks.__totalPages    || 0,
    elapsedMs:           tracks.__elapsedMs     || 0,
    errors:              errors.slice(0, 5),
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
