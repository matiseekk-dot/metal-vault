// ── DEPRECATED: legacy callback route ───────────────────────────
// This route is no longer used. The canonical callback is:
//   /api/discogs/oauth/callback/[userId]/route.js
//
// The current OAuth flow (oauth/route.js) always embeds userId in the
// callback URL path, so Discogs hits [userId]/route.js directly.
//
// This file is kept for safety (old bookmarks, cached redirect URIs).
// It reads user_id from query string and delegates to the same logic.

export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabase-server';
import { buildOAuthHeader } from '@/lib/oauth';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const oauthToken    = searchParams.get('oauth_token');
  const oauthVerifier = searchParams.get('oauth_verifier');
  // Legacy: userId in query string (old flow), not URL path
  const userId  = searchParams.get('user_id');
  const appUrl  = process.env.NEXT_PUBLIC_APP_URL || 'https://metal-vault-six.vercel.app';

  if (!oauthToken || !oauthVerifier || !userId) {
    return NextResponse.redirect(appUrl + '/?discogs_error=missing_params');
  }

  // Delegate to the canonical [userId] route handler logic
  // (inline here to avoid Next.js import-across-routes restrictions)
  const key    = process.env.DISCOGS_KEY;
  const secret = process.env.DISCOGS_SECRET;
  const admin  = getAdminClient();

  try {
    const { data: stored } = await admin
      .from('discogs_tokens').select('access_secret').eq('user_id', userId).single();
    const requestTokenSecret = stored?.access_secret || '';

    const ACCESS_TOKEN_URL = 'https://api.discogs.com/oauth/access_token';
    const authHeader = buildOAuthHeader(
      'POST', ACCESS_TOKEN_URL,
      { oauth_token: oauthToken, oauth_verifier: oauthVerifier },
      key, secret, oauthToken, requestTokenSecret,
    );

    const r = await fetch(ACCESS_TOKEN_URL, {
      method: 'POST',
      headers: { Authorization: authHeader, 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'MetalVault/1.0' },
    });
    const text = await r.text();
    if (!r.ok) return NextResponse.redirect(appUrl + '/?discogs_error=' + encodeURIComponent(text.slice(0, 200)));

    const p = new URLSearchParams(text);
    const accessToken  = p.get('oauth_token');
    const accessSecret = p.get('oauth_token_secret');
    if (!accessToken) return NextResponse.redirect(appUrl + '/?discogs_error=no_access_token');

    let username = null;
    try {
      const IDENTITY_URL = 'https://api.discogs.com/oauth/identity';
      const ir = await fetch(IDENTITY_URL, {
        headers: { Authorization: buildOAuthHeader('GET', IDENTITY_URL, {}, key, secret, accessToken, accessSecret), 'User-Agent': 'MetalVault/1.0' },
      });
      if (ir.ok) username = (await ir.json()).username || null;
    } catch {}

    await admin.from('discogs_tokens').upsert({
      user_id: userId, access_token: accessToken, access_secret: accessSecret, discogs_username: username,
    }, { onConflict: 'user_id' });

    return NextResponse.redirect(appUrl + '/?discogs_connected=1&username=' + encodeURIComponent(username || ''));
  } catch (e) {
    return NextResponse.redirect(appUrl + '/?discogs_error=' + encodeURIComponent(e.message.slice(0, 100)));
  }
}
