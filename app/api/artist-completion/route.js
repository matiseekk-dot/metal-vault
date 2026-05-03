// ── /api/artist-completion ─────────────────────────────────────────
// Backs the "I own all their albums" toggle in BandsTab. One row per
// (user, artist_name); presence = completed.
//
// GET    → { artists: ["Iron Maiden", "Metallica", ...] }
// POST   → { artist: "Iron Maiden", completed: true|false } (upsert / delete)
// PUT    → bulk import { artists: ["..."] } (one-shot localStorage migration)

export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';

function cleanArtist(s) {
  return String(s || '').trim().slice(0, 200);
}

export async function GET() {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data, error } = await sb
    .from('user_artist_completion')
    .select('artist_name')
    .eq('user_id', user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ artists: (data || []).map(r => r.artist_name) });
}

export async function POST(request) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const artist = cleanArtist(body.artist);
  if (!artist) return NextResponse.json({ error: 'Missing artist' }, { status: 400 });

  if (body.completed === false) {
    const { error } = await sb
      .from('user_artist_completion')
      .delete()
      .eq('user_id', user.id)
      .eq('artist_name', artist);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, removed: true });
  }

  const { error } = await sb
    .from('user_artist_completion')
    .upsert({ user_id: user.id, artist_name: artist }, { onConflict: 'user_id,artist_name' });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function PUT(request) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const list = Array.isArray(body.artists) ? body.artists : [];
  if (list.length > 5000) return NextResponse.json({ error: 'Too many items in one batch' }, { status: 413 });

  const rows = list
    .map(cleanArtist)
    .filter(Boolean)
    .map(artist_name => ({ user_id: user.id, artist_name }));

  if (rows.length === 0) return NextResponse.json({ ok: true, imported: 0 });

  const { error } = await sb
    .from('user_artist_completion')
    .upsert(rows, { onConflict: 'user_id,artist_name', ignoreDuplicates: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, imported: rows.length });
}
