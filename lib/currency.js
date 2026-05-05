'use client';
// ── Currency state + FX rates + price formatter ────────────────
//
// All money values stored in the app (purchase_price, median_price,
// current_price) are in USD because Discogs' API speaks USD. This
// module provides:
//
//   • useCurrency() — active display currency (USD/EUR/PLN), persisted
//     in localStorage; defaults to the language locale (pl→PLN, de→EUR,
//     en→USD) on first run.
//   • setCurrency(code) — flips the active code and broadcasts an event
//     so subscribers re-render.
//   • useFx() — fetches USD→EUR/PLN rates from /api/fx (24h cache) and
//     gives back a synchronous `convert(amountUsd, target)` helper.
//   • formatPrice(amountUsd, currency, fx, locale) — single canonical
//     formatter using Intl.NumberFormat. Returns "$25" / "23 €" / "97 zł".
//
// Components that already do `'$' + n.toFixed(0)` should be migrated to
// `formatPrice(n, currency, fx, locale)`. Both produce a string; the
// new path picks the right symbol + grouping for the active locale.

import { useState, useEffect } from 'react';
import { getLocale } from '@/lib/i18n';

// ── Config ────────────────────────────────────────────────────
export const SUPPORTED_CURRENCIES = [
  { code: 'USD', symbol: '$',   label: 'US Dollar' },
  { code: 'EUR', symbol: '€',   label: 'Euro' },
  { code: 'PLN', symbol: 'zł',  label: 'Polish Złoty' },
];

const LS_KEY = 'mv_currency';

// Default currency for a given locale. Falls back to USD for unknown
// locales (matches the source-data convention).
function defaultCurrencyForLocale(locale) {
  if (locale === 'pl') return 'PLN';
  if (locale === 'de') return 'EUR';
  return 'USD';
}

// ── Active currency state ─────────────────────────────────────
let _current = null;

export function getCurrency() {
  if (_current) return _current;
  if (typeof localStorage !== 'undefined') {
    const stored = localStorage.getItem(LS_KEY);
    if (stored && SUPPORTED_CURRENCIES.some(c => c.code === stored)) {
      _current = stored;
      return _current;
    }
  }
  _current = defaultCurrencyForLocale(getLocale());
  return _current;
}

export function setCurrency(code) {
  if (!SUPPORTED_CURRENCIES.some(c => c.code === code)) return;
  _current = code;
  try { localStorage.setItem(LS_KEY, code); } catch {}
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('mv:currency-changed', { detail: { code } }));
  }
}

// React hook — re-renders subscribers when currency or locale changes
export function useCurrency() {
  const [code, setCode] = useState(() => getCurrency());
  useEffect(() => {
    const handler = () => setCode(getCurrency());
    window.addEventListener('mv:currency-changed', handler);
    // Also rerun if the locale changes — defaults shift when locale
    // changes and there's no manual override yet.
    window.addEventListener('mv:locale-changed', handler);
    return () => {
      window.removeEventListener('mv:currency-changed', handler);
      window.removeEventListener('mv:locale-changed', handler);
    };
  }, []);
  return code;
}

// ── FX rates ──────────────────────────────────────────────────
// Module-scoped cache so multiple components share one fetch. Fresh on
// first useFx() call; refreshed once a day. /api/fx itself adds a 24h
// edge cache, so even a cold instance + cold edge is just ~200ms.
let _fxCache = null;
let _fxPromise = null;
const FX_CACHE_TTL = 6 * 60 * 60 * 1000;   // 6h client-side; server is 24h

async function fetchFx() {
  if (_fxCache && Date.now() - _fxCache.fetchedAt < FX_CACHE_TTL) {
    return _fxCache;
  }
  if (_fxPromise) return _fxPromise;     // dedupe concurrent callers
  _fxPromise = (async () => {
    try {
      const r = await fetch('/api/fx');
      if (!r.ok) throw new Error('fx ' + r.status);
      const d = await r.json();
      _fxCache = { rates: d.rates || {}, base: d.base || 'USD', date: d.date || null, fetchedAt: Date.now() };
      return _fxCache;
    } finally {
      _fxPromise = null;
    }
  })();
  return _fxPromise;
}

// Hook: returns { rates, convert(usdAmount, targetCurrency), ready }.
// Renders with `ready: false` on first paint so callers can still show
// the value in USD as a placeholder; once rates load `ready` flips and
// the card re-renders with the converted amount.
export function useFx() {
  const [state, setState] = useState(() => ({
    rates:    _fxCache?.rates || {},
    base:     _fxCache?.base  || 'USD',
    ready:    !!_fxCache,
  }));
  useEffect(() => {
    let cancelled = false;
    fetchFx().then(d => {
      if (cancelled) return;
      setState({ rates: d.rates, base: d.base, ready: true });
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);
  return state;
}

// ── Convert + format ──────────────────────────────────────────
// Source amounts are always USD. If target === 'USD' or no rates yet,
// we return the original; otherwise multiply by the rate (Frankfurter
// returns rates already in target/USD form, e.g. PLN: 4.05 means 1 USD
// = 4.05 PLN).
export function convertFromUsd(amountUsd, target, fx) {
  const n = Number(amountUsd);
  if (!Number.isFinite(n)) return null;
  if (!target || target === 'USD') return n;
  const rate = fx?.rates?.[target];
  if (!rate || !Number.isFinite(rate)) return n;   // fall back to USD value
  return n * rate;
}

// formatPrice — one canonical money formatter.
//   amountUsd   : number, source value (USD).
//   currency    : 'USD' | 'EUR' | 'PLN'. Defaults to active currency.
//   fx          : object from useFx() with .rates and .ready. Required
//                 for non-USD; omit when calling on USD-only paths.
//   locale      : ISO locale; defaults to active app locale.
//   options     : { decimals: 0|2, withSign: bool }
//
// Returns a string with proper symbol placement / grouping per locale,
// or '—' when input isn't a finite number.
export function formatPrice(amountUsd, currency, fx, locale, options = {}) {
  const n = Number(amountUsd);
  if (!Number.isFinite(n)) return '—';

  const code = currency || getCurrency();
  const loc  = locale   || getLocale();
  const converted = convertFromUsd(n, code, fx);
  const value     = options.withSign && converted >= 0 ? +converted : converted;

  try {
    return new Intl.NumberFormat(loc, {
      style:                 'currency',
      currency:              code,
      maximumFractionDigits: options.decimals ?? 0,
      minimumFractionDigits: options.decimals ?? 0,
    }).format(value);
  } catch {
    // Fallback if Intl doesn't recognize the locale (extremely rare).
    const sym = SUPPORTED_CURRENCIES.find(c => c.code === code)?.symbol || '';
    const v   = value.toFixed(options.decimals ?? 0);
    return code === 'USD' ? sym + v : v + ' ' + sym;
  }
}

// formatChange — like formatPrice but always prefixed with + or − so
// the sign is unambiguous (used in "▲ +$120 / ▼ −$45").
export function formatChange(amountUsd, currency, fx, locale, options = {}) {
  const n = Number(amountUsd);
  if (!Number.isFinite(n)) return '—';
  const sign  = n >= 0 ? '+' : '−';
  const abs   = formatPrice(Math.abs(n), currency, fx, locale, options);
  return sign + abs;
}
