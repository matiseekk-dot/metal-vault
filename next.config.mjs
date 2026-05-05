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
  // HSTS — force HTTPS for 1 year, declare subdomains, opt into the
  // browser preload list. After this header has been live with the
  // `preload` directive for a few weeks we can submit the domain at
  // https://hstspreload.org/ and Chrome/Firefox will hardcode it. Means
  // even a first-ever visit on the Polish train wifi can't be MITM'd
  // by an attacker who tricks the user into a plain http:// link.
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
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
    return [
      // Default security headers for everything.
      { source: '/(.*)', headers: securityHeaders },
      // /sw.js MUST NOT be cached by the browser. Every page load
      // calls navigator.serviceWorker.register() which fetches this
      // URL — if the browser hands back a stale 200 from disk, the
      // SW never updates and the user runs an old build for as long
      // as the cache holds. Cloudflare/Vercel default for static
      // assets is up to 1 year; that's catastrophic for sw.js.
      // Same for /manifest.json: when Play Store / iOS revalidate
      // the install metadata we want the latest.
      {
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=0, must-revalidate' },
          { key: 'Service-Worker-Allowed', value: '/' },
        ],
      },
      {
        source: '/manifest.json',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=0, must-revalidate' },
        ],
      },
    ];
  },
};

// Wrap with Sentry only when monitoring is fully configured for the
// build: an auth token (so source maps can upload) AND a DSN to point
// at. We accept either the server-side SENTRY_DSN or the public
// NEXT_PUBLIC_SENTRY_DSN — typical setups only set the public one,
// and demanding both would silently disable source-map uploads.
async function maybeWithSentry(cfg) {
  const hasDsn = process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (!process.env.SENTRY_AUTH_TOKEN || !hasDsn) return cfg;
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

// ── Optional bundle analyzer ───────────────────────────────────
// Run with `ANALYZE=true npm run build` to open the treemap reports.
// Install once: `npm i -D @next/bundle-analyzer`. Until installed the
// import fails, so we wrap it the same way as Sentry — flags off, no
// op without the dep present. Doesn't affect normal builds.
async function maybeWithBundleAnalyzer(cfg) {
  if (process.env.ANALYZE !== 'true') return cfg;
  try {
    const { default: bundleAnalyzer } = await import('@next/bundle-analyzer');
    return bundleAnalyzer({ enabled: true })(cfg);
  } catch {
    return cfg;
  }
}

export default await maybeWithBundleAnalyzer(await maybeWithSentry(nextConfig));
