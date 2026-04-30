'use client';
// ── Payment routing — Stripe (web) vs RevenueCat (Play Store) ─────
//
// Architecture: dual-mode. Detect runtime environment and route purchase
// flow to the right provider. RC for TWA (Bubblewrap-wrapped PWA running
// inside Play Store app), Stripe for browser web access.
//
// At launch only RC will be configured (Play Store track). Stripe path
// stays in place for future web-only tier without breaking changes.

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
 *   'revenuecat' = Play Store TWA (RC SDK handles Play Billing)
 *   'stripe'     = browser web (Stripe Checkout)
 */
export function getPaymentProvider() {
  return isPlayStoreTWA() ? 'revenuecat' : 'stripe';
}

/**
 * Initialize the appropriate payment SDK once user is authenticated.
 * No-op for Stripe (no client SDK needed for hosted checkout).
 * For RC: configures Purchases SDK with user's Supabase ID.
 *
 * Idempotent — safe to call multiple times. RC SDK ignores duplicate config.
 */
export async function initPayments(userId) {
  const provider = getPaymentProvider();
  if (provider !== 'revenuecat') return;
  if (!userId) return;

  const apiKey = process.env.NEXT_PUBLIC_REVENUECAT_PUBLIC_KEY;
  if (!apiKey) {
    console.warn('[payments] RevenueCat key not configured');
    return;
  }

  try {
    // Dynamic import — keeps RC out of main bundle for non-TWA users
    const { Purchases } = await import('@revenuecat/purchases-js');
    if (!Purchases.isConfigured()) {
      Purchases.configure({
        apiKey,
        appUserId: userId,
      });
    }
  } catch (e) {
    console.error('[payments] Failed to init RC SDK:', e);
  }
}

/**
 * Start purchase flow. plan = 'monthly' | 'yearly'.
 * - On TWA: opens Play Store native purchase sheet via RC SDK
 * - On web: redirects to Stripe Checkout
 *
 * Returns: { success: boolean, error?: string }
 */
export async function startPurchase(plan) {
  const provider = getPaymentProvider();

  if (provider === 'stripe') {
    return startStripeCheckout(plan);
  } else {
    return startRevenueCatPurchase(plan);
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
    return { success: false, error: d.error || 'Failed to open checkout' };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

async function startRevenueCatPurchase(plan) {
  try {
    const { Purchases } = await import('@revenuecat/purchases-js');

    // Get current offerings — RC's product catalog as configured in dashboard.
    const offerings = await Purchases.getOfferings();
    const current = offerings?.current;
    if (!current) {
      return { success: false, error: 'No subscription offerings configured' };
    }

    // Map plan to RC package identifier.
    // RC dashboard convention: '$rc_monthly' / '$rc_annual' for default packages.
    const pkgKey = plan === 'yearly' ? '$rc_annual' : '$rc_monthly';
    const pkg = current.availablePackages.find(p => p.identifier === pkgKey);

    if (!pkg) {
      return { success: false, error: 'Plan ' + plan + ' not available' };
    }

    const result = await Purchases.purchasePackage(pkg);

    // RC sends webhook to our server. Local SDK state also updates immediately.
    // Server fetch will reflect new status next time profile is loaded.
    if (result.customerInfo?.entitlements?.active?.pro) {
      return { success: true };
    }
    return { success: false, error: 'Purchase completed but entitlement not active' };
  } catch (e) {
    // User cancellation is not an error — RC throws but it's expected
    if (e?.userCancelled) return { success: false, error: 'cancelled' };
    return { success: false, error: e.message };
  }
}

/**
 * Restore previous purchases — typically shown as "Restore" button in settings.
 * Required by Apple guidelines, recommended for Play Store too.
 * Updates entitlements from store records.
 */
export async function restorePurchases() {
  const provider = getPaymentProvider();
  if (provider !== 'revenuecat') {
    return { success: false, error: 'Restore only available in app version' };
  }

  try {
    const { Purchases } = await import('@revenuecat/purchases-js');
    const customerInfo = await Purchases.restorePurchases();
    return {
      success: true,
      hasPro: !!customerInfo.entitlements?.active?.pro,
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * Open native subscription management screen.
 * Play Store: opens Google Play subscriptions list.
 * Web: redirects to Stripe Customer Portal.
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
  } else {
    // Play Store: deep link to subscription management
    // Format: https://play.google.com/store/account/subscriptions?package=PKG&sku=PRODUCT_ID
    const pkg = 'pl.skudev.metalvault';
    const url = 'https://play.google.com/store/account/subscriptions?package=' + pkg;
    window.location.href = url;
    return { success: true };
  }
}
