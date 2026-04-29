// ── Cache warmer for /api/releases ─────────────────────────────────
// Runs every hour to keep `releases:global:DATE` cache fresh.
// Without this, the first user of each hour pays a 25s wait while we
// fetch 22 searches + 120 details from Discogs sequentially.
//
// With this cron, /api/releases is always served from cache for the
// 99.9% common case. Only edge cases (cache miss + first request) hit
// Discogs live, and even then they get the 24h-cached details layer.

export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';

export async function GET(request) {
  const auth = request.headers.get('authorization');
  if (process.env.CRON_SECRET && auth !== 'Bearer ' + process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const start = Date.now();

  // Internal call to /api/releases — populates Layer 1 + Layer 3 caches.
  // Layer 2 (per-artist) is on-demand and not warmed (artists vary per user).
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://metal-vault-six.vercel.app';
  let result;
  try {
    const r = await fetch(baseUrl + '/api/releases', {
      headers: { 'User-Agent': 'MetalVault-CacheWarmer/1.0' },
    });
    result = await r.json();
  } catch (e) {
    return NextResponse.json({ error: e.message, durationMs: Date.now() - start }, { status: 500 });
  }

  return NextResponse.json({
    success:    true,
    source:     result?.source,
    cached:     result?.cached,
    count:      result?.count || 0,
    upcoming:   result?.upcoming || 0,
    recent:     result?.recent || 0,
    durationMs: Date.now() - start,
  });
}
