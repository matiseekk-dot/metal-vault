export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';

async function getUser(sb) {
  const { data: { user } } = await sb.auth.getUser();
  return user;
}

export async function GET() {
  const supabase = await createClient();
  const user = await getUser(supabase);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data, error } = await supabase
    .from('artist_follows').select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ artists: data });
}

export async function POST(request) {
  const supabase = await createClient();
  const user = await getUser(supabase);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json();

  // SECURITY: whitelist writable fields
  const ALLOWED = ['artist_name', 'spotify_id', 'image_url'];
  const safe = Object.fromEntries(
    Object.entries(body || {}).filter(([k]) => ALLOWED.includes(k))
  );
  if (!safe.artist_name || String(safe.artist_name).trim().length === 0) {
    return NextResponse.json({ error: 'artist_name required' }, { status: 400 });
  }
  if (String(safe.artist_name).length > 200) {
    return NextResponse.json({ error: 'artist_name too long' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('artist_follows')
    .upsert({ ...safe, user_id: user.id }, { onConflict: 'user_id,artist_name' })
    .select().single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ artist: data });
}

export async function DELETE(request) {
  const supabase = await createClient();
  const user = await getUser(supabase);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const name = new URL(request.url).searchParams.get('artist_name');
  const { error } = await supabase
    .from('artist_follows').delete()
    .eq('user_id', user.id).eq('artist_name', name);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
