// ── Discogs OAuth 1.0a — Step 2: exchange tokens ────────────────
// userId is read from the URL path (embedded in Step 1).
// PLAINTEXT signature over HTTPS — the Discogs-documented flow.
export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabase-server';
import { accessTokenHeader, apiCallHeader } from '@/lib/oauth';

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
    // Retrieve request token secret stored in Step 1
    const { data: stored } = await admin
      .from('discogs_tokens')
      .select('access_secret')
      .eq('user_id', userId)
      .single();

    const requestTokenSecret = stored?.access_secret || '';

    // Exchange request token for access token
    const r = await fetch('https://api.discogs.com/oauth/access_token', {
      method: 'POST',
      headers: {
        Authorization:  accessTokenHeader(key, secret, oauthToken, requestTokenSecret, oauthVerifier),
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent':   'MetalVault/1.0',
      },
    });

    const text = await r.text();
    if (!r.ok) {
      return NextResponse.redirect(
        appUrl + '/?discogs_error=' + encodeURIComponent(text.slice(0, 200)),
      );
    }

    const p            = new URLSearchParams(text);
    const accessToken  = p.get('oauth_token');
    const accessSecret = p.get('oauth_token_secret');
    if (!accessToken) return NextResponse.redirect(appUrl + '/?discogs_error=no_access_token');

    // Fetch Discogs username via /oauth/identity
    let username = null;
    try {
      const ir = await fetch('https://api.discogs.com/oauth/identity', {
        headers: {
          Authorization: apiCallHeader(key, secret, accessToken, accessSecret),
          'User-Agent':  'MetalVault/1.0',
        },
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

    return NextResponse.redirect(
      appUrl + '/?discogs_connected=1&username=' + encodeURIComponent(username || ''),
    );
  } catch (e) {
    return NextResponse.redirect(
      appUrl + '/?discogs_error=' + encodeURIComponent(e.message.slice(0, 100)),
    );
  }
}
