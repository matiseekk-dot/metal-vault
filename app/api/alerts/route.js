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
    .from('price_alerts').select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ alerts: data });
}

export async function POST(request) {
  const supabase = await createClient();
  const user = await getUser(supabase);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // ── Alert limits: free = 1, pro = unlimited ─────────────────
  const { data: profile } = await supabase
    .from('profiles').select('subscription_status, subscription_end').eq('id', user.id).single();
  const premium = profile?.subscription_status === 'active' ||
                  profile?.subscription_status === 'trialing' ||
                 (profile?.subscription_status === 'past_due' && profile?.subscription_end &&
                  Date.now() < new Date(profile.subscription_end).getTime() + 3*24*60*60*1000);
  if (!premium) {
    const { count } = await supabase
      .from('price_alerts').select('id', { count: 'exact', head: true })
      .eq('user_id', user.id).eq('is_active', true);
    if ((count || 0) >= 1) {
      return NextResponse.json({
        error:   'ALERT_LIMIT_REACHED',
        message: 'Free plan includes 1 price alert. Upgrade to Pro for unlimited alerts.',
        count, limit: 1,
      }, { status: 403 });
    }
  }

  const body = await request.json();
  const { data, error } = await supabase
    .from('price_alerts')
    .insert({ user_id: user.id, ...body })
    .select().single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ alert: data });
}

export async function PATCH(request) {
  const supabase = await createClient();
  const user = await getUser(supabase);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const id   = new URL(request.url).searchParams.get('id');
  const body = await request.json();
  const { data, error } = await supabase
    .from('price_alerts').update(body)
    .eq('id', id).eq('user_id', user.id)
    .select().single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ alert: data });
}

export async function DELETE(request) {
  const supabase = await createClient();
  const user = await getUser(supabase);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const id = new URL(request.url).searchParams.get('id');
  const { error } = await supabase
    .from('price_alerts').delete()
    .eq('id', id).eq('user_id', user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
