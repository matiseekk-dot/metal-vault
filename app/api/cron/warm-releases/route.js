// ── Cache warmer for /api/releases ─────────────────────────────────
// Runs daily at 7:30 UTC (~30 min before daily-digest cron at 8:00).
// Vercel Hobby tier limits crons to once per day; on Pro tier you can
// change to hourly ('5 * * * *') for sub-daily freshness.
//
// Daily warmup means: first user of the day might still hit a partial
// cache miss if they open the app during the 23h between cron runs.
// In practice this is fine — global cache TTL is 1h but the warmer
// rebuilds it once a day, and the per-detail cache (24h TTL) covers
// the rest with minimal Discogs hits.

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
