// ── /api/spotify/sync — fetch recent plays + match + auto-log ───
//
// User-triggered (from ProfileTab "Sync Spotify plays now" button).
// Cron variant could run later but we want explicit user opt-in
// for now — auto-syncing background plays on a free user is a fast
// way to get angry "why is my dashboard suddenly different" reports.
//
// Flow:
//   1. Refresh access_token using stored refresh_token
//   2. Fetch /me/player/recently-played?after=<last_synced>
//   3. For each track, normalise (artist, album) and match against
//      the user's collection
//   4. Insert listen_logs rows for matches (idempotent on
//      played_at timestamp)
//   5. Update spotify_tokens.last_synced_at
//
// Spotify's `recently-played` returns at most 50 tracks AND only
// up to 24h back. So if you don't open the app for 2 days, the
// first 24h of that gap is lost. That's fine — the alternative
// (cron polling every hour) costs background battery on phones
// + makes Spotify suspicious.
//
// Match algorithm: case-insensitive, trim, strip parenthetical
// reissue/remaster suffixes ("Reign in Blood (Remastered 2013)"
// → "Reign in Blood"). Multi-artist tracks match on the FIRST
// listed artist.

import { NextResponse } from 'next/server';
import { createClient, getAdminClient } from '@/lib/supabase-server';
import { spotifyRefreshAccessToken, spotifyRecentlyPlayed } from '@/lib/spotify';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

function normaliseAlbumTitle(s) {
  return String(s || '')
    .toLowerCase()
    .trim()
    // strip leading/trailing parenthetical suffixes that Spotify
    // adds for reissues — `Reign in Blood (Remastered 2013)` →
    // `Reign in Blood`. Discogs titles in our collection are
    // usually clean already.
    .replace(/\s*[\[(].*?(remaster|reissue|deluxe|edition|expanded|anniversary).*?[\])]\s*/gi, '')
    .replace(/\s*-\s*(remaster|reissue|deluxe).*$/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normaliseArtist(s) {
  return String(s || '').toLowerCase().trim()
    // Strip Discogs' disambiguation suffix `(2)` etc.
    .replace(/\s*\(\d+\)\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function POST() {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = getAdminClient();

  // 1) Load token row
  const { data: tokenRow, error: tokenErr } = await admin
    .from('spotify_tokens')
    .select('*')
    .eq('user_id', user.id)
    .single();

  if (tokenErr || !tokenRow) {
    return NextResponse.json({ error: 'Spotify not connected' }, { status: 400 });
  }

  // 2) Refresh access_token
  let accessToken;
  try {
    const refreshed = await spotifyRefreshAccessToken(tokenRow.refresh_token);
    accessToken = refreshed.access_token;
    // Spotify sometimes rotates refresh tokens on refresh; persist the
    // new one if returned (otherwise keep the old).
    if (refreshed.refresh_token && refreshed.refresh_token !== tokenRow.refresh_token) {
      await admin.from('spotify_tokens')
        .update({ refresh_token: refreshed.refresh_token })
        .eq('user_id', user.id);
    }
  } catch (e) {
    return NextResponse.json({ error: 'Spotify refresh failed: ' + e.message }, { status: 502 });
  }

  // 3) Fetch recently played
  const lastSyncedMs = tokenRow.last_synced_at ? new Date(tokenRow.last_synced_at).getTime() : null;
  let recent;
  try {
    recent = await spotifyRecentlyPlayed({ accessToken, afterMs: lastSyncedMs });
  } catch (e) {
    return NextResponse.json({ error: 'Spotify recent fetch failed: ' + e.message }, { status: 502 });
  }
  const items = Array.isArray(recent.items) ? recent.items : [];
  if (items.length === 0) {
    await admin.from('spotify_tokens')
      .update({ last_synced_at: new Date().toISOString() })
      .eq('user_id', user.id);
    return NextResponse.json({ matched: 0, total: 0, skipped: 0, message: 'No new plays' });
  }

  // 4) Pull user's collection for matching. We project only what we
  //    need — keeps payload small even for 1000-record collections.
  const { data: collection } = await admin
    .from('collection')
    .select('id, artist, album')
    .eq('user_id', user.id);

  // Build an index keyed by `<artist>::<album>` normalised. Collisions
  // are rare and resolve to "first match wins" which is fine for
  // listen logging.
  const index = new Map();
  for (const c of (collection || [])) {
    const k = normaliseArtist(c.artist) + '::' + normaliseAlbumTitle(c.album);
    if (!index.has(k)) index.set(k, c.id);
  }

  // 5) Match + insert listen logs. We dedupe on (collection_item_id,
  //    played_at) by checking listen_logs first — Spotify can return
  //    a play we already logged if the user opens this twice quickly.
  let matched = 0;
  let skipped = 0;
  const errors = [];

  for (const it of items) {
    const track = it.track;
    if (!track) continue;
    const artist = track.artists?.[0]?.name;
    const album  = track.album?.name;
    if (!artist || !album) continue;
    const key = normaliseArtist(artist) + '::' + normaliseAlbumTitle(album);
    const collectionItemId = index.get(key);
    if (!collectionItemId) {
      skipped++;
      continue;
    }
    const playedAt = new Date(it.played_at).toISOString();

    // Dedupe — same item + same timestamp already logged
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

    const { error: insErr } = await admin.from('listen_logs').insert({
      user_id:            user.id,
      collection_item_id: collectionItemId,
      played_at:          playedAt,
      // Note marker so the user can later filter "Spotify auto-logs"
      notes:              '[spotify]',
    });
    if (insErr) {
      errors.push((insErr.message || '').slice(0, 40));
      continue;
    }
    matched++;
  }

  // 6) Update last_synced_at to "now" so subsequent calls only fetch
  //    plays after this run.
  await admin.from('spotify_tokens')
    .update({ last_synced_at: new Date().toISOString() })
    .eq('user_id', user.id);

  return NextResponse.json({
    matched, skipped,
    total: items.length,
    errors: errors.slice(0, 5),
  });
}

export async function GET() {
  // Status endpoint — UI uses this to decide whether to show
  // "Connect Spotify" vs "Sync now".
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ connected: false });
  const { data } = await sb.from('spotify_tokens')
    .select('display_name, spotify_id, last_synced_at')
    .eq('user_id', user.id)
    .maybeSingle();
  return NextResponse.json({
    connected:    !!data,
    displayName:  data?.display_name || null,
    spotifyId:    data?.spotify_id   || null,
    lastSyncedAt: data?.last_synced_at || null,
  });
}

export async function DELETE() {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { error } = await sb.from('spotify_tokens').delete().eq('user_id', user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
