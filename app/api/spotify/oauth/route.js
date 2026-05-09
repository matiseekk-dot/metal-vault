// ── /api/spotify/oauth — start the user-OAuth flow ──────────────
//
// Returns { authorizeUrl } that the client redirects to. Spotify
// will bounce back to /api/spotify/callback with ?code= which we
// then exchange for tokens.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { spotifyAuthorizeUrl, isSpotifyConfigured } from '@/lib/spotify';

export const dynamic = 'force-dynamic';

export async function GET() {
  if (!isSpotifyConfigured()) {
    return NextResponse.json({
      error:    'Spotify not configured',
      helpUrl:  'https://developer.spotify.com/dashboard',
    }, { status: 503 });
  }

  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://metal-vault-six.vercel.app';
  const redirectUri = appUrl + '/api/spotify/callback';

  // CSRF — pack the user_id into `state` so the callback verifies the
  // session that started the flow matches the one finishing it.
  // (The cookie session ALSO matches, but state is belt+braces.)
  const state = Buffer.from(JSON.stringify({
    u: user.id,
    n: Math.random().toString(36).slice(2),
  })).toString('base64url');

  const authorizeUrl = spotifyAuthorizeUrl({ redirectUri, state });
  if (!authorizeUrl) {
    return NextResponse.json({ error: 'Could not build authorize URL' }, { status: 500 });
  }
  return NextResponse.json({ authorizeUrl });
}
