/** @type {import('next').NextConfig} */

// Security headers — applied to every response.
// CSP is in Report-Only mode initially so we can monitor violations before enforcing.
// CSP currently in REPORT-ONLY mode. To enforce:
// 1. Verify no console violations on production for 7 days
// 2. Change header key below from 'Content-Security-Policy-Report-Only' → 'Content-Security-Policy'
// Known external domains in use (must stay in whitelist):
//   connect-src: Supabase, Stripe API, Nominatim (reverse geocoding for ConcertLocationCard)
//   img-src:     Spotify CDN, Discogs covers, Cover Art Archive
//   script-src:  Stripe checkout
//   frame-src:   Stripe checkout iframe
// Adding new external service? Update both this CSP and connect-src/img-src as needed.
const securityHeaders = [
  // Clickjacking
  { key: 'X-Frame-Options', value: 'DENY' },
  // MIME sniffing
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  // Referrer privacy
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // Disable dangerous APIs we don't use
  { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=(self), payment=(self)' },
  // HSTS — force HTTPS for 1 year (Vercel serves HTTPS anyway)
  { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
  // CSP — toggle between report-only and enforce via env var.
  // Set CSP_ENFORCE=1 in Vercel env vars to switch to enforce mode.
  // Report-only mode is default for safety — violations log to console
  // without breaking functionality. Once you've verified no real violations
  // for ~7 days in production, set CSP_ENFORCE=1 and redeploy.
  {
    key: process.env.CSP_ENFORCE === '1'
      ? 'Content-Security-Policy'
      : 'Content-Security-Policy-Report-Only',
    value: [
      "default-src 'self'",
      // Next.js + inline event handlers need unsafe-inline/unsafe-eval
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://js.stripe.com https://checkout.stripe.com",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com data:",
      // Covers from all known external sources
      "img-src 'self' data: blob: https://i.scdn.co https://*.scdn.co https://i.discogs.com https://*.discogs.com https://coverartarchive.org https://*.coverartarchive.org https://archive.org https://*.archive.org",
      // APIs we call from client (Supabase realtime + Stripe)
      "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.stripe.com https://checkout.stripe.com https://nominatim.openstreetmap.org",
      "frame-src https://js.stripe.com https://checkout.stripe.com https://hooks.stripe.com",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self' https://checkout.stripe.com",
      "frame-ancestors 'none'",
    ].join('; '),
  },
];

const nextConfig = {
  // No `output: 'standalone'` — we deploy to Vercel, which doesn't need the
  // standalone server bundle. Re-add it only if/when we self-host.
  experimental: {},
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'i.scdn.co' },
      { protocol: 'https', hostname: '*.scdn.co' },
      { protocol: 'https', hostname: 'i.discogs.com' },
      { protocol: 'https', hostname: '*.discogs.com' },
      { protocol: 'https', hostname: 'coverartarchive.org' },
      { protocol: 'https', hostname: '*.coverartarchive.org' },
      { protocol: 'https', hostname: 'archive.org' },
      { protocol: 'https', hostname: '*.archive.org' },
    ],
  },
  async headers() {
    return [{ source: '/(.*)', headers: securityHeaders }];
  },
};

// Wrap with Sentry only if a DSN AND auth token are configured for the build.
// In local dev or PR previews without Sentry, fall through unchanged.
async function maybeWithSentry(cfg) {
  if (!process.env.SENTRY_AUTH_TOKEN || !process.env.SENTRY_DSN) return cfg;
  try {
    const { withSentryConfig } = await import('@sentry/nextjs');
    return withSentryConfig(cfg, {
      silent: true,
      widenClientFileUpload: true,
      hideSourceMaps: true,           // don't expose .map files publicly
      disableLogger: true,
    });
  } catch {
    return cfg;
  }
}

export default await maybeWithSentry(nextConfig);
