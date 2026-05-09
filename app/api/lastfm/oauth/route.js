// ── /api/lastfm/oauth — start Last.fm web-auth ─────────────────
// Returns { authorizeUrl } the client redirects to. Last.fm bounces
// back to /api/lastfm/callback with ?token=...

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { lastfmAuthorizeUrl, isLastfmConfigured } from '@/lib/lastfm';

export const dynamic = 'force-dynamic';

export async function GET() {
  // Distinguish "no API key at all" from "missing secret" — first
  // case is "developer hasn't set up Last.fm at all", second is
  // "API key exists for read-only artist info but auth flow needs
  // the SECRET too". Different fixes, different operators.
  if (!isLastfmConfigured()) {
    return NextResponse.json({
      error:   'Last.fm not configured (LASTFM_API_KEY env var missing)',
      helpUrl: 'https://www.last.fm/api/account/create',
    }, { status: 503 });
  }
  if (!process.env.LASTFM_SECRET) {
    return NextResponse.json({
      error:   'Last.fm auth missing — set LASTFM_SECRET in Vercel and redeploy',
      helpUrl: 'https://www.last.fm/api/accounts',
    }, { status: 503 });
  }
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://metal-vault-six.vercel.app';
  const callbackUrl = appUrl + '/api/lastfm/callback';
  const authorizeUrl = lastfmAuthorizeUrl({ callbackUrl });
  if (!authorizeUrl) return NextResponse.json({ error: 'Could not build authorize URL' }, { status: 500 });
  return NextResponse.json({ authorizeUrl });
}
