// ── /api/wishlists — owner CRUD on shared wishlists ─────────────
//
// GET    → list of my wishlists (with item count)
// POST   { name, description?, is_public? } → create new + share token
//
// Item-level operations live at /api/wishlists/[id]/items (separate
// route file for cleaner RLS auditing — that endpoint reads via the
// public token too, this one is owner-only).

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import crypto from 'node:crypto';

export const dynamic = 'force-dynamic';

// 18 raw bytes → 24-char base64url. Plenty of entropy (~144 bits) to
// keep enumeration impractical. Strip padding so the URL stays clean.
function generateShareToken() {
  return crypto.randomBytes(18).toString('base64url');
}

export async function GET() {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Pull lists + item counts in one round-trip via head/count on a
  // child select. PostgREST `count: 'exact'` on a join would also work
  // but the explicit fetch keeps the query plan simple.
  const { data: lists, error } = await sb.from('wishlists')
    .select('id, name, description, share_token, is_public, created_at, updated_at')
    .eq('owner_id', user.id)
    .order('created_at', { ascending: false });
  if (error) {
    if (/relation.*wishlists/i.test(error.message || '')) {
      return NextResponse.json({ error: 'wishlists table missing — apply migration 037', wishlists: [] }, { status: 503 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Item counts per list — cheap aggregate query.
  const counts = {};
  if (lists?.length) {
    const ids = lists.map(l => l.id);
    const { data: items } = await sb.from('wishlist_items')
      .select('wishlist_id')
      .in('wishlist_id', ids);
    for (const it of (items || [])) counts[it.wishlist_id] = (counts[it.wishlist_id] || 0) + 1;
  }
  const enriched = (lists || []).map(l => ({ ...l, item_count: counts[l.id] || 0 }));
  return NextResponse.json({ wishlists: enriched });
}

export async function POST(request) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body;
  try { body = await request.json(); } catch { body = {}; }

  const name = String(body.name || '').trim().slice(0, 80);
  if (!name) return NextResponse.json({ error: 'name required' }, { status: 400 });
  const description = body.description ? String(body.description).slice(0, 400) : null;
  const isPublic = body.is_public === false ? false : true;

  // Generate token. Collision is astronomically unlikely but the unique
  // index will catch the once-in-a-trillion case — retry once.
  let shareToken = generateShareToken();
  let { data, error } = await sb.from('wishlists')
    .insert({ owner_id: user.id, name, description, share_token: shareToken, is_public: isPublic })
    .select().single();
  if (error && /share_token.*unique|duplicate/i.test(error.message || '')) {
    shareToken = generateShareToken();
    const r2 = await sb.from('wishlists')
      .insert({ owner_id: user.id, name, description, share_token: shareToken, is_public: isPublic })
      .select().single();
    data = r2.data; error = r2.error;
  }
  if (error) {
    if (/relation.*wishlists/i.test(error.message || '')) {
      return NextResponse.json({ error: 'wishlists table missing — apply migration 037' }, { status: 503 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ wishlist: data });
}
