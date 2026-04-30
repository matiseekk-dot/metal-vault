// ── RevenueCat server-side helpers ────────────────────────────
// Handles incoming webhooks from RevenueCat → updates user profile
// subscription state. Maps RC event types to our canonical
// subscription_status / subscription_end columns.
//
// Architecture: dual-mode payment provider.
//   Stripe webhook (/api/stripe/webhook) — for web checkout (future)
//   RC webhook    (/api/revenuecat/webhook) — for Play Store (current)
// Both write to the same `profiles.subscription_status` field.
// `isPremium()` doesn't care which provider made the sub — single check.

// RC event types we care about:
//   INITIAL_PURCHASE   — first subscription
//   RENEWAL            — successful renewal
//   CANCELLATION       — user canceled (still active until period end)
//   EXPIRATION         — subscription ended (no renewal)
//   BILLING_ISSUE      — payment failed (similar to past_due)
//   PRODUCT_CHANGE     — switched plan (monthly→yearly etc.)
//   UNCANCELLATION     — user re-subscribed before expiration
//   SUBSCRIBER_ALIAS   — RC merged identities (handle, but rare)
//
// Events we ignore:
//   TEMPORARY_ENTITLEMENT_GRANT — promotional, not real billing
//   TRANSFER                    — multi-device same user
//   TEST                        — RC dashboard test events

/**
 * Map an RC entitlement to our canonical subscription_status.
 * Active entitlements with future expiration → 'active' or 'trialing'.
 * Recently expired but in grace period → 'past_due'.
 * Otherwise → 'canceled' or null.
 */
export function mapEntitlementToStatus(entitlement) {
  if (!entitlement) return { status: null, end: null };

  const expiresMs = entitlement.expires_date_ms || entitlement.expires_date_in_milliseconds;
  if (!expiresMs) return { status: null, end: null };

  const now    = Date.now();
  const expiry = Number(expiresMs);

  // Future expiration = active subscription
  if (expiry > now) {
    // Trial detection: RC marks period_type as 'TRIAL' or 'INTRO'
    const isTrial = entitlement.period_type === 'TRIAL' || entitlement.period_type === 'INTRO';
    return {
      status: isTrial ? 'trialing' : 'active',
      end:    new Date(expiry).toISOString(),
    };
  }

  // Past expiration — but maybe user just paused. RC's `is_in_billing_retry`
  // would tell us, but it's not always present. Default to 'canceled'.
  return {
    status: 'canceled',
    end:    new Date(expiry).toISOString(),
  };
}

/**
 * Process a RevenueCat webhook event. Returns the profile update payload
 * to apply (or null if event is ignored).
 *
 * NOTE: caller is responsible for idempotency (insert into revenuecat_events
 * before calling this).
 */
export function processWebhookEvent(event) {
  const e = event?.event;
  if (!e || !e.app_user_id) return null;

  const ignored = ['TEMPORARY_ENTITLEMENT_GRANT', 'TRANSFER', 'TEST', 'SUBSCRIBER_ALIAS'];
  if (ignored.includes(e.type)) return null;

  // Determine the active entitlement.
  // RC sends `entitlement_id` for the affected entitlement, plus the full
  // entitlements object on the subscriber.
  const entitlements = e.entitlement_ids || (e.entitlement_id ? [e.entitlement_id] : []);
  if (entitlements.length === 0 && e.type !== 'EXPIRATION' && e.type !== 'CANCELLATION') {
    return null;
  }

  // Find 'pro' entitlement (we only have one entitlement currently).
  // For EXPIRATION / CANCELLATION events, fall back to clearing state.
  const isTerminal = e.type === 'EXPIRATION';
  const productId  = e.product_id || null;
  const expiresMs  = e.expiration_at_ms || e.event_timestamp_ms;

  let status = null;
  let end    = expiresMs ? new Date(Number(expiresMs)).toISOString() : null;

  if (e.type === 'INITIAL_PURCHASE') {
    // New sub. period_type tells us if it's trial or paid.
    status = e.period_type === 'TRIAL' ? 'trialing' : 'active';
  } else if (e.type === 'RENEWAL' || e.type === 'UNCANCELLATION') {
    status = 'active';
  } else if (e.type === 'PRODUCT_CHANGE') {
    // Plan switch (monthly → yearly etc.). Stay active.
    status = 'active';
  } else if (e.type === 'CANCELLATION') {
    // User canceled but sub still active until expires_at.
    // Keep 'active' status — they paid, they get the period.
    // Status will flip to 'canceled' on EXPIRATION event later.
    status = 'active';
  } else if (e.type === 'BILLING_ISSUE') {
    status = 'past_due';
  } else if (e.type === 'EXPIRATION') {
    status = 'canceled';
  }

  // Plan: 'yearly' if product_id ends in 'yearly' or 'annual', else 'monthly'.
  // This matches our STRIPE_PRICE_MONTHLY / STRIPE_PRICE_YEARLY conventions.
  let plan = null;
  if (productId) {
    plan = /yearly|annual/i.test(productId) ? 'yearly' : 'monthly';
  }

  return {
    subscription_status:      status,
    subscription_end:         end,
    subscription_source:      'revenuecat',
    revenuecat_user_id:       e.app_user_id,
    revenuecat_entitlements:  e.entitlements || null,
    plan,
    subscription_id:          e.original_transaction_id || e.transaction_id || null,
  };
}

/**
 * Verify webhook authorization.
 * RevenueCat sends a custom Authorization header that you set in the
 * RC dashboard. We compare against env var REVENUECAT_WEBHOOK_SECRET.
 */
export function verifyWebhookAuth(authHeader) {
  const expected = process.env.REVENUECAT_WEBHOOK_SECRET;
  if (!expected) {
    // Misconfigured server. Reject all webhooks.
    return false;
  }
  // RC sends `Authorization: Bearer <secret>` based on what you set in dashboard
  return authHeader === 'Bearer ' + expected || authHeader === expected;
}
