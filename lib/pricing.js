// ── Metal Vault pricing — single source of truth ──────────────
// Importowane przez: UpgradeModal, landing page, stripe.js, alerts limit check.
// Reguła: zmiana ceny wymaga zmiany TYLKO w tym pliku. Jeśli widzisz
// hardkodowaną kwotę gdziekolwiek w app/ lub lib/ — to bug, zgłoś.

// ── Aktualne ceny (PLN, brutto) ──
export const PRO_MONTHLY_PLN = 24.99;
export const PRO_YEARLY_PLN  = 199;

// ── Te same kwoty w grosze (dla Stripe API) ──
// Stripe i Play Billing oczekują kwoty w najmniejszej jednostce waluty.
export const PRO_MONTHLY_GROSZE = Math.round(PRO_MONTHLY_PLN * 100);
export const PRO_YEARLY_GROSZE  = Math.round(PRO_YEARLY_PLN  * 100);

// ── Free trial ──
export const FREE_TRIAL_DAYS = 14;

// ── Yearly savings (do wyświetlania "SAVE 34%") ──
// Computed automatically — no risk of stale "SAVE 35%" copy if prices change.
export const YEARLY_SAVINGS_PCT = Math.round(
  100 - (PRO_YEARLY_PLN / (PRO_MONTHLY_PLN * 12) * 100)
);

// ── Tier metadata ──
// Collector tier disabled na launch. Trzymane w kodzie jako shape żeby
// nie wywalać UpgradeModal ifów, ale ceny są null = tier niedostępny do checkout.
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
    monthly:     PRO_MONTHLY_PLN,
    yearly:      PRO_YEARLY_PLN,
    alertLimit:  Infinity,
    available:   true,
    trialDays:   FREE_TRIAL_DAYS,
  },
  collector: {
    name:        'Collector',
    monthly:     null,
    yearly:      null,
    alertLimit:  Infinity,
    available:   false,    // wyłączone na launch — checkout zwróci 400
    trialDays:   FREE_TRIAL_DAYS,
  },
};

// ── Display helpers — formatowanie cen w UI ──
// Polski format: "24.99 PLN" (kropka jako separator dziesiętny — branża SaaS).
// Roczny: "199 PLN" bez ".00" gdy okrągłe.
export function formatPrice(amount, period) {
  if (amount == null || amount === 0) return 'Free';
  const formatted = Number.isInteger(amount) ? String(amount) : amount.toFixed(2);
  const periodSuffix = period === 'monthly' ? '/mo' : period === 'yearly' ? '/yr' : '';
  return formatted + ' PLN' + periodSuffix;
}

// ── Sanity check: in dev mode warn if env price IDs are missing ──
// Cena w PLN w kodzie nie wystarczy — Stripe potrzebuje też product ID.
// Webhook checkout odrzuci request jeśli mismatch. Lepiej warnować early.
export function validatePricingEnv() {
  const required = ['STRIPE_PRICE_MONTHLY', 'STRIPE_PRICE_YEARLY'];
  const missing = required.filter(k => !process.env[k]);
  return { ok: missing.length === 0, missing };
}
