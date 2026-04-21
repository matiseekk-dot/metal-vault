import { createServerClient } from '@supabase/ssr';
import { NextResponse } from 'next/server';

// ── In-memory rate limiter ─────────────────────────────────────
// NOTE: Vercel runs multiple instances per region, so each instance has its own
// counters. For strict global limits, swap to Upstash Redis (@upstash/ratelimit).
// This basic version is good enough for abuse prevention at current scale.
const rateLimitStore = new Map(); // ip:route → { count, resetAt }

// Per-route limits (requests per minute per IP)
const RATE_LIMITS = {
  // Auth & write endpoints — tighter limits
  '/api/profile':          { max: 30,  windowMs: 60_000 },
  '/api/collection':       { max: 60,  windowMs: 60_000 },
  '/api/watchlist':        { max: 60,  windowMs: 60_000 },
  '/api/alerts':           { max: 30,  windowMs: 60_000 },
  '/api/artists':          { max: 60,  windowMs: 60_000 },
  '/api/push/subscribe':   { max: 10,  windowMs: 60_000 },
  '/api/stripe/checkout':  { max: 5,   windowMs: 60_000 },
  // Expensive external API calls — very tight
  '/api/discogs':          { max: 30,  windowMs: 60_000 },
  '/api/releases':         { max: 30,  windowMs: 60_000 },
  '/api/barcode':          { max: 20,  windowMs: 60_000 },
  '/api/import':           { max: 5,   windowMs: 60_000 },
  // Lookups — more generous
  '/api/persona':          { max: 30,  windowMs: 60_000 },
  '/api/price-history':    { max: 60,  windowMs: 60_000 },
  '/api/portfolio':        { max: 60,  windowMs: 60_000 },
};

function checkRateLimit(ip, pathname) {
  // Find the most specific matching rule
  let matchedRoute = null;
  for (const route of Object.keys(RATE_LIMITS)) {
    if (pathname.startsWith(route) && (!matchedRoute || route.length > matchedRoute.length)) {
      matchedRoute = route;
    }
  }
  if (!matchedRoute) return { ok: true };

  const { max, windowMs } = RATE_LIMITS[matchedRoute];
  const key = ip + ':' + matchedRoute;
  const now = Date.now();
  const entry = rateLimitStore.get(key);

  if (!entry || now > entry.resetAt) {
    rateLimitStore.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, remaining: max - 1, resetAt: now + windowMs };
  }
  if (entry.count >= max) {
    return { ok: false, resetAt: entry.resetAt, retryAfter: Math.ceil((entry.resetAt - now) / 1000) };
  }
  entry.count++;
  return { ok: true, remaining: max - entry.count, resetAt: entry.resetAt };
}

// Cleanup: prune expired entries opportunistically (every ~1000 requests)
let cleanupCounter = 0;
function maybeCleanup() {
  if (++cleanupCounter % 1000 !== 0) return;
  const now = Date.now();
  for (const [key, entry] of rateLimitStore.entries()) {
    if (now > entry.resetAt) rateLimitStore.delete(key);
  }
}

export async function middleware(request) {
  const { pathname } = request.nextUrl;

  // Apply rate limits only to API routes (skip page routes to keep them fast)
  if (pathname.startsWith('/api/') &&
      !pathname.startsWith('/api/cron') &&
      !pathname.startsWith('/api/stripe/webhook')) {
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0].trim()
            || request.headers.get('x-real-ip')
            || 'unknown';
    const rl = checkRateLimit(ip, pathname);
    maybeCleanup();
    if (!rl.ok) {
      return new NextResponse(
        JSON.stringify({ error: 'Too many requests', retryAfter: rl.retryAfter }),
        {
          status: 429,
          headers: {
            'Content-Type': 'application/json',
            'Retry-After': String(rl.retryAfter),
            'X-RateLimit-Reset': String(rl.resetAt),
          },
        }
      );
    }
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() { return request.cookies.getAll(); },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Refresh session — required for Server Components
  await supabase.auth.getUser();
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/cron|api/stripe/webhook).*)'],
};
