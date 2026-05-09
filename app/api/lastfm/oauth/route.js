// ── /api/lastfm/oauth — start Last.fm web-auth ─────────────────
// Returns { authorizeUrl } the client redirects to. Last.fm bounces
// back to /api/lastfm/callback with ?token=...

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { lastfmAuthorizeUrl, isLastfmConfigured } from '@/lib/lastfm';

export const dynamic = 'force-dynamic';

export async function GET() {
  if (!isLastfmConfigured() || !process.env.LASTFM_SECRET) {
    return NextResponse.json({
      error:   'Last.fm not configured',
      helpUrl: 'https://www.last.fm/api/account/create',
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
