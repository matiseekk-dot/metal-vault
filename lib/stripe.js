// ── Metal Vault — Stripe client (server-only) ─────────────────
// Never import this in 'use client' components.

import Stripe from 'stripe';
import {
  PRO_MONTHLY_CENTS,
  PRO_YEARLY_CENTS,
  TIERS as PRICING_TIERS,
} from '@/lib/pricing';

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

// Pricing constants re-exported below. Source of truth: lib/pricing.js
// (import is at top of file per ESM spec)

// FREE_LIMIT_RECORDS still emitted by /api/stripe/status for any
// external consumer that reads it. Internal UI doesn't enforce a
// record cap — Pro is differentiated by feature flags, not by count.
export const FREE_LIMIT_RECORDS = 50;
// Re-exports kept for external callers (mobile shell, possibly old
// Bubblewrap script). Old PRICE_MONTHLY_PLN/PRO_*_GROSZE aliases
// dropped — name was misleading (the values were always *_CENTS).
export const PRICE_MONTHLY_CENTS = PRO_MONTHLY_CENTS;
export const PRICE_YEARLY_CENTS  = PRO_YEARLY_CENTS;
export const TIERS               = PRICING_TIERS;

/**
 * Check if a profile has an active premium subscription.
 */
/**
 * Check if a user has active premium subscription.
 *
 * Provider-agnostic: works for both Stripe (web) and RevenueCat (Play Store).
 * Both providers' webhooks write to canonical subscription_status field.
 * Use profile.subscription_source to know which provider when needed for
 * debug or provider-specific UX (e.g. "Manage in Play Store" vs "Manage on web").
 */
export function isPremium(profile) {
  if (!profile) return false;
  const s = profile.subscription_status;
  if (s === 'active' || s === 'trialing') return true;
  // Grace period: past_due gives 3 extra days regardless of provider
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
