'use client';
// ── Payment routing — Stripe (web) vs RevenueCat (Play Store) ─────
//
// Architecture: dual-mode. Detect runtime environment and route purchase
// flow to the right provider. RC for TWA (Bubblewrap-wrapped PWA running
// inside Play Store app), Stripe for browser web access.
//
// CURRENT STATE:
//   - Stripe path: fully implemented and working
//   - RevenueCat path: BACKEND READY (webhook + DB schema), but client SDK
//     not yet integrated. We'll add @revenuecat/purchases-capacitor (or
//     the appropriate SDK for our TWA stack) in Etap 3 when we deploy to
//     Play Store. Until then, TWA users will see a "not yet available"
//     message — but TWA users don't exist yet anyway because we're not
//     on Play Store.
//
// When integrating the SDK, the RC code is preserved in
// `lib/payments-rc.future.js` for reference. Move/inline back into this
// file once npm package is in package.json.

const PLAY_REFERRER_PREFIXES = [
  'android-app://pl.skudev.metalvault',
  'android-app://com.skudev.metalvault',
];

/**
 * Detect if the app is running inside a Trusted Web Activity (TWA),
 * i.e. Play Store install. TWA sets document.referrer to android-app://...
 * for the source app on first navigation.
 */
export function isPlayStoreTWA() {
  if (typeof document === 'undefined') return false;
  const referrer = document.referrer || '';
  return PLAY_REFERRER_PREFIXES.some(prefix => referrer.startsWith(prefix));
}

/**
 * Returns the active payment provider based on runtime context.
 *   'revenuecat' = Play Store TWA (RC SDK handles Play Billing) — NOT YET INTEGRATED
 *   'stripe'     = browser web (Stripe Checkout)
 */
export function getPaymentProvider() {
  return isPlayStoreTWA() ? 'revenuecat' : 'stripe';
}

/**
 * Initialize the appropriate payment SDK once user is authenticated.
 * Currently no-op for both providers (Stripe doesn't need client SDK,
 * RC SDK not yet integrated).
 */
export async function initPayments(userId) {
  // Reserved for future RC SDK init when we add @revenuecat/purchases-capacitor
  // For now, both Stripe and RC paths are stateless from the client side.
  return;
}

/**
 * Start purchase flow. plan = 'monthly' | 'yearly'.
 * Returns: { success: boolean, error?: string }
 */
export async function startPurchase(plan) {
  const provider = getPaymentProvider();

  if (provider === 'stripe') {
    return startStripeCheckout(plan);
  }

  // RC path — backend ready but client SDK not yet integrated.
  // This branch should never hit until we deploy to Play Store, because
  // TWA referrer only exists when launched from Play Store app.
  return {
    success: false,
    error: 'In-app purchases coming soon. Please use the web version to subscribe.',
  };
}

async function startStripeCheckout(plan) {
  try {
    const r = await fetch('/api/stripe/checkout', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ plan }),
    });
    const d = await r.json();
    if (d.url) {
      window.location.href = d.url;
      return { success: true };
    }
    return { success: false, error: d.error || 'Failed to open checkout' };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * Restore previous purchases — for Play Store users to recover entitlement
 * after reinstall. Currently no-op (RC SDK not yet integrated).
 */
export async function restorePurchases() {
  return {
    success: false,
    error: 'Restore not yet available in this version',
  };
}

/**
 * Open native subscription management screen.
 * Web (Stripe): Customer Portal redirect.
 * Play Store: deep link to Google Play subscriptions.
 */
export async function openSubscriptionManagement() {
  const provider = getPaymentProvider();

  if (provider === 'stripe') {
    try {
      const r = await fetch('/api/stripe/portal', { method: 'POST' });
      const d = await r.json();
      if (d.url) {
        window.location.href = d.url;
        return { success: true };
      }
      return { success: false, error: d.error || 'Failed to open portal' };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  // Play Store deep link doesn't need any SDK
  const pkg = 'pl.skudev.metalvault';
  const url = 'https://play.google.com/store/account/subscriptions?package=' + pkg;
  window.location.href = url;
  return { success: true };
}
