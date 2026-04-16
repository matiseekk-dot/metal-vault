// ── Discogs OAuth 1.0a — Step 3: exchange tokens (canonical) ────
// userId comes from the URL path, set in Step 1.
// Uses HMAC-SHA1 for the access_token exchange and identity call.
export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabase-server';
import { buildOAuthHeader } from '@/lib/oauth';

export async function GET(request, { params }) {
  const { searchParams } = new URL(request.url);
  const oauthToken    = searchParams.get('oauth_token');
  const oauthVerifier = searchParams.get('oauth_verifier');
  const userId        = params.userId;
  const appUrl        = process.env.NEXT_PUBLIC_APP_URL || 'https://metal-vault-six.vercel.app';

  if (!oauthToken || !oauthVerifier || !userId) {
    return NextResponse.redirect(appUrl + '/?discogs_error=missing_params');
  }

  const key    = process.env.DISCOGS_KEY;
  const secret = process.env.DISCOGS_SECRET;
  const admin  = getAdminClient();

  try {
    // Retrieve the request token secret stored in Step 1
    const { data: stored } = await admin
      .from('discogs_tokens')
      .select('access_secret')
      .eq('user_id', userId)
      .single();

    const requestTokenSecret = stored?.access_secret || '';

    // ── Exchange request token for access token (HMAC-SHA1) ──────
    const ACCESS_TOKEN_URL = 'https://api.discogs.com/oauth/access_token';
    const authHeader = buildOAuthHeader(
      'POST',
      ACCESS_TOKEN_URL,
      { oauth_token: oauthToken, oauth_verifier: oauthVerifier },
      key, secret,
      oauthToken,          // tokenKey = request token
      requestTokenSecret,  // tokenSecret = request token secret
    );

    const r = await fetch(ACCESS_TOKEN_URL, {
      method: 'POST',
      headers: {
        Authorization:  authHeader,
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent':   'MetalVault/1.0',
      },
    });

    const text = await r.text();
    if (!r.ok) return NextResponse.redirect(appUrl + '/?discogs_error=' + encodeURIComponent(text.slice(0, 200)));

    const p            = new URLSearchParams(text);
    const accessToken  = p.get('oauth_token');
    const accessSecret = p.get('oauth_token_secret');
    if (!accessToken) return NextResponse.redirect(appUrl + '/?discogs_error=no_access_token');

    // ── Fetch Discogs username via /oauth/identity (HMAC-SHA1) ───
    let username = null;
    try {
      const IDENTITY_URL = 'https://api.discogs.com/oauth/identity';
      const identityHeader = buildOAuthHeader(
        'GET',
        IDENTITY_URL,
        {},
        key, secret,
        accessToken,   // tokenKey = access token
        accessSecret,  // tokenSecret = access token secret
      );
      const ir = await fetch(IDENTITY_URL, {
        headers: { Authorization: identityHeader, 'User-Agent': 'MetalVault/1.0' },
      });
      if (ir.ok) username = (await ir.json()).username || null;
    } catch {}

    // Persist access token
    await admin.from('discogs_tokens').upsert({
      user_id:          userId,
      access_token:     accessToken,
      access_secret:    accessSecret,
      discogs_username: username,
    }, { onConflict: 'user_id' });

    return NextResponse.redirect(appUrl + '/?discogs_connected=1&username=' + encodeURIComponent(username || ''));

  } catch (e) {
    return NextResponse.redirect(appUrl + '/?discogs_error=' + encodeURIComponent(e.message.slice(0, 100)));
  }
}
