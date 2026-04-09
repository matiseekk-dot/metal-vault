export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';

async function getUser(sb) {
  const { data: { user } } = await sb.auth.getUser();
  return user;
}

// Helper: update today's portfolio snapshot
async function updateSnapshot(supabase, userId) {
  const { data: items } = await supabase
    .from('collection').select('purchase_price, current_price')
    .eq('user_id', userId);

  if (!items) return;
  const totalValue = items.reduce((s, i) => s + (Number(i.current_price || i.purchase_price) || 0), 0);
  const itemCount  = items.length;

  await supabase.from('portfolio_snapshots').upsert(
    { user_id: userId, snapshot_date: new Date().toISOString().split('T')[0], total_value: totalValue, item_count: itemCount },
    { onConflict: 'user_id,snapshot_date' }
  );
}

export async function GET() {
  const supabase = await createClient();
  const user = await getUser(supabase);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data, error } = await supabase
    .from('collection').select('*')
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
  const { data, error } = await supabase
    .from('collection')
    .insert({ user_id: user.id, ...body })
    .select().single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await updateSnapshot(supabase, user.id);
  return NextResponse.json({ item: data });
}

export async function PATCH(request) {
  const supabase = await createClient();
  const user = await getUser(supabase);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const id   = new URL(request.url).searchParams.get('id');
  const body = await request.json();
  const { data, error } = await supabase
    .from('collection').update(body)
    .eq('id', id).eq('user_id', user.id)
    .select().single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await updateSnapshot(supabase, user.id);
  return NextResponse.json({ item: data });
}

export async function DELETE(request) {
  const supabase = await createClient();
  const user = await getUser(supabase);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const id = new URL(request.url).searchParams.get('id');
  const { error } = await supabase
    .from('collection').delete()
    .eq('id', id).eq('user_id', user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await updateSnapshot(supabase, user.id);
  return NextResponse.json({ success: true });
}
