// ── Stripe Webhook ─────────────────────────────────────────────
// Handles: checkout.session.completed, customer.subscription.*
// IMPORTANT: must be excluded from middleware auth check
export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabase-server';
import { getStripe, subscriptionToProfile } from '@/lib/stripe';

export async function POST(request) {
  const body      = await request.text();
  const signature = request.headers.get('stripe-signature');
  const secret    = process.env.STRIPE_WEBHOOK_SECRET;

  if (!secret) return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 500 });

  let event;
  try {
    event = getStripe().webhooks.constructEvent(body, signature, secret);
  } catch (e) {
    return NextResponse.json({ error: 'Invalid signature: ' + e.message }, { status: 400 });
  }

  const admin = getAdminClient();

  try {
    switch (event.type) {

      // ── Subscription created/updated ──────────────────────────
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const sub = event.data.object;
        const userId = sub.metadata?.supabase_user_id;
        if (!userId) {
          // Look up by customer ID
          const { data: p } = await admin
            .from('profiles').select('id').eq('stripe_customer_id', sub.customer).single();
          if (p) await admin.from('profiles')
            .update(subscriptionToProfile(sub)).eq('id', p.id);
        } else {
          await admin.from('profiles')
            .update(subscriptionToProfile(sub)).eq('id', userId);
        }
        break;
      }

      // ── Subscription cancelled/expired ───────────────────────
      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        const userId = sub.metadata?.supabase_user_id;
        const update = {
          subscription_status: 'canceled',
          subscription_end:    new Date(sub.current_period_end * 1000).toISOString(),
          plan:                'free',
        };
        if (!userId) {
          const { data: p } = await admin
            .from('profiles').select('id').eq('stripe_customer_id', sub.customer).single();
          if (p) await admin.from('profiles').update(update).eq('id', p.id);
        } else {
          await admin.from('profiles').update(update).eq('id', userId);
        }
        break;
      }

      // ── Checkout completed (first subscription) ───────────────
      case 'checkout.session.completed': {
        const session = event.data.object;
        if (session.mode !== 'subscription') break;
        const userId = session.metadata?.supabase_user_id;
        if (userId && session.subscription) {
          const sub = await getStripe().subscriptions.retrieve(session.subscription);
          await admin.from('profiles')
            .update({
              stripe_customer_id: session.customer,
              ...subscriptionToProfile(sub),
            }).eq('id', userId);
        }
        break;
      }

      // ── Payment failed — mark past_due ─────────────────────────
      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        if (invoice.subscription) {
          const { data: p } = await admin
            .from('profiles').select('id').eq('stripe_customer_id', invoice.customer).single();
          if (p) await admin.from('profiles')
            .update({ subscription_status: 'past_due' }).eq('id', p.id);
        }
        break;
      }
    }
  } catch (e) {
    console.error('[stripe-webhook]', event.type, e.message);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
