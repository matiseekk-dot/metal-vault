// ── Simple in-memory rate limiter ─────────────────────────────────
// Per-instance bucket — on Vercel edge this is per-region, not global.
// For stronger guarantees swap to Upstash Redis (https://upstash.com/docs/redis/sdks/ts/overview)
// using the same interface.
//
// Usage in API route:
//   import { rateLimit } from '@/lib/rate-limit';
//   const rl = rateLimit(req, { max: 30, windowMs: 60_000 });
//   if (!rl.ok) return NextResponse.json({ error: 'Too many requests' }, { status: 429 });

const buckets = new Map();
const SWEEP_INTERVAL = 60_000; // clean stale entries every minute
let lastSweep = Date.now();

function sweep() {
  const now = Date.now();
  if (now - lastSweep < SWEEP_INTERVAL) return;
  lastSweep = now;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt < now) buckets.delete(key);
  }
}

export function rateLimit(req, { max = 60, windowMs = 60_000, key } = {}) {
  sweep();
  const now = Date.now();
  const identifier = key
    || req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || req.headers.get('x-real-ip')
    || 'unknown';
  const pathname = new URL(req.url).pathname;
  const bucketKey = identifier + ':' + pathname;

  let bucket = buckets.get(bucketKey);
  if (!bucket || bucket.resetAt < now) {
    bucket = { count: 0, resetAt: now + windowMs };
    buckets.set(bucketKey, bucket);
  }
  bucket.count++;

  const ok = bucket.count <= max;
  return {
    ok,
    remaining: Math.max(0, max - bucket.count),
    resetAt:   bucket.resetAt,
    limit:     max,
  };
}
