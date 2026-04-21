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

  // SECURITY: Whitelist only user-modifiable fields. NEVER allow direct writes to
  // subscription_status, plan, stripe_customer_id, subscription_end, subscription_id,
  // or id — those are server-owned (via Stripe webhook only).
  const ALLOWED_FIELDS = ['username', 'display_name', 'avatar_url', 'is_public'];
  const safe = Object.fromEntries(
    Object.entries(body).filter(([k]) => ALLOWED_FIELDS.includes(k))
  );

  // Length & format validation
  if (safe.username !== undefined) {
    const u = String(safe.username).trim();
    if (u.length > 30) return NextResponse.json({ error: 'Username max 30 characters' }, { status: 400 });
    if (u.length < 3)  return NextResponse.json({ error: 'Username min 3 characters' }, { status: 400 });
    if (!/^[a-zA-Z0-9_-]+$/.test(u)) return NextResponse.json({ error: 'Username can only contain letters, numbers, _ and -' }, { status: 400 });
    safe.username = u;
  }
  if (safe.display_name !== undefined && String(safe.display_name).length > 60) {
    return NextResponse.json({ error: 'Display name max 60 characters' }, { status: 400 });
  }
  if (safe.avatar_url !== undefined && String(safe.avatar_url).length > 500) {
    return NextResponse.json({ error: 'Avatar URL too long' }, { status: 400 });
  }

  // Check username uniqueness
  if (safe.username) {
    const { data: existing } = await supabase
      .from('profiles').select('id').eq('username', safe.username).neq('id', user.id).single();
    if (existing) return NextResponse.json({ error: 'Username is already taken' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('profiles')
    .upsert({ id: user.id, ...safe }, { onConflict: 'id' })
    .select().single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ profile: data });
}
