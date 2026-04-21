export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';

async function getUser(supabase) {
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return null;
  return user;
}

export async function GET() {
  const supabase = await createClient();
  const user = await getUser(supabase);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data, error } = await supabase
    .from('watchlist').select('*')
    .eq('user_id', user.id)
    .order('added_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ items: data });
}

export async function POST(request) {
  const supabase = await createClient();
  const user = await getUser(supabase);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json();

  // SECURITY: whitelist writable fields
  const ALLOWED = ['album_id', 'artist', 'album', 'cover', 'year', 'format', 'color', 'label', 'target_price', 'notes'];
  const safe = Object.fromEntries(
    Object.entries(body || {}).filter(([k]) => ALLOWED.includes(k))
  );
  if (!safe.album_id) return NextResponse.json({ error: 'album_id required' }, { status: 400 });
  if (safe.target_price !== undefined) {
    const p = Number(safe.target_price);
    if (isNaN(p) || p < 0 || p > 100000) return NextResponse.json({ error: 'Invalid target_price' }, { status: 400 });
    safe.target_price = p;
  }
  if (safe.notes && String(safe.notes).length > 500) {
    return NextResponse.json({ error: 'notes max 500 chars' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('watchlist')
    .upsert({ ...safe, user_id: user.id }, { onConflict: 'user_id,album_id' })
    .select().single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ item: data });
}

export async function DELETE(request) {
  const supabase = await createClient();
  const user = await getUser(supabase);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const albumId = new URL(request.url).searchParams.get('album_id');
  const { error } = await supabase
    .from('watchlist').delete()
    .eq('user_id', user.id).eq('album_id', albumId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
