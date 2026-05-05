// ── Metal Vault pricing — single source of truth ──────────────
// Imported by: UpgradeModal, landing page, stripe.js, alerts limit check.
// Rule: changing the price requires changes ONLY in this file. If you see
// hardcoded numbers in app/ or lib/ — that's a bug, report it.
//
// CURRENCY: USD as display currency. Stripe checkout auto-converts to local
// payment method (EUR, GBP, PLN, etc.) — user pays whatever their card supports.
// Display in USD avoids the awkwardness of "24.99 PLN" appearing to non-Polish users.

// ── Current prices (USD) ──
// Aggressive growth pricing — cheaper than CLZ Music, cheaper than Spotify,
// targeting "low friction" entry for global metal collectors.
export const PRO_MONTHLY_USD = 4.99;
export const PRO_YEARLY_USD  = 39.99;

// ── Same amounts in cents (for Stripe API) ──
// Stripe and Play Billing expect amounts in the smallest currency unit.
export const PRO_MONTHLY_CENTS = Math.round(PRO_MONTHLY_USD * 100);
export const PRO_YEARLY_CENTS  = Math.round(PRO_YEARLY_USD  * 100);

// ── Free trial duration ──
export const FREE_TRIAL_DAYS = 14;

// ── Yearly savings (for displaying "SAVE 33%") ──
// Computed automatically — no risk of stale "SAVE 35%" copy if prices change.
export const YEARLY_SAVINGS_PCT = Math.round(
  100 - (PRO_YEARLY_USD / (PRO_MONTHLY_USD * 12) * 100)
);

// ── Tier metadata ──
// Collector tier disabled at launch. Kept as shape so UpgradeModal ifs
// don't break, but prices are null = tier not available for checkout.
export const TIERS = {
  free: {
    name:        'Free',
    monthly:     0,
    yearly:      0,
    alertLimit:  3,
    available:   true,
  },
  pro: {
    name:        'Pro',
    monthly:     PRO_MONTHLY_USD,
    yearly:      PRO_YEARLY_USD,
    alertLimit:  Infinity,
    available:   true,
    trialDays:   FREE_TRIAL_DAYS,
  },
  collector: {
    name:        'Collector',
    monthly:     null,
    yearly:      null,
    alertLimit:  Infinity,
    available:   false,    // disabled at launch — checkout returns 400
    trialDays:   FREE_TRIAL_DAYS,
  },
};

// ── Display helpers — pricing format in UI ──
// Format: "$4.99/mo" or "$39.99/yr". Standard US formatting; international
// users will see Stripe's localized currency at checkout.
export function formatPrice(amount, period) {
  if (amount == null || amount === 0) return 'Free';
  const formatted = Number.isInteger(amount) ? String(amount) : amount.toFixed(2);
  const periodSuffix = period === 'monthly' ? '/mo' : period === 'yearly' ? '/yr' : '';
  return '$' + formatted + periodSuffix;
}

// ── Sanity check: in dev mode warn if env price IDs are missing ──
// USD prices in code aren't enough — Stripe also needs the product ID for
// the corresponding USD product. Webhook checkout will reject mismatch.
export function validatePricingEnv() {
  const required = ['STRIPE_PRICE_MONTHLY', 'STRIPE_PRICE_YEARLY'];
  const missing = required.filter(k => !process.env[k]);
  return { ok: missing.length === 0, missing };
}

// (Old PLN/GROSZE backward-compat aliases removed — grep confirms zero
// importers left in app/ and lib/. Use PRO_MONTHLY_USD / PRO_YEARLY_USD
// + the *_CENTS variants going forward.)
