// ── Metal Vault — Stripe client (server-only) ─────────────────
// Never import this in 'use client' components.

import Stripe from 'stripe';

let _stripe = null;

export function getStripe() {
  if (!_stripe) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error('STRIPE_SECRET_KEY not configured');
    _stripe = new Stripe(key, { apiVersion: '2024-06-20' });
  }
  return _stripe;
}

// ── Subscription helpers ──────────────────────────────────────

export const FREE_LIMIT_RECORDS       = 50;    // max collection items on free tier (unused currently — unlimited)
// Pro tier
export const PRICE_MONTHLY_PLN        = 1999;  // 19.99 PLN in grosze
export const PRICE_YEARLY_PLN         = 14900; // 149 PLN in grosze
// Collector tier (power users — arbitrage + AI + priority)
export const PRICE_COLLECTOR_MONTHLY_PLN = 3999;  // 39.99 PLN in grosze
export const PRICE_COLLECTOR_YEARLY_PLN  = 29900; // 299 PLN in grosze

export const TIERS = {
  free:      { name: 'Free',      monthly: 0,     yearly: 0      },
  pro:       { name: 'Pro',       monthly: 19.99, yearly: 149    },
  collector: { name: 'Collector', monthly: 39.99, yearly: 299    },
};

/**
 * Check if a profile has an active premium subscription.
 */
export function isPremium(profile) {
  if (!profile) return false;
  const s = profile.subscription_status;
  if (s === 'active' || s === 'trialing') return true;
  // Grace period: past_due gives 3 extra days
  if (s === 'past_due' && profile.subscription_end) {
    const grace = new Date(profile.subscription_end).getTime() + 3 * 24 * 60 * 60 * 1000;
    return Date.now() < grace;
  }
  return false;
}

/**
 * Map a Stripe subscription object to profile columns.
 */
export function subscriptionToProfile(sub) {
  return {
    subscription_id:     sub.id,
    subscription_status: sub.status,
    subscription_end:    new Date(sub.current_period_end * 1000).toISOString(),
    plan: sub.items.data[0]?.price?.recurring?.interval === 'year'
      ? 'pro_yearly' : 'pro_monthly',
  };
}
