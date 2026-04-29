// ── Metal Vault — Stripe client (server-only) ─────────────────
// Never import this in 'use client' components.

import Stripe from 'stripe';
import {
  PRO_MONTHLY_GROSZE,
  PRO_YEARLY_GROSZE,
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

export const FREE_LIMIT_RECORDS  = 50;  // unused currently — kept for future
export const PRICE_MONTHLY_PLN   = PRO_MONTHLY_GROSZE;
export const PRICE_YEARLY_PLN    = PRO_YEARLY_GROSZE;
export const TIERS               = PRICING_TIERS;

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
