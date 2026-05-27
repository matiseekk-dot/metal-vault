'use client';
// ── Payment routing — Stripe (web) vs Play Billing (Capacitor native plugin) ─
//
// Architecture (post-1.0.8 migration from TWA to Capacitor):
//   • Browser web         → Stripe Checkout (existing)
//   • Capacitor Android   → @revenuecat/purchases-capacitor → native Google
//                           Play Billing Library. The native SDK handles the
//                           PurchaseSheet UI, receipt validation, and entitlement
//                           sync. Our server-side RC webhook
//                           (app/api/revenuecat/webhook) catches the resulting
//                           INITIAL_PURCHASE event and flips the profile to active
//                           — unchanged from the prior TWA setup.
//   • TWA (Bubblewrap)    → legacy path via Web Digital Goods API. Retained as
//                           a fallback for any old TWA installs that haven't
//                           moved to the Capacitor build yet; new installs
//                           ride the Capacitor path.
//
// Why @revenuecat/purchases-capacitor instead of Web Digital Goods API in
// Capacitor mode? Capacitor's WebView is plain Chrome WebView — it does NOT
// expose window.getDigitalGoodsService. That API only exists in Chrome's
// TWA renderer. Capacitor needs a native Android plugin that talks to the
// Google Play Billing Library directly through JNI, which is exactly what
// @revenuecat/purchases-capacitor provides.

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
 * Detect Capacitor native shell (Android app shipped via Capacitor).
 * Different from TWA — Capacitor doesn't set document.referrer to
 * android-app:// the way Bubblewrap does, so we probe window.Capacitor.
 */
export function isCapacitorApp() {
  return typeof window !== 'undefined'
    && !!window.Capacitor
    && typeof window.Capacitor.isNativePlatform === 'function'
    && window.Capacitor.isNativePlatform();
}

/**
 * Returns the active payment provider based on runtime context.
 *   'rc_capacitor' = Capacitor native build — RevenueCat Purchases SDK
 *   'play_billing' = legacy TWA install — Digital Goods API
 *   'stripe'       = browser web — Stripe Checkout
 */
export function getPaymentProvider() {
  if (isCapacitorApp())   return 'rc_capacitor';
  if (isPlayStoreTWA())   return 'play_billing';
  return 'stripe';
}

/**
 * Initialize the payment SDK once user is authenticated.
 *   Stripe        → no init needed (stateless)
 *   TWA           → quick getDigitalGoodsService probe
 *   Capacitor     → RevenueCat Purchases SDK + logIn with the Supabase user
 *                   id so receipts are attributed to the right profile
 */
export async function initPayments(userId) {
  const provider = getPaymentProvider();

  if (provider === 'play_billing') {
    if (typeof window === 'undefined' || !window.getDigitalGoodsService) return;
    try {
      await window.getDigitalGoodsService(PLAY_BILLING_METHOD);
    } catch {}
    return;
  }

  if (provider === 'rc_capacitor') {
    try {
      const { Purchases, LOG_LEVEL } = await import('@revenuecat/purchases-capacitor');
      const apiKey = process.env.NEXT_PUBLIC_REVENUECAT_ANDROID_KEY
                  || process.env.NEXT_PUBLIC_REVENUECAT_PUBLIC_KEY;
      if (!apiKey) {
        console.warn('[Payments] RevenueCat Android API key not set');
        return;
      }
      await Purchases.setLogLevel({ level: LOG_LEVEL.WARN });
      await Purchases.configure({
        apiKey,
        appUserID: userId || null,   // anonymous OK; we logIn below if we have one
      });
      if (userId) {
        try { await Purchases.logIn({ appUserID: userId }); } catch {}
      }
    } catch (e) {
      console.warn('[Payments] RC init failed:', e?.message);
    }
  }
}

/**
 * Start the purchase flow. plan = 'monthly' | 'yearly'.
 * Returns: { success: boolean, error?: string }
 *   error === 'cancelled'  → user dismissed the sheet (don't toast)
 */
export async function startPurchase(plan) {
  const provider = getPaymentProvider();
  if (provider === 'rc_capacitor')  return startRcCapacitorPurchase(plan);
  if (provider === 'play_billing')  return startPlayBillingPurchase(plan);
  return startStripeCheckout(plan);
}

// ── RevenueCat Capacitor (native Google Play Billing) ─────────
//
// Flow (post-1.0.8 Capacitor app):
//   1. Purchases.getOfferings() → resolves the products the user
//      should see. RC dashboard's "current" offering is the
//      pre-configured monthly + yearly package set; the dashboard
//      decides which products map to which plans, so we don't
//      hard-code product IDs here (unlike the TWA path).
//   2. Purchases.purchasePackage(pkg) → opens the native Play
//      Billing sheet. Returns a CustomerInfo object with the
//      active entitlements.
//   3. Server-side: RC fires INITIAL_PURCHASE → our webhook updates
//      profile.is_pro = true → next refreshProfile() sees the change.
async function startRcCapacitorPurchase(plan) {
  try {
    const { Purchases, PURCHASES_ERROR_CODE } = await import('@revenuecat/purchases-capacitor');

    // Pull current offering. Each offering has .monthly / .annual /
    // .lifetime convenience accessors that resolve to the matching
    // Package object from RC.
    const offeringsRes = await Purchases.getOfferings();
    const current = offeringsRes?.current;
    if (!current) {
      return { success: false, error: 'No subscription offering configured' };
    }

    const pkg = plan === 'yearly' ? current.annual : current.monthly;
    if (!pkg) {
      return { success: false, error: `Plan "${plan}" not available` };
    }

    const purchaseRes = await Purchases.purchasePackage({ aPackage: pkg });

    // User-cancelled and any-other-error paths return as exceptions —
    // but defensive check: if no entitlements are now active, treat
    // as failure.
    const ent = purchaseRes?.customerInfo?.entitlements?.active || {};
    const hasPro = !!(ent.pro || ent.Pro || ent['metal-vault-pro']);
    if (!hasPro) {
      // Purchase didn't activate any entitlement. RC will still fire
      // INITIAL_PURCHASE via webhook so the server can correct; just
      // surface a generic "processing" message.
      return { success: true, pending: true };
    }
    return { success: true };
  } catch (e) {
    // RC Capacitor SDK throws PurchasesError with .code field.
    const code = e?.code || e?.userCancelled ? 1 : null;
    if (code === 1 || /cancel/i.test(e?.message || '')) {
      return { success: false, error: 'cancelled' };
    }
    return { success: false, error: e?.message || 'Purchase failed' };
  }
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
 * after reinstall.
 */
export async function restorePurchases() {
  const provider = getPaymentProvider();

  // Capacitor: RC SDK has a dedicated restorePurchases() that pulls every
  // active Play Billing subscription owned by the signed-in Google Play
  // account and re-syncs entitlements server-side.
  if (provider === 'rc_capacitor') {
    try {
      const { Purchases } = await import('@revenuecat/purchases-capacitor');
      const res = await Purchases.restorePurchases();
      const ent = res?.customerInfo?.entitlements?.active || {};
      const restored = Object.keys(ent).length;
      return { success: true, restored };
    } catch (e) {
      return { success: false, error: e?.message || 'Restore failed' };
    }
  }

  if (provider !== 'play_billing') {
    return { success: false, error: 'Restore is only available in the mobile app' };
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
  const provider = getPaymentProvider();
  // Capacitor: same Play Store subscription management URL as TWA;
  // RC SDK doesn't open it directly — we punt to the Play Store deep
  // link below.
  if (provider === 'stripe') {
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
