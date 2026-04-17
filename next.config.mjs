/** @type {import('next').NextConfig} */
const nextConfig = {
  // Never prerender pages at build time — always render at request time.
  // This prevents build failures when SUPABASE env vars aren't available
  // during the CI/CD build step on Vercel.
  output: 'standalone',
  experimental: {
    // Ensure client components aren't pre-rendered without env vars
  },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'i.scdn.co' },
      { protocol: 'https', hostname: '*.scdn.co' },
      { protocol: 'https', hostname: 'i.discogs.com' },
      { protocol: 'https', hostname: '*.discogs.com' },
    ],
  },
};

export default nextConfig;
