// ── Lightweight i18n (no external lib) ────────────────────────
// Usage:
//   import { useT, setLocale, getLocale } from '@/lib/i18n';
//   const t = useT();
//   t('onboarding.step1.title')  // returns translated string
//
// Adding translations: just add key/value to both `en` and `pl` maps below.
// Missing keys fall back to English; missing English = key itself.

import { useState, useEffect } from 'react';

const TRANSLATIONS = {
  en: {
    'common.continue':       'CONTINUE',
    'common.skip':           'Skip for now',
    'common.cancel':         'Cancel',
    'common.save':           'SAVE',
    'common.loading':        'Loading…',
    'common.retry':          'Try again',
    'common.back':           'Back',
    'common.next':           'Next',
    'common.enable':         'ENABLE',
    'common.connect':        'CONNECT',
    'common.upgrade':        'UPGRADE',
    'common.free':           'FREE',
    'common.pro':            'PRO',
    'common.yes':            'Yes',
    'common.no':             'No',
    'common.edit':           'Edit',
    'common.delete':         'Delete',
    'common.add':            'Add',
    'common.settings':       'Settings',

    'nav.feed':              'RELEASES',
    'nav.collection':        'COLLECTION',
    'nav.bands':             'BANDS',
    'nav.stats':             'STATS',
    'nav.profile':           'PROFILE',
    'nav.search':            'SEARCH',

    'onboarding.step1.title':    'METAL VAULT',
    'onboarding.step1.sub':      'YOUR VINYL UNIVERSE',
    'onboarding.step1.desc':     'Track your collection, discover upcoming pre-orders, monitor market prices, and generate insurance reports — all for your metal records.',
    'onboarding.step1.bullet1':  'Unlimited records',
    'onboarding.step1.bullet2':  'Price alerts',
    'onboarding.step1.bullet3':  'Pre-order feed',
    'onboarding.step1.bullet4':  'Insurance PDFs (Pro)',

    'onboarding.step2.title':    'CONNECT DISCOGS',
    'onboarding.step2.sub':      'STEP 1 OF 4  ·  RECOMMENDED',
    'onboarding.step2.desc':     'Link your Discogs to automatically import your collection and fetch live market prices. You can skip this and add records manually.',
    'onboarding.step2.cta':      '🔗 CONNECT DISCOGS',

    'onboarding.step3.title':    'SYNC YOUR VAULT',
    'onboarding.step3.sub':      'STEP 2 OF 4',
    'onboarding.step3.desc':     'We pull your vinyl — artist, album, format, price paid — into your private vault and keep it in sync.',

    'onboarding.step4.title':    'ENABLE NOTIFICATIONS',
    'onboarding.step4.sub':      'STEP 3 OF 4  ·  OPTIONAL',
    'onboarding.step4.desc':     'Get a push notification when your followed artists announce a new album or a watched record drops below your target price.',
    'onboarding.step4.cta':      '🔔 ENABLE NOTIFICATIONS',
    'onboarding.step4.done':     '✓ Notifications enabled! Click Continue.',

    'onboarding.step5.title':    'YOU ARE READY',
    'onboarding.step5.sub':      'STEP 4 OF 4',
    'onboarding.step5.desc':     'Start adding records, following artists, and tracking prices. Upgrade to Pro anytime for detailed grading, insurance reports and price history.',
    'onboarding.step5.cta':      '🤘 ENTER THE VAULT',

    'empty.vault.title':         'Your vault is empty',
    'empty.vault.desc':          'Start with a Discogs sync (2 min) or add your first record manually.',
    'empty.vault.connect':       '🔗 CONNECT DISCOGS',
    'empty.vault.add':           '＋ ADD FIRST RECORD',
    'empty.vault.scan':          '📷 Scan a barcode instead',
    'empty.vault.tip':           'Tip: you can also import a CSV in the Profile tab.',

    'paywall.upgradeTo':         'Upgrade to',
    'paywall.title':             'METAL VAULT PRO',
    'paywall.trial':             '7-day free trial · cancel anytime',
    'paywall.monthly':           'Monthly',
    'paywall.yearly':            'Yearly',
    'paywall.yearlyBadge':       'SAVE 38%',
    'paywall.cta':               '🤘 START FREE TRIAL',
    'paywall.cta.loading':       'REDIRECTING…',
    'paywall.laterBtn':          'Maybe later',
    'paywall.powered':           'Powered by Stripe · BLIK, P24, card accepted · cancel anytime',

    'paywall.reason.ALERT_LIMIT_REACHED': '🔔 Free plan includes 3 price alerts. Go unlimited with Pro.',
    'paywall.reason.PREMIUM_REQUIRED':    '⚡ This feature requires Metal Vault Pro.',
    'paywall.reason.PRICE_HISTORY':       '📈 Price history is a Pro feature — see how your collection\'s value changes over time.',
    'paywall.reason.INSURANCE_REQUIRED':  '🏛️ Insurance-grade PDF reports are a Pro feature — document your collection\'s value for your insurer.',
    'paywall.reason.DETAILED_GRADING':    '💎 Detailed grading (sleeve, vinyl, inner, hype sticker) is a Pro feature.',
    'paywall.reason.EXPORT_REQUIRED':     '📤 CSV/JSON export is a Pro feature — back up or migrate your collection.',
    'paywall.reason.ON_DEMAND_REFRESH':   '⚡ On-demand price refresh is a Pro feature — Free plan updates daily.',
    'paywall.reason.PHOTO_LIMIT_REACHED': '📷 Photograph your collection — Pro lets you upload up to 6 photos per record. Perfect for insurance evidence, numbered variants, and signed copies.',

    'profile.push.title':        'Push Notifications',
    'profile.push.desc':         'Price alerts + new pre-orders',
    'profile.push.enabled':      '✓ Enabled — price alerts + pre-orders from followed artists',
    'profile.insurance.title':   'Insurance Report',
    'profile.insurance.subtitle':'Generate appraisal PDF',
    'profile.insurance.desc':    'Formal collection inventory with market valuations — ready for your insurance policy',
    'profile.insurance.generate':'📄 GENERATE REPORT',
    'profile.insurance.addFirst':'ADD RECORDS FIRST',
  },
};

const LS_KEY = 'mv_locale';
let currentLocale = null;

function detectBrowserLocale() {
  // Currently English-only — keeping the i18n machinery in place so we can
  // add languages later (DE, JP, etc. for global metal markets) without
  // refactoring. Adding a locale = add it to TRANSLATIONS map + add detection here.
  return 'en';
}

export function getLocale() {
  if (currentLocale) return currentLocale;
  if (typeof localStorage !== 'undefined') {
    const stored = localStorage.getItem(LS_KEY);
    // Only honor stored value if it's a currently-supported locale.
    // Migration: existing users with 'pl' will fall through to 'en' default.
    if (stored && TRANSLATIONS[stored]) {
      currentLocale = stored;
      return currentLocale;
    }
  }
  currentLocale = detectBrowserLocale();
  return currentLocale;
}

export function setLocale(locale) {
  if (!TRANSLATIONS[locale]) return;
  currentLocale = locale;
  try { localStorage.setItem(LS_KEY, locale); } catch {}
  // Notify subscribed components to re-render
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('mv:locale-changed', { detail: { locale } }));
  }
}

export function t(key) {
  const locale = getLocale();
  const dict = TRANSLATIONS[locale] || TRANSLATIONS.en;
  return dict[key] || TRANSLATIONS.en[key] || key;
}

// React hook — re-renders component when locale changes
export function useT() {
  const [, setTick] = useState(0);
  useEffect(() => {
    const handler = () => setTick(x => x + 1);
    window.addEventListener('mv:locale-changed', handler);
    return () => window.removeEventListener('mv:locale-changed', handler);
  }, []);
  return t;
}
