'use client';
// ── Payment routing — Stripe (web) vs Play Billing via RevenueCat (TWA) ─────
//
// Architecture:
//   • Browser web         → Stripe Checkout (existing)
//   • Play Store TWA      → Web Digital Goods API + PaymentRequest, with the
//                           resulting purchaseToken handed to our server,
//                           which records the receipt with RevenueCat REST.
//                           RC then fires our webhook (already implemented in
//                           app/api/revenuecat/webhook) and the profile flips
//                           to active.
//
// Why not @revenuecat/purchases-capacitor here?
//   That SDK targets Capacitor wrappers around native Android code. We ship
//   as a TWA (Bubblewrap), where the platform exposes Play Billing through
//   the standard Web Platform `getDigitalGoodsService` + PaymentRequest APIs.
//   The Capacitor SDK simply doesn't run inside Chrome's TWA renderer.
//
// Bubblewrap requirement: twa-manifest.json must have `playBilling.enabled: true`
// so the runtime exposes window.getDigitalGoodsService('https://play.google.com/billing').

import { t } from '@/lib/i18n';

const PLAY_REFERRER_PREFIXES = [
  'android-app://pl.skudev.metalvault',
  'android-app://com.skudev.metalvault',
];

const PLAY_BILLING_METHOD = 'https://play.google.com/billing';

// Product IDs MUST match what's configured in Play Console → Monetize → Subscriptions
// AND in RevenueCat dashboard. See .env.example for the canonical list.
const PRODUCT_IDS = {
  monthly: 'mv_pro_monthly',
  yearly:  'mv_pro_yearly',
};

/**
 * Detect if the app is running inside a Trusted Web Activity (TWA),
 * i.e. a Play Store install. TWA sets document.referrer to android-app://...
 * for the source app on first navigation.
 */
export function isPlayStoreTWA() {
  if (typeof document === 'undefined') return false;
  const referrer = document.referrer || '';
  return PLAY_REFERRER_PREFIXES.some(prefix => referrer.startsWith(prefix));
}

/**
 * Returns the active payment provider based on runtime context.
 *   'play_billing' = Play Store TWA — Digital Goods API + RC server recording
 *   'stripe'       = browser web (Stripe Checkout)
 */
export function getPaymentProvider() {
  return isPlayStoreTWA() ? 'play_billing' : 'stripe';
}

/**
 * Initialize the payment SDK once user is authenticated.
 * Stripe is stateless from the client. Play Billing via DGS doesn't need
 * an explicit init either — the API is exposed by Bubblewrap when
 * playBilling.enabled is set. We do a quick capability probe so we can fall
 * back gracefully if the runtime hasn't enabled it.
 */
export async function initPayments(/* userId */) {
  if (!isPlayStoreTWA()) return;
  if (typeof window === 'undefined' || !window.getDigitalGoodsService) return;
  try {
    // Probe the service. Non-fatal if it fails (we'll re-check at purchase time).
    await window.getDigitalGoodsService(PLAY_BILLING_METHOD);
  } catch {
    // Bubblewrap not configured for billing yet, or running outside TWA.
  }
}

/**
 * Start the purchase flow. plan = 'monthly' | 'yearly'.
 * Returns: { success: boolean, error?: string }
 *   error === 'cancelled'  → user dismissed the sheet (don't toast)
 */
export async function startPurchase(plan) {
  return getPaymentProvider() === 'play_billing'
    ? startPlayBillingPurchase(plan)
    : startStripeCheckout(plan);
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
    return { success: false, error: d.error || t('payments.openCheckoutFail') };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

async function startPlayBillingPurchase(plan) {
  const productId = PRODUCT_IDS[plan];
  if (!productId) return { success: false, error: 'Unknown plan: ' + plan };

  if (typeof window === 'undefined'
      || !window.getDigitalGoodsService
      || typeof window.PaymentRequest === 'undefined') {
    return { success: false, error: 'In-app billing is not available on this device' };
  }

  let service;
  try {
    service = await window.getDigitalGoodsService(PLAY_BILLING_METHOD);
  } catch {
    return { success: false, error: 'Play Billing is not enabled in this app' };
  }

  // Resolve product details so PaymentRequest.show() opens the native sheet
  // with the right price string. Failure here means the SKU is missing in
  // Play Console.
  let details;
  try {
    const list = await service.getDetails([productId]);
    details = Array.isArray(list) ? list[0] : null;
  } catch (e) {
    return { success: false, error: e.message || 'Failed to load product details' };
  }
  if (!details) {
    return { success: false, error: 'Subscription product not found in Play Store: ' + productId };
  }

  // Build PaymentRequest for the Play Billing method. Total mirrors the SKU's
  // own price (Play Billing actually charges based on the SKU server-side;
  // the total field is informational for the sheet UI).
  const paymentRequest = new PaymentRequest(
    [{
      supportedMethods: PLAY_BILLING_METHOD,
      data: { sku: productId },
    }],
    {
      total: {
        label:  details.title || 'Metal Vault Pro',
        // The Web Digital Goods API returns price under details.price
        // ({ value, currency }), not as flat top-level fields. Reading
        // the legacy flat shape silently falls back to "$0" in the
        // PaymentRequest UI; functionally harmless (Play charges from
        // the SKU), but surfaces a confusing $0 to the buyer.
        amount: {
          currency: details.price?.currency || details.currency || 'USD',
          value:    details.price?.value    || details.value    || '0',
        },
      },
    },
  );

  let response;
  try {
    response = await paymentRequest.show();
  } catch (e) {
    if (e?.name === 'AbortError') return { success: false, error: 'cancelled' };
    return { success: false, error: e.message || 'Payment failed' };
  }

  const purchaseToken = response.details?.token;
  if (!purchaseToken) {
    await response.complete('fail');
    return { success: false, error: 'Missing purchase token from Play Billing' };
  }

  // Hand the token to our server, which records it with RevenueCat. RC
  // validates with Google Play and fires INITIAL_PURCHASE → our webhook
  // updates the profile.
  try {
    const r = await fetch('/api/revenuecat/record-purchase', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ purchaseToken, productId, plan }),
    });
    const data = await r.json();
    if (!r.ok || !data.ok) {
      await response.complete('fail');
      return { success: false, error: data.error || 'Failed to record purchase' };
    }
    await response.complete('success');
    return { success: true };
  } catch (e) {
    await response.complete('fail');
    return { success: false, error: e.message };
  }
}

/**
 * Restore previous purchases — for Play Store users to recover entitlement
 * after reinstall. Queries DGS for existing purchase tokens, then forwards
 * them to the server which re-records them with RC (idempotent).
 */
export async function restorePurchases() {
  if (getPaymentProvider() !== 'play_billing') {
    return { success: false, error: 'Restore is only available in the Play Store app' };
  }
  if (typeof window === 'undefined' || !window.getDigitalGoodsService) {
    return { success: false, error: 'In-app billing is not available on this device' };
  }
  let service;
  try {
    service = await window.getDigitalGoodsService(PLAY_BILLING_METHOD);
  } catch {
    return { success: false, error: 'Play Billing is not enabled in this app' };
  }
  let existingPurchases = [];
  try {
    existingPurchases = (await service.listPurchases()) || [];
  } catch (e) {
    return { success: false, error: e.message || 'Failed to list purchases' };
  }
  if (existingPurchases.length === 0) {
    return { success: true, restored: 0 };
  }
  try {
    const r = await fetch('/api/revenuecat/record-purchase', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ restore: existingPurchases }),
    });
    const data = await r.json();
    if (!r.ok || !data.ok) {
      return { success: false, error: data.error || 'Failed to restore purchases' };
    }
    return { success: true, restored: existingPurchases.length };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * Open native subscription management screen.
 *   Web (Stripe): Customer Portal redirect.
 *   Play Store:   deep link to Google Play subscriptions for our package.
 */
export async function openSubscriptionManagement() {
  if (getPaymentProvider() === 'stripe') {
    try {
      const r = await fetch('/api/stripe/portal', { method: 'POST' });
      const d = await r.json();
      if (d.url) {
        window.location.href = d.url;
        return { success: true };
      }
      return { success: false, error: d.error || t('payments.openPortalFail') };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }
  // Play Store deep link doesn't need the SDK.
  const pkg = 'pl.skudev.metalvault';
  window.location.href =
    'https://play.google.com/store/account/subscriptions?package=' + pkg;
  return { success: true };
}
