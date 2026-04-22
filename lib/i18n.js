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

    'profile.push.title':        'Push Notifications',
    'profile.push.desc':         'Price alerts + new pre-orders',
    'profile.push.enabled':      '✓ Enabled — price alerts + pre-orders from followed artists',
    'profile.insurance.title':   'Insurance Report',
    'profile.insurance.subtitle':'Generate appraisal PDF',
    'profile.insurance.desc':    'Formal collection inventory with market valuations — ready for your insurance policy',
    'profile.insurance.generate':'📄 GENERATE REPORT',
    'profile.insurance.addFirst':'ADD RECORDS FIRST',
  },
  pl: {
    'common.continue':       'DALEJ',
    'common.skip':           'Pomiń',
    'common.cancel':         'Anuluj',
    'common.save':           'ZAPISZ',
    'common.loading':        'Ładowanie…',
    'common.retry':          'Spróbuj ponownie',
    'common.back':           'Wstecz',
    'common.next':           'Dalej',
    'common.enable':         'WŁĄCZ',
    'common.connect':        'POŁĄCZ',
    'common.upgrade':        'ULEPSZ',
    'common.free':           'DARMOWY',
    'common.pro':            'PRO',
    'common.yes':            'Tak',
    'common.no':             'Nie',
    'common.edit':           'Edytuj',
    'common.delete':         'Usuń',
    'common.add':            'Dodaj',
    'common.settings':       'Ustawienia',

    'nav.feed':              'PREMIERY',
    'nav.collection':        'KOLEKCJA',
    'nav.bands':             'ZESPOŁY',
    'nav.stats':             'STATYSTYKI',
    'nav.profile':           'PROFIL',
    'nav.search':            'SZUKAJ',

    'onboarding.step1.title':    'METAL VAULT',
    'onboarding.step1.sub':      'TWÓJ METALOWY ŚWIAT',
    'onboarding.step1.desc':     'Śledź swoją kolekcję, odkrywaj pre-ordery, monitoruj ceny rynkowe i generuj dokumenty do ubezpieczenia — wszystko dla Twoich metalowych płyt.',
    'onboarding.step1.bullet1':  'Nieograniczone płyty',
    'onboarding.step1.bullet2':  'Alerty cenowe',
    'onboarding.step1.bullet3':  'Feed pre-orderów',
    'onboarding.step1.bullet4':  'Dokumenty ubezpieczeniowe (Pro)',

    'onboarding.step2.title':    'POŁĄCZ DISCOGS',
    'onboarding.step2.sub':      'KROK 1 Z 4  ·  ZALECANE',
    'onboarding.step2.desc':     'Połącz swoje konto Discogs, aby automatycznie zaimportować kolekcję i pobierać aktualne ceny rynkowe. Możesz to pominąć i dodawać płyty ręcznie.',
    'onboarding.step2.cta':      '🔗 POŁĄCZ DISCOGS',

    'onboarding.step3.title':    'SYNCHRONIZACJA',
    'onboarding.step3.sub':      'KROK 2 Z 4',
    'onboarding.step3.desc':     'Pobieramy Twoje płyty — wykonawca, album, format, cena zakupu — do Twojego prywatnego vaulta i utrzymujemy synchronizację.',

    'onboarding.step4.title':    'WŁĄCZ POWIADOMIENIA',
    'onboarding.step4.sub':      'KROK 3 Z 4  ·  OPCJONALNE',
    'onboarding.step4.desc':     'Otrzymaj powiadomienie, gdy obserwowany zespół ogłosi nowy album lub cena obserwowanej płyty spadnie poniżej Twojego progu.',
    'onboarding.step4.cta':      '🔔 WŁĄCZ POWIADOMIENIA',
    'onboarding.step4.done':     '✓ Powiadomienia włączone! Kliknij Dalej.',

    'onboarding.step5.title':    'GOTOWE',
    'onboarding.step5.sub':      'KROK 4 Z 4',
    'onboarding.step5.desc':     'Zacznij dodawać płyty, obserwować zespoły i śledzić ceny. W każdej chwili możesz ulepszyć do Pro — szczegółowe oceny, raporty ubezpieczeniowe, historia cen.',
    'onboarding.step5.cta':      '🤘 WEJDŹ DO VAULTA',

    'empty.vault.title':         'Twój vault jest pusty',
    'empty.vault.desc':          'Zacznij od synchronizacji z Discogs (2 min) lub dodaj pierwszą płytę ręcznie.',
    'empty.vault.connect':       '🔗 POŁĄCZ DISCOGS',
    'empty.vault.add':           '＋ DODAJ PIERWSZĄ PŁYTĘ',
    'empty.vault.scan':          '📷 Zeskanuj kod kreskowy',
    'empty.vault.tip':           'Wskazówka: możesz też zaimportować CSV w zakładce Profil.',

    'paywall.upgradeTo':         'Ulepsz do',
    'paywall.title':             'METAL VAULT PRO',
    'paywall.trial':             '7 dni za darmo · anuluj w każdej chwili',
    'paywall.monthly':           'Miesięcznie',
    'paywall.yearly':            'Rocznie',
    'paywall.yearlyBadge':       'OSZCZĘDZASZ 38%',
    'paywall.cta':               '🤘 ROZPOCZNIJ BEZPŁATNY OKRES',
    'paywall.cta.loading':       'PRZEKIEROWUJĘ…',
    'paywall.laterBtn':          'Może później',
    'paywall.powered':           'Obsługiwane przez Stripe · BLIK, P24, karta · anuluj w każdej chwili',

    'paywall.reason.ALERT_LIMIT_REACHED': '🔔 Plan darmowy to 3 alerty cenowe. Wybierz Pro dla nieograniczonej liczby.',
    'paywall.reason.PREMIUM_REQUIRED':    '⚡ Ta funkcja wymaga Metal Vault Pro.',
    'paywall.reason.PRICE_HISTORY':       '📈 Historia cen to funkcja Pro — zobacz jak wartość Twojej kolekcji zmienia się w czasie.',
    'paywall.reason.INSURANCE_REQUIRED':  '🏛️ Raporty PDF do ubezpieczenia to funkcja Pro — udokumentuj wartość kolekcji dla ubezpieczyciela.',
    'paywall.reason.DETAILED_GRADING':    '💎 Szczegółowa ocena (okładka, winyl, wkładka, naklejka hype) to funkcja Pro.',
    'paywall.reason.EXPORT_REQUIRED':     '📤 Eksport CSV/JSON to funkcja Pro — zapisz lub przenieś swoją kolekcję.',
    'paywall.reason.ON_DEMAND_REFRESH':   '⚡ Odświeżanie cen na żądanie to funkcja Pro — Plan darmowy aktualizuje raz dziennie.',

    'profile.push.title':        'Powiadomienia',
    'profile.push.desc':         'Alerty cenowe + nowe pre-ordery',
    'profile.push.enabled':      '✓ Włączone — alerty cenowe + pre-ordery obserwowanych zespołów',
    'profile.insurance.title':   'Raport ubezpieczeniowy',
    'profile.insurance.subtitle':'Wygeneruj wycenę PDF',
    'profile.insurance.desc':    'Formalny spis kolekcji z wycenami rynkowymi — gotowy do Twojej polisy',
    'profile.insurance.generate':'📄 WYGENERUJ RAPORT',
    'profile.insurance.addFirst':'DODAJ NAJPIERW PŁYTY',
  },
};

const LS_KEY = 'mv_locale';
let currentLocale = null;

function detectBrowserLocale() {
  if (typeof navigator === 'undefined') return 'en';
  const lang = (navigator.language || navigator.userLanguage || 'en').toLowerCase();
  if (lang.startsWith('pl')) return 'pl';
  return 'en';
}

export function getLocale() {
  if (currentLocale) return currentLocale;
  if (typeof localStorage !== 'undefined') {
    const stored = localStorage.getItem(LS_KEY);
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
