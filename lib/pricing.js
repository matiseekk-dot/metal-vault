// ── Metal Vault pricing — single source of truth ──────────────
// Imported by: UpgradeModal, landing page, stripe.js, alerts limit check.
// Rule: changing the price requires changes ONLY in this file. If you see
// hardcoded numbers in app/ or lib/ — that's a bug, report it.
//
// CURRENCY: USD as display currency. Stripe checkout auto-converts to local
// payment method (EUR, GBP, PLN, etc.) — user pays whatever their card supports.
// Display in USD avoids the awkwardness of "24.99 PLN" appearing to non-Polish users.

// ── Current prices (USD) ──
// Aggressive growth pricing — well below Spotify-tier, makes the 7-day
// trial easy to convert. ~$3/mo is "coffee money" psychology; ~$20/year
// is the impulse-buy threshold for a hobby tool. Annual saves ~44%.
//
// MUST match the base plan prices set in Google Play Console:
//   product: mv_pro_monthly · base plan: monthly · $2.99 USD (~12,99 zł)
//   product: mv_pro_yearly  · base plan: yearly  · $19.99 USD (~79,99 zł)
// And the equivalent Stripe price IDs (STRIPE_PRICE_MONTHLY/YEARLY env
// vars) when Stripe web checkout ships.
export const PRO_MONTHLY_USD = 2.99;
export const PRO_YEARLY_USD  = 19.99;

// ── Same amounts in cents (for Stripe API) ──
// Stripe and Play Billing expect amounts in the smallest currency unit.
export const PRO_MONTHLY_CENTS = Math.round(PRO_MONTHLY_USD * 100);
export const PRO_YEARLY_CENTS  = Math.round(PRO_YEARLY_USD  * 100);

// ── Free trial duration ──
// 7 days matches Play Console listing copy + industry-standard SaaS
// trial. Studies (ChartMogul/Profitwell) show 7-day trials convert
// 1.5-2× better than 14 — user evaluates urgency, not "I'll get
// back to it next week and forget". If you bump this, also update
// PLAY-CONSOLE-ODPOWIEDZI.md and re-publish the listing.
export const FREE_TRIAL_DAYS = 7;

// ── Yearly savings (for displaying "SAVE 33%") ──
// Computed automatically — no risk of stale "SAVE 35%" copy if prices change.
export const YEARLY_SAVINGS_PCT = Math.round(
  100 - (PRO_YEARLY_USD / (PRO_MONTHLY_USD * 12) * 100)
);

// ── Tier metadata ──
// Two tiers at launch: Free + Pro. A Collector tier was scoped earlier
// (market-intelligence + AI recs + bulk ops) but never wired through
// Stripe — it's been removed from this file along with the dead
// UpgradeModal toggle and STRIPE_PRICE_COLLECTOR_* env vars. If/when
// it ships, restore from git history (around commit 73dd38a).
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
