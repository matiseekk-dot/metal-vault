// ── /api/wishlists/[id]/items — add/remove items ────────────────
//
// POST   { artist, album, cover?, album_id?, discogs_url?, notes? }
// DELETE ?item_id=<uuid>

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';

export async function POST(request, { params }) {
  const { id } = await params;
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body;
  try { body = await request.json(); } catch { body = {}; }

  const artist = String(body.artist || '').trim();
  const album  = String(body.album  || '').trim();
  if (!artist || !album) return NextResponse.json({ error: 'artist and album required' }, { status: 400 });

  // Verify the user owns this list before inserting. RLS would also
  // catch this but explicit check returns a friendlier 403.
  const { data: wl } = await sb.from('wishlists')
    .select('id').eq('id', id).eq('owner_id', user.id).single();
  if (!wl) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Compute next position so items stack chronologically by default.
  // Owner can re-order later via a future PATCH; for now we just append.
  const { data: existing } = await sb.from('wishlist_items')
    .select('position').eq('wishlist_id', id)
    .order('position', { ascending: false }).limit(1);
  const nextPos = existing?.[0]?.position != null ? existing[0].position + 1 : 0;

  const row = {
    wishlist_id: id,
    artist,
    album,
    cover:       body.cover || null,
    album_id:    body.album_id ? String(body.album_id) : null,
    discogs_url: body.discogs_url || null,
    notes:       body.notes ? String(body.notes).slice(0, 200) : null,
    position:    nextPos,
  };
  const { data, error } = await sb.from('wishlist_items')
    .insert(row).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ item: data });
}

export async function DELETE(request, { params }) {
  const { id } = await params;
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const itemId = new URL(request.url).searchParams.get('item_id');
  if (!itemId) return NextResponse.json({ error: 'item_id required' }, { status: 400 });

  // RLS on wishlist_items already gates by parent.owner_id, but the
  // explicit AND-via-EXISTS keeps us future-proof against schema changes.
  const { data: wl } = await sb.from('wishlists')
    .select('id').eq('id', id).eq('owner_id', user.id).single();
  if (!wl) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const { error } = await sb.from('wishlist_items')
    .delete().eq('id', itemId).eq('wishlist_id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
