// ── /api/version — runtime build identity ────────────────────
//
// GET → { version, sha, builtAt, vercelEnv }
//
// Returns build/version info for ops checks ("which deploy is on prod
// right now?") + for the TWA wrapper to detect when a force-update is
// needed (compare versionCode in twa-manifest.json against this).
//
// Uses Vercel's environment variables when present:
//   VERCEL_GIT_COMMIT_SHA — set by Vercel automatically
//   VERCEL_ENV            — 'production' | 'preview' | 'development'
//
// Falls back to package.json version + null sha for local dev.

import { NextResponse } from 'next/server';
import pkg from '@/package.json';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json(
    {
      version:    pkg.version,
      name:       pkg.name,
      sha:        process.env.VERCEL_GIT_COMMIT_SHA || null,
      shortSha:   (process.env.VERCEL_GIT_COMMIT_SHA || '').slice(0, 7) || null,
      branch:     process.env.VERCEL_GIT_COMMIT_REF || null,
      vercelEnv:  process.env.VERCEL_ENV || 'development',
      builtAt:    process.env.VERCEL_DEPLOYMENT_CREATED_AT || null,
      // Match for the TWA wrapper. Bump these in twa-manifest.json
      // before re-uploading to Play Console.
      twaVersionName: '1.0.0',
    },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
