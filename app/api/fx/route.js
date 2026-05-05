// ── FX rates proxy ────────────────────────────────────────────
//
// GET /api/fx
//
// Returns the latest FX rates with USD as the base in the shape
//   { base: 'USD', date: 'YYYY-MM-DD', rates: { EUR, PLN, ... } }.
//
// Source: Frankfurter (https://api.frankfurter.app) — backed by ECB,
// free, no key, fair-use. We cache the response on Vercel's edge for
// 24h with a 7-day stale-while-revalidate so a single fetch a day
// covers everyone.
//
// Why this proxy instead of hitting Frankfurter from the client?
//   • Avoids a second CORS-allowed origin in the user's network log.
//   • Lets us swap the upstream provider without redeploying clients.
//   • Centralizes the (modest) cache strategy.

import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const FALLBACK = {
  // Hardcoded rates as a last resort if Frankfurter is down. Updated
  // manually from time to time — values close enough that the UI
  // doesn't show "—" if the upstream is unreachable.
  base:  'USD',
  date:  null,
  rates: { USD: 1, EUR: 0.92, PLN: 4.05 },
};

const CACHE_HEADERS = {
  // 24h s-maxage, 7d SWR — first request of the day pays the upstream
  // call; everyone else hits the edge cache.
  'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=604800',
};

export async function GET() {
  try {
    const r = await fetch('https://api.frankfurter.app/latest?from=USD&to=EUR,PLN', {
      // Server-side fetch; no auth needed.
      headers: { 'Accept': 'application/json' },
      // Frankfurter is fast (~150ms) but cap so a slow upstream doesn't
      // hang our function.
      signal: AbortSignal.timeout(5000),
    });
    if (!r.ok) throw new Error('frankfurter ' + r.status);
    const d = await r.json();
    const payload = {
      base:  d.base   || 'USD',
      date:  d.date   || null,
      rates: {
        USD: 1,
        EUR: Number(d.rates?.EUR) || FALLBACK.rates.EUR,
        PLN: Number(d.rates?.PLN) || FALLBACK.rates.PLN,
      },
    };
    return NextResponse.json(payload, { headers: CACHE_HEADERS });
  } catch {
    // Don't poison the edge cache with a hardcoded fallback for 24h —
    // if Frankfurter is briefly down we'd rather try again on next hit.
    // no-store also keeps the client-side cache short-lived.
    return NextResponse.json(FALLBACK, { headers: { 'Cache-Control': 'no-store' } });
  }
}
