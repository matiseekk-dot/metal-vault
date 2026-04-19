export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { createClient, getAdminClient } from '@/lib/supabase-server';
import { isPremium, FREE_LIMIT_RECORDS } from '@/lib/stripe';

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ premium: false, plan: 'free' });

  const { data: profile } = await getAdminClient()
    .from('profiles')
    .select('subscription_status, subscription_end, plan, stripe_customer_id')
    .eq('id', user.id).single();

  const premium = isPremium(profile);

  return NextResponse.json({
    premium,
    plan:               profile?.plan || 'free',
    status:             profile?.subscription_status || 'free',
    subscription_end:   profile?.subscription_end || null,
    free_limit_records: FREE_LIMIT_RECORDS,
    has_customer:       !!profile?.stripe_customer_id,
  });
}
