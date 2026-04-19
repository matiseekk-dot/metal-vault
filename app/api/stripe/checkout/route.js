export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { createClient, getAdminClient } from '@/lib/supabase-server';
import { getStripe } from '@/lib/stripe';

export async function POST(request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { plan = 'monthly' } = await request.json().catch(() => ({}));
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://metal-vault-six.vercel.app';

  const priceId = plan === 'yearly'
    ? process.env.STRIPE_PRICE_YEARLY
    : process.env.STRIPE_PRICE_MONTHLY;

  if (!priceId) {
    return NextResponse.json({ error: 'Stripe price IDs not configured' }, { status: 503 });
  }

  const stripe = getStripe();
  const admin  = getAdminClient();

  // Get or create Stripe customer
  const { data: profile } = await admin
    .from('profiles').select('stripe_customer_id, display_name').eq('id', user.id).single();

  let customerId = profile?.stripe_customer_id;

  if (!customerId) {
    const customer = await stripe.customers.create({
      email:    user.email,
      name:     profile?.display_name || user.email,
      metadata: { supabase_user_id: user.id },
    });
    customerId = customer.id;
    await admin.from('profiles').update({ stripe_customer_id: customerId }).eq('id', user.id);
  }

  // Create checkout session
  const session = await stripe.checkout.sessions.create({
    customer:             customerId,
    mode:                 'subscription',
    payment_method_types: ['card', 'blik', 'p24'],
    line_items: [{
      price:    priceId,
      quantity: 1,
    }],
    subscription_data: {
      trial_period_days: 7,  // 7-day free trial
      metadata: { supabase_user_id: user.id },
    },
    success_url: appUrl + '/?premium=success',
    cancel_url:  appUrl + '/?premium=cancel',
    locale:      'pl',
    allow_promotion_codes: true,
    metadata: { supabase_user_id: user.id },
  });

  return NextResponse.json({ url: session.url });
}
