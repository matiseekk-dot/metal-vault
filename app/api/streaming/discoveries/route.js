// ── /api/streaming/discoveries — wishlist suggestions from streaming ──
//
// "You streamed Tool — Lateralus 22 times last month. Add to wishlist?"
//
// GET   → top albums the user streamed but doesn't own + isn't already
//         watching + hasn't dismissed. Sorted by play count desc.
// DELETE→ dismiss a suggestion (artist + album in body). Inserts into
//         streaming_dismissed so we never resurface this album.
//
// Window: last 90 days. Older streams are noise — taste shifts.
// Floor: at least 3 plays in window. Below that it's not really a
// "want", just a casual try.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';

const WINDOW_DAYS = 90;
const MIN_PLAYS   = 3;
const TOP_N       = 10;

function normaliseArtist(s) {
  return String(s || '').toLowerCase().trim()
    .replace(/\s*\(\d+\)\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}
function normaliseAlbumTitle(s) {
  return String(s || '').toLowerCase().trim()
    .replace(/\s*[\[(].*?(remaster|reissue|deluxe|edition|expanded|anniversary).*?[\])]\s*/gi, '')
    .replace(/\s*-\s*(remaster|reissue|deluxe).*$/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function GET() {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const cutoff = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();

  // Pull all unmatched streaming history in window. We aggregate in
  // JS rather than SQL because PostgREST can't do GROUP BY +
  // aggregate without a custom RPC, and creating a view per user
  // for one feature is overkill.
  //
  // Note: we filter `matched_collection_id IS NULL` server-side via
  // `.is('matched_collection_id', null)` — index streaming_history_discovery
  // is partial on this exact predicate so it stays fast even for
  // power scrobblers (10k+ plays in 90 days).
  const { data: rows, error } = await sb
    .from('streaming_history')
    .select('artist, album, artist_norm, album_norm, played_at')
    .eq('user_id', user.id)
    .is('matched_collection_id', null)
    .gte('played_at', cutoff);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Aggregate in JS by (artist_norm, album_norm).
  const buckets = new Map();
  for (const r of (rows || [])) {
    const key = r.artist_norm + '::' + r.album_norm;
    let b = buckets.get(key);
    if (!b) {
      b = {
        artist:      r.artist,        // pretty form (first seen)
        album:       r.album,
        artist_norm: r.artist_norm,
        album_norm:  r.album_norm,
        plays:       0,
        last_played: null,
      };
      buckets.set(key, b);
    }
    b.plays++;
    if (!b.last_played || r.played_at > b.last_played) {
      b.last_played = r.played_at;
    }
  }

  let candidates = [...buckets.values()].filter(b => b.plays >= MIN_PLAYS);

  // Filter out items already in user's watchlist (by normalised artist+album).
  const { data: watchlist } = await sb.from('watchlist')
    .select('artist, album')
    .eq('user_id', user.id);
  const watchKeys = new Set(
    (watchlist || []).map(w => normaliseArtist(w.artist) + '::' + normaliseAlbumTitle(w.album))
  );
  candidates = candidates.filter(c => !watchKeys.has(c.artist_norm + '::' + c.album_norm));

  // Filter out dismissed.
  const { data: dismissed } = await sb.from('streaming_dismissed')
    .select('artist_norm, album_norm')
    .eq('user_id', user.id);
  const dismissKeys = new Set(
    (dismissed || []).map(d => d.artist_norm + '::' + d.album_norm)
  );
  candidates = candidates.filter(c => !dismissKeys.has(c.artist_norm + '::' + c.album_norm));

  // Filter out items the user owns (recheck — matched_collection_id
  // is set at sync time, but a user might have ADDED the album to
  // collection AFTER scrobbling it). Belt + braces.
  const { data: collection } = await sb.from('collection')
    .select('artist, album')
    .eq('user_id', user.id);
  const ownedKeys = new Set(
    (collection || []).map(c => normaliseArtist(c.artist) + '::' + normaliseAlbumTitle(c.album))
  );
  candidates = candidates.filter(c => !ownedKeys.has(c.artist_norm + '::' + c.album_norm));

  // Sort by play count, then recency (so something you've been
  // smashing this week ranks above something you played a lot
  // 3 months ago).
  candidates.sort((a, b) => {
    if (b.plays !== a.plays) return b.plays - a.plays;
    return String(b.last_played || '').localeCompare(String(a.last_played || ''));
  });

  return NextResponse.json({
    items: candidates.slice(0, TOP_N).map(c => ({
      artist:      c.artist,
      album:       c.album,
      artist_norm: c.artist_norm,
      album_norm:  c.album_norm,
      plays:       c.plays,
      last_played: c.last_played,
    })),
    window_days: WINDOW_DAYS,
  });
}

// DELETE — dismiss a discovery so it never resurfaces.
//   body: { artist, album }
// We compute the normalised form server-side so a client typo
// doesn't poison the dismiss table.
export async function DELETE(request) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body = {};
  try { body = await request.json(); } catch {}
  const artist = body?.artist;
  const album  = body?.album;
  if (!artist || !album) {
    return NextResponse.json({ error: 'artist + album required' }, { status: 400 });
  }
  const artist_norm = normaliseArtist(artist);
  const album_norm  = normaliseAlbumTitle(album);
  if (!artist_norm || !album_norm) {
    return NextResponse.json({ error: 'invalid artist/album' }, { status: 400 });
  }

  const { error } = await sb.from('streaming_dismissed')
    .upsert(
      { user_id: user.id, artist_norm, album_norm },
      { onConflict: 'user_id,artist_norm,album_norm', ignoreDuplicates: true }
    );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
