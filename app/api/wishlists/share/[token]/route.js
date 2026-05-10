// ── /api/wishlists/share/[token] — anonymous public read ────────
//
// No auth required. Reads via the existing `wishlists public select`
// RLS policy which gates on is_public=true.
//
// Returns the wishlist meta + items. Consumers: the public share page
// at /wishlist/[token] (Open Graph crawlers, share-link recipients).

import { NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';

export async function GET(_req, { params }) {
  const { token } = await params;
  if (!token || !/^[A-Za-z0-9_-]{16,64}$/.test(token)) {
    return NextResponse.json({ error: 'Invalid token' }, { status: 400 });
  }

  // Use admin client so we don't fall foul of any RLS edge cases on the
  // anonymous-read path; the is_public filter is the actual gate.
  const sb = getAdminClient();
  const { data: wl, error } = await sb.from('wishlists')
    .select('id, name, description, is_public, created_at, updated_at, owner_id')
    .eq('share_token', token).maybeSingle();
  if (error || !wl) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!wl.is_public) return NextResponse.json({ error: 'List is private' }, { status: 403 });

  // Pull the owner's display name (best-effort) for "Wishlist by ___".
  let ownerName = null;
  try {
    const { data: prof } = await sb.from('profiles')
      .select('display_name').eq('id', wl.owner_id).maybeSingle();
    ownerName = prof?.display_name || null;
  } catch {}

  const { data: items } = await sb.from('wishlist_items')
    .select('id, artist, album, cover, album_id, discogs_url, notes, position, added_at')
    .eq('wishlist_id', wl.id)
    .order('position', { ascending: true });

  return NextResponse.json({
    wishlist: {
      id:          wl.id,
      name:        wl.name,
      description: wl.description,
      created_at:  wl.created_at,
      owner_name:  ownerName,
    },
    items: items || [],
  });
}
