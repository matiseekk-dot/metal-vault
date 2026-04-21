/** @type {import('next').NextConfig} */

// Security headers — applied to every response.
// CSP is in Report-Only mode initially so we can monitor violations before enforcing.
// Switch to 'Content-Security-Policy' header to enforce strictly after a week of clean reports.
const securityHeaders = [
  // Clickjacking
  { key: 'X-Frame-Options', value: 'DENY' },
  // MIME sniffing
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  // Referrer privacy
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // Disable dangerous APIs we don't use
  { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=(), payment=(self)' },
  // HSTS — force HTTPS for 1 year (Vercel serves HTTPS anyway)
  { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
  // CSP — starts in report-only; swap header name to enforce
  {
    key: 'Content-Security-Policy-Report-Only',
    value: [
      "default-src 'self'",
      // Next.js + inline event handlers need unsafe-inline/unsafe-eval
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://js.stripe.com https://checkout.stripe.com",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com data:",
      // Covers from all known external sources
      "img-src 'self' data: blob: https://i.scdn.co https://*.scdn.co https://i.discogs.com https://*.discogs.com https://coverartarchive.org https://*.coverartarchive.org https://archive.org https://*.archive.org",
      // APIs we call from client (Supabase realtime + Stripe)
      "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.stripe.com https://checkout.stripe.com",
      "frame-src https://js.stripe.com https://checkout.stripe.com https://hooks.stripe.com",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self' https://checkout.stripe.com",
      "frame-ancestors 'none'",
    ].join('; '),
  },
];

const nextConfig = {
  output: 'standalone',
  experimental: {},
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'i.scdn.co' },
      { protocol: 'https', hostname: '*.scdn.co' },
      { protocol: 'https', hostname: 'i.discogs.com' },
      { protocol: 'https', hostname: '*.discogs.com' },
      { protocol: 'https', hostname: 'coverartarchive.org' },
      { protocol: 'https', hostname: '*.coverartarchive.org' },
    ],
  },
  async headers() {
    return [{ source: '/(.*)', headers: securityHeaders }];
  },
};

export default nextConfig;
