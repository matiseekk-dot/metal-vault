// ── /api/cron/lastfm-scrobble-sync — nightly auto-pull of new scrobbles ──
//
// Sibling to /api/cron/lastfm-sync (which pulls EVENTS / concert
// attendance). That cron didn't touch scrobble PLAY HISTORY — the
// streaming_history table was only populated when the user manually
// clicked SYNC NOW in the ListeningTab. Users (rightly) expected
// "their plays from last night should show up by morning" — they
// don't, because nothing schedules the pull.
//
// This cron fixes that. Runs once a day at 04:00 UTC (between the
// 23:00 user-active window and the 08:00 daily-digest cron). For
// every user with a connected Last.fm:
//
//   1. Fetch getRecentTracks paginated (last ~6h sliding window;
//      enough to catch a typical day's listening without re-doing
//      the full all-time pull every night).
//   2. Aggregate per album.
//   3. Upsert into streaming_history, summing playcounts.
//
// Why incremental (NOT full all-time):
//   The manual SYNC NOW endpoint does a DELETE + full re-insert.
//   Doing that 100× per night per user would burn LFM rate limit
//   and rebuild ~the same data. Incremental upsert is cheaper and
//   leaves the manual button as the "rebuild from scratch" option.
//
// Auth: CRON_SECRET via Bearer header.

import { NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabase-server';
import { lastfmRecentTracksAll } from '@/lib/lastfm';

export const dynamic     = 'force-dynamic';
export const maxDuration = 300;

const BUDGET_MS        = 4 * 60 * 1000;
const PACING_PER_USER  = 800;             // 800ms between users → LFM-friendly
const SAFETY_MARGIN_MS = 30 * 1000;
const PER_USER_PAGES   = 5;               // 5 × 200 = 1000 recent tracks — covers ~1-2 days of heavy listening
const PER_USER_PACING  = 250;             // 4 req/sec to LFM per user

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
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Server misconfigured: CRON_SECRET unset' }, { status: 500 });
  }
  const auth = request.headers.get('authorization');
  if (auth !== 'Bearer ' + process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const startTs  = Date.now();
  const deadline = startTs + BUDGET_MS - SAFETY_MARGIN_MS;
  const admin    = getAdminClient();

  const { data: tokens, error: tokensErr } = await admin
    .from('lastfm_tokens')
    .select('user_id, username, last_synced_at');
  if (tokensErr) {
    return NextResponse.json({ error: tokensErr.message }, { status: 500 });
  }

  const totals = {
    users_total:     (tokens || []).length,
    users_scanned:   0,
    users_skipped:   0,
    rows_upserted:   0,
    errors:          0,
    bail_reason:     null,
  };

  for (const tok of (tokens || [])) {
    if (Date.now() > deadline) {
      totals.bail_reason = 'time_budget_exhausted';
      break;
    }
    const username = (tok.username || '').trim();
    if (!username || !tok.user_id) { totals.users_skipped++; continue; }

    try {
      // Lean pull: 5 pages × 200 = 1000 most-recent scrobbles. Plenty
      // for "what did this user play since yesterday's cron". Full
      // all-time rebuild stays behind the manual SYNC NOW button.
      let tracks = [];
      try {
        tracks = await lastfmRecentTracksAll({
          user:       username,
          maxPages:   PER_USER_PAGES,
          pacingMs:   PER_USER_PACING,
          deadlineMs: 20_000,   // 20s per-user cap — keeps cron loop moving
        });
      } catch {
        totals.errors++;
        continue;
      }

      if (!tracks || tracks.length === 0) {
        totals.users_scanned++;
        continue;
      }

      // Aggregate per album. Capture real played_at from each scrobble
      // (date.uts) so existing rows can advance their played_at to the
      // most-recent listen — enables the listening-feed 30d/90d filter.
      const merged = new Map();
      for (const t of tracks) {
        const artistName = t.artist?.name || t.artist?.['#text'] || '';
        const albumName  = t.album?.['#text'] || (typeof t.album === 'string' ? t.album : '') || '';
        if (!artistName || !albumName) continue;
        const artistNorm = normaliseArtist(artistName);
        const albumNorm  = normaliseAlbumTitle(albumName);
        if (!artistNorm || !albumNorm) continue;
        const playedTs = Number(t.date?.uts) > 0 ? Number(t.date.uts) * 1000 : 0;
        const key = artistNorm + '::' + albumNorm;
        const existing = merged.get(key);
        if (existing) {
          existing.delta_plays += 1;
          if (playedTs > existing.lastPlayedMs) existing.lastPlayedMs = playedTs;
        } else {
          merged.set(key, {
            artist:       artistName,
            album:        albumName,
            artistNorm,
            albumNorm,
            delta_plays:  1,
            lastPlayedMs: playedTs,
          });
        }
      }
      if (merged.size === 0) {
        totals.users_scanned++;
        continue;
      }

      // Fetch existing streaming_history rows for this user (lastfm-source)
      // so we can do an upsert by (artist_norm, album_norm). Add deltas to
      // existing play_count instead of replacing.
      const { data: existingRows } = await admin
        .from('streaming_history')
        .select('id, artist_norm, album_norm, play_count')
        .eq('user_id', tok.user_id)
        .eq('source',  'lastfm');

      const existingByKey = new Map();
      for (const r of (existingRows || [])) {
        existingByKey.set((r.artist_norm || '') + '::' + (r.album_norm || ''), r);
      }

      // Match to collection so the matched_collection_id stays accurate.
      const { data: collection } = await admin
        .from('collection')
        .select('id, artist, album')
        .eq('user_id', tok.user_id);
      const collectionIndex = new Map();
      for (const c of (collection || [])) {
        const k = normaliseArtist(c.artist) + '::' + normaliseAlbumTitle(c.album);
        if (!collectionIndex.has(k)) collectionIndex.set(k, c.id);
      }

      // Apply upserts. Update existing rows in place; insert new.
      const toInsert = [];
      const toUpdate = [];
      const nowMs = Date.now();
      let idx = 0;
      for (const a of merged.values()) {
        const key = a.artistNorm + '::' + a.albumNorm;
        const existing = existingByKey.get(key);
        const playedAt = a.lastPlayedMs > 0
          ? new Date(a.lastPlayedMs).toISOString()
          : new Date(nowMs - idx * 1000).toISOString();
        if (existing) {
          // Bump play_count AND advance played_at to most-recent listen
          // so the 30d/90d filter reflects current activity instead of
          // the original sync date.
          const update = {
            id:         existing.id,
            play_count: (Number(existing.play_count) || 1) + a.delta_plays,
          };
          if (a.lastPlayedMs > 0) update.played_at = playedAt;
          toUpdate.push(update);
        } else {
          toInsert.push({
            user_id:               tok.user_id,
            source:                'lastfm',
            artist:                a.artist,
            album:                 a.album,
            artist_norm:           a.artistNorm,
            album_norm:            a.albumNorm,
            played_at:             playedAt,
            matched_collection_id: collectionIndex.get(key) || null,
            play_count:            a.delta_plays,
          });
          idx++;
        }
      }

      // Bulk insert (chunked) + per-row UPDATE for existing.
      // Postgres doesn't have a single bulk-update API in Supabase JS,
      // so we hit one row at a time — fine at typical scale of 5-50
      // updated rows per user per night.
      if (toInsert.length > 0) {
        try {
          await admin.from('streaming_history').insert(toInsert);
          totals.rows_upserted += toInsert.length;
        } catch (e) {
          if (/play_count|does not exist/i.test(e.message || '')) {
            const stripped = toInsert.map(r => { const { play_count, ...rest } = r; return rest; });
            try {
              await admin.from('streaming_history').insert(stripped);
              totals.rows_upserted += stripped.length;
            } catch { totals.errors++; }
          } else {
            totals.errors++;
          }
        }
      }
      for (const u of toUpdate) {
        try {
          const patch = { play_count: u.play_count };
          if (u.played_at) patch.played_at = u.played_at;
          await admin.from('streaming_history')
            .update(patch)
            .eq('id', u.id);
          totals.rows_upserted += 1;
        } catch { totals.errors++; }
      }

      await admin.from('lastfm_tokens')
        .update({ last_synced_at: new Date().toISOString() })
        .eq('user_id', tok.user_id);

      totals.users_scanned++;
    } catch {
      totals.errors++;
    }

    await new Promise(r => setTimeout(r, PACING_PER_USER));
  }

  totals.elapsed_ms = Date.now() - startTs;
  return NextResponse.json(totals);
}
