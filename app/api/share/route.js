export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { getAdminClient } from '@/lib/supabase-server';

export async function GET(request) {
  const token = new URL(request.url).searchParams.get('token');

  if (token) {
    // Public: fetch shared collection
    const sb = getAdminClient();
    const { data: share } = await sb
      .from('share_tokens').select('user_id, label').eq('token', token).single();
    if (!share) return NextResponse.json({ error: 'Invalid share link' }, { status: 404 });

    const { data: collection } = await sb
      .from('collection').select('artist, album, format, grade, cover, purchase_price, median_price, label, added_at')
      .eq('user_id', share.user_id).order('added_at', { ascending: false });

    const { data: profile } = await sb
      .from('profiles').select('display_name, username').eq('id', share.user_id).single();

    return NextResponse.json({ collection, profile, label: share.label });
  }

  // Authenticated: get or create own share token
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: existing } = await supabase
    .from('share_tokens').select('token, label').eq('user_id', user.id).single();

  return NextResponse.json({ token: existing?.token || null, label: existing?.label || 'My Collection' });
}

export async function POST(request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { label } = await request.json().catch(() => ({}));

  const { data, error } = await supabase
    .from('share_tokens')
    .upsert({ user_id: user.id, label: label || 'My Collection' }, { onConflict: 'user_id' })
    .select('token, label').single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ token: data.token, label: data.label });
}

export async function DELETE(request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  await supabase.from('share_tokens').delete().eq('user_id', user.id);
  return NextResponse.json({ success: true });
}
