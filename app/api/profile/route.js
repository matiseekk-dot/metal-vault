export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data } = await supabase.from('profiles').select('*').eq('id', user.id).single();
  return NextResponse.json({ profile: data });
}

export async function POST(request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json();

  // Check username uniqueness
  if (body.username) {
    const { data: existing } = await supabase
      .from('profiles').select('id').eq('username', body.username).neq('id', user.id).single();
    if (existing) return NextResponse.json({ error: 'Username is already taken' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('profiles')
    .upsert({ id: user.id, ...body }, { onConflict: 'id' })
    .select().single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ profile: data });
}
