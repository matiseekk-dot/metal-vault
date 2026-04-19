export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { createClient, getAdminClient } from '@/lib/supabase-server';
import { getStripe } from '@/lib/stripe';

export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: profile } = await getAdminClient()
    .from('profiles').select('stripe_customer_id').eq('id', user.id).single();

  if (!profile?.stripe_customer_id) {
    return NextResponse.json({ error: 'No subscription found' }, { status: 404 });
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://metal-vault-six.vercel.app';
  const session = await getStripe().billingPortal.sessions.create({
    customer:   profile.stripe_customer_id,
    return_url: appUrl + '/?tab=profile',
  });

  return NextResponse.json({ url: session.url });
}
