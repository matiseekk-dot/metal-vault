// ── /api/lastfm/sync — pull top albums (aggregated) + match ──
//
// Last.fm exposes user.getTopAlbums returning ALREADY-AGGREGATED
// (artist, album, playcount) for a chosen period. For the Discovery
// feature ("albums you streamed a lot but don't own") that's exactly
// the shape we need + we get it in ONE request rather than paginating
// through tens of thousands of individual scrobbles.
//
// Strategy (since migration 035):
//   1. Read lastfm_tokens row
//   2. Fetch user.getTopAlbums?period=3month&limit=200 (one round-trip)
//   3. Wipe streaming_history rows for source='lastfm' for this user
//      (full replace — top-album rankings change every sync, no point
//      keeping stale ones)
//   4. Insert one row per album with play_count = the API's playcount
//   5. Match to collection by normalised (artist, album) and write
//      listen_logs rows for the matched ones (so the per-collection
//      streaming counter stays correct)
//   6. Update last_synced_at
//
// Why 3-month period: matches the Discovery aggregation window
// (90 days). Anything older than that is noise for the "you've been
// playing this lately" prompt.
//
// `?force=true` — historical alias from when we paginated; behaviour
// is now identical to the regular path because every sync replaces
// the 'lastfm' rows anyway.

import { NextResponse } from 'next/server';
import { createClient, getAdminClient } from '@/lib/supabase-server';
import { lastfmTopAlbums } from '@/lib/lastfm';

export const dynamic = 'force-dynamic';
// 60s — getTopAlbums returns in ~1s; the rest is matching + writes.
export const maxDuration = 60;

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

  const url = new URL(request.url);
  const period = url.searchParams.get('period') || '3month';

  const admin = getAdminClient();
  const { data: tokenRow, error: tokenErr } = await admin
    .from('lastfm_tokens')
    .select('*')
    .eq('user_id', user.id)
    .single();
  if (tokenErr || !tokenRow) {
    return NextResponse.json({ error: 'Last.fm not connected' }, { status: 400 });
  }

  // 1) Pull aggregated top albums for the chosen window.
  let topAlbums;
  try {
    topAlbums = await lastfmTopAlbums({
      user:   tokenRow.username,
      period,           // '7day' | '1month' | '3month' | '6month' | '12month' | 'overall'
      limit:  200,
    });
  } catch (e) {
    return NextResponse.json({ error: 'Last.fm fetch failed: ' + e.message }, { status: 502 });
  }

  if (topAlbums.length === 0) {
    await admin.from('lastfm_tokens')
      .update({ last_synced_at: new Date().toISOString() })
      .eq('user_id', user.id);
    return NextResponse.json({
      matched: 0, unmatched: 0, total: 0,
      message: 'No top albums in this period',
    });
  }

  // 2) Wipe existing 'lastfm' streaming_history for this user.
  // Top-album rankings change every sync; keeping stale rows would
  // confuse the SUM(play_count) aggregation in Discovery.
  try {
    await admin.from('streaming_history')
      .delete()
      .eq('user_id', user.id)
      .eq('source', 'lastfm');
  } catch {}

  // 3) Build the collection index for matching.
  const { data: collection } = await admin
    .from('collection')
    .select('id, artist, album')
    .eq('user_id', user.id);

  const index = new Map();
  for (const c of (collection || [])) {
    const k = normaliseArtist(c.artist) + '::' + normaliseAlbumTitle(c.album);
    if (!index.has(k)) index.set(k, c.id);
  }

  // 4) Insert one row per top album. play_count = API's playcount,
  // played_at = "now()" with a per-row 1-second offset so the unique
  // index (user, source, played_at, artist_norm, album_norm) doesn't
  // get a collision when two albums collapse to the same normalised
  // form. Belt-and-braces — collisions are rare but cheap to avoid.
  const nowMs = Date.now();
  let matched   = 0;
  let unmatched = 0;
  const errors  = [];
  const rows    = [];

  topAlbums.forEach((a, i) => {
    const artistNorm = normaliseArtist(a.artist);
    const albumNorm  = normaliseAlbumTitle(a.album);
    if (!artistNorm || !albumNorm) return;

    const collectionItemId = index.get(artistNorm + '::' + albumNorm) || null;
    if (collectionItemId) matched++;
    else                  unmatched++;

    rows.push({
      user_id:               user.id,
      source:                'lastfm',
      artist:                a.artist,
      album:                 a.album,
      artist_norm:           artistNorm,
      album_norm:            albumNorm,
      played_at:             new Date(nowMs - i * 1000).toISOString(),
      matched_collection_id: collectionItemId,
      play_count:            a.playcount,
    });
  });

  // Bulk insert in chunks of 500 to stay under PostgREST payload caps.
  // 200 rows × ~250 bytes each = ~50KB — comfortably one chunk.
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    // Try with play_count first (post-035), fall back without it for
    // pre-035 databases (column-not-found error).
    let { error: insErr } = await admin
      .from('streaming_history')
      .insert(slice);
    if (insErr && /column.*play_count|does not exist/i.test(insErr.message || '')) {
      // Re-try with play_count stripped — schema is pre-035.
      const stripped = slice.map(r => {
        const { play_count, ...rest } = r;
        return rest;
      });
      const r2 = await admin.from('streaming_history').insert(stripped);
      insErr = r2.error;
    }
    if (insErr) errors.push('hist:' + (insErr.message || '').slice(0, 60));
  }

  // 5) Update token row's last_synced_at.
  await admin.from('lastfm_tokens')
    .update({ last_synced_at: new Date().toISOString() })
    .eq('user_id', user.id);

  return NextResponse.json({
    matched, unmatched,
    total:  topAlbums.length,
    period,
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
