// ── /api/wishlists/[id] — owner mutations on a single list ──────
//
// GET    → list with items (owner only)
// PATCH  → rename / toggle public / edit description
// DELETE → cascade delete (items go too via FK)

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';

export async function GET(_req, { params }) {
  const { id } = await params;
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: wl, error } = await sb.from('wishlists')
    .select('*').eq('id', id).eq('owner_id', user.id).single();
  if (error || !wl) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const { data: items } = await sb.from('wishlist_items')
    .select('*').eq('wishlist_id', id).order('position', { ascending: true });
  return NextResponse.json({ wishlist: wl, items: items || [] });
}

export async function PATCH(request, { params }) {
  const { id } = await params;
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body;
  try { body = await request.json(); } catch { body = {}; }

  // Whitelist mutable fields. share_token + owner_id never change.
  const update = {};
  if (typeof body.name === 'string')        update.name        = body.name.trim().slice(0, 80);
  if (typeof body.description === 'string') update.description = body.description.slice(0, 400);
  if (body.description === null)            update.description = null;
  if (typeof body.is_public === 'boolean')  update.is_public   = body.is_public;
  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'no editable fields' }, { status: 400 });
  }

  const { data, error } = await sb.from('wishlists')
    .update(update)
    .eq('id', id).eq('owner_id', user.id)
    .select().single();
  if (error || !data) return NextResponse.json({ error: error?.message || 'Not found' }, { status: 404 });
  return NextResponse.json({ wishlist: data });
}

export async function DELETE(_req, { params }) {
  const { id } = await params;
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // ON DELETE CASCADE on wishlist_items.wishlist_id takes care of the
  // children — no manual cleanup needed.
  const { error } = await sb.from('wishlists')
    .delete().eq('id', id).eq('owner_id', user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
