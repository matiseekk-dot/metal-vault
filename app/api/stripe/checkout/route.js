import { NextResponse } from 'next/server';
import { createClient, getAdminClient } from '@/lib/supabase-server';
import { getStripe } from '@/lib/stripe';
import { FREE_TRIAL_DAYS } from '@/lib/pricing';


export const dynamic = 'force-dynamic';

export async function POST(request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { plan = 'monthly' } = await request.json().catch(() => ({}));

  // Whitelist plan values — defense in depth. Single Pro tier at launch.
  const ALLOWED_PLANS = ['monthly', 'yearly'];
  if (!ALLOWED_PLANS.includes(plan)) {
    return NextResponse.json({ error: 'Invalid plan: must be monthly or yearly' }, { status: 400 });
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://metal-vault-six.vercel.app';

  const PRICE_IDS = {
    monthly: process.env.STRIPE_PRICE_MONTHLY,
    yearly:  process.env.STRIPE_PRICE_YEARLY,
  };
  const priceId = PRICE_IDS[plan] || PRICE_IDS.monthly;

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
      trial_period_days: FREE_TRIAL_DAYS,  // single source of truth — see lib/pricing.js
      metadata: { supabase_user_id: user.id },
    },
    success_url: appUrl + '/?premium=success',
    cancel_url:  appUrl + '/?premium=cancel',
    locale:      'auto',  // Stripe auto-detects from browser; supports 30+ locales
    allow_promotion_codes: true,
    metadata: { supabase_user_id: user.id },
  });

  return NextResponse.json({ url: session.url });
}
