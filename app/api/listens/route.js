// ── Listen logs API ──────────────────────────────────────────
//
// POST   /api/listens   body: { collection_item_id, side?, duration_min?, notes?, played_at? }
// GET    /api/listens?item_id=<id>&limit=20  → recent listens (for an item or all)
// DELETE /api/listens?id=<log_id>            → undo a logged play
//
// Insert / delete sync the denormalized counters on `collection`
// via DB trigger — app code never has to update both.
//
// Auth: standard supabase-ssr. Anonymous calls return 401.
// Rate limit: 60 req/min per IP (logging vinyl plays isn't bursty).

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { rateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

async function getUser(sb) {
  const { data: { user } } = await sb.auth.getUser();
  return user || null;
}

// ── POST: log a play ─────────────────────────────────────────
export async function POST(req) {
  const rl = rateLimit(req, { max: 60, windowMs: 60_000 });
  if (!rl.ok) return NextResponse.json({ error: 'Too many requests' }, { status: 429 });

  const sb = await createClient();
  const user = await getUser(sb);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body;
  try { body = await req.json(); } catch { body = {}; }

  const itemId = body.collection_item_id;
  if (!itemId) return NextResponse.json({ error: 'collection_item_id required' }, { status: 400 });

  // Optional fields. Validate strictly — we use the same shape everywhere.
  const side = body.side ? String(body.side).toUpperCase().trim() : null;
  if (side && !/^[A-D]{1,2}$/.test(side)) {
    return NextResponse.json({ error: 'side must be A/B/C/D or AB' }, { status: 400 });
  }
  const duration = body.duration_min != null ? Number(body.duration_min) : null;
  if (duration != null && (!Number.isFinite(duration) || duration <= 0 || duration > 600)) {
    return NextResponse.json({ error: 'duration_min must be 1-600' }, { status: 400 });
  }
  const notes = body.notes ? String(body.notes).slice(0, 500) : null;

  // played_at: defaults to NOW(). Allow client to override (e.g. logging
  // a play from yesterday) but cap at +/- 1 year to prevent garbage.
  let playedAt = null;
  if (body.played_at) {
    const ms = new Date(body.played_at).getTime();
    if (!Number.isFinite(ms)) {
      return NextResponse.json({ error: 'played_at invalid' }, { status: 400 });
    }
    const now = Date.now();
    const ONE_YEAR = 365 * 24 * 60 * 60 * 1000;
    if (Math.abs(now - ms) > ONE_YEAR) {
      return NextResponse.json({ error: 'played_at too far from now' }, { status: 400 });
    }
    playedAt = new Date(ms).toISOString();
  }

  // Verify the user owns this collection item before logging — RLS would
  // also block but explicit lookup gives a cleaner error message.
  const { data: item, error: itemErr } = await sb
    .from('collection')
    .select('id, user_id, artist, album')
    .eq('id', itemId)
    .single();
  if (itemErr || !item || item.user_id !== user.id) {
    return NextResponse.json({ error: 'Collection item not found' }, { status: 404 });
  }

  const insert = {
    user_id:            user.id,
    collection_item_id: itemId,
    side,
    duration_min:       duration,
    notes,
    // source: 'vinyl' for everything submitted via this endpoint.
    // Spotify/Last.fm sync routes write directly via the admin client
    // with their own source value; we never accept that field over
    // the public API to prevent spoofing.
    source:             'vinyl',
  };
  if (playedAt) insert.played_at = playedAt;

  const { data: log, error } = await sb
    .from('listen_logs')
    .insert(insert)
    .select('*')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Return updated counters so the client can update its card without a
  // round-trip back to /api/collection.
  const { data: refreshed } = await sb
    .from('collection')
    .select('id, play_count, last_played_at')
    .eq('id', itemId)
    .single();

  return NextResponse.json({ log, item: refreshed });
}

// ── GET: history (all or for a specific item) ─────────────────
export async function GET(req) {
  const sb = await createClient();
  const user = await getUser(sb);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const itemId = searchParams.get('item_id');
  const limit  = Math.min(parseInt(searchParams.get('limit') || '50', 10), 200);

  let q = sb
    .from('listen_logs')
    .select('id, collection_item_id, played_at, side, duration_min, notes')
    .eq('user_id', user.id)
    .order('played_at', { ascending: false })
    .limit(limit);
  if (itemId) q = q.eq('collection_item_id', itemId);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ logs: data || [] });
}

// ── DELETE: undo a logged play ────────────────────────────────
// Used by "tapped Play by accident" flow. Trigger handles counter sync.
export async function DELETE(req) {
  const sb = await createClient();
  const user = await getUser(sb);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const id = new URL(req.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const { error } = await sb
    .from('listen_logs')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id);   // belt + braces with RLS
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
