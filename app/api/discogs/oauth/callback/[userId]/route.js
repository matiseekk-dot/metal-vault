export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabase-server';

export async function GET(request, { params }) {
  const { searchParams } = new URL(request.url);
  const oauthToken    = searchParams.get('oauth_token');
  const oauthVerifier = searchParams.get('oauth_verifier');
  const userId        = params.userId;
  const appUrl        = process.env.NEXT_PUBLIC_APP_URL || 'https://metal-vault-six.vercel.app';

  if (!oauthToken || !oauthVerifier || !userId) {
    return NextResponse.redirect(appUrl + '/?discogs_error=missing_params');
  }

  const key   = process.env.DISCOGS_KEY;
  const secret= process.env.DISCOGS_SECRET;
  const admin = getAdminClient();

  try {
    // Get the stored request secret for this user
    const { data: stored } = await admin
      .from('discogs_tokens')
      .select('access_secret')
      .eq('user_id', userId)
      .single();

    const requestSecret = stored?.access_secret || '';

    // Exchange request token for access token using PLAINTEXT signature
    // Signature = consumerSecret&requestTokenSecret (NOT url-encoded in the value itself)
    const sig = secret + '&' + requestSecret;

    const r = await fetch('https://api.discogs.com/oauth/access_token', {
      method: 'POST',
      headers: {
        Authorization: 'OAuth oauth_consumer_key="' + key + '",'
          + 'oauth_nonce="' + Math.random().toString(36).slice(2) + '",'
          + 'oauth_timestamp="' + Math.floor(Date.now()/1000) + '",'
          + 'oauth_token="' + oauthToken + '",'
          + 'oauth_verifier="' + oauthVerifier + '",'
          + 'oauth_signature_method="PLAINTEXT",'
          + 'oauth_version="1.0",'
          + 'oauth_signature="' + sig + '"',
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'MetalVault/1.0',
      },
    });

    const text = await r.text();
    if (!r.ok) {
      return NextResponse.redirect(
        appUrl + '/?discogs_error=' + encodeURIComponent(text.slice(0, 200))
      );
    }

    const p           = new URLSearchParams(text);
    const accessToken  = p.get('oauth_token');
    const accessSecret = p.get('oauth_token_secret');
    if (!accessToken) return NextResponse.redirect(appUrl + '/?discogs_error=no_access_token');

    // Get username via identity endpoint
    let username = null;
    try {
      const identity = await fetch('https://api.discogs.com/oauth/identity', {
        headers: {
          Authorization: 'OAuth oauth_consumer_key="' + key + '",'
            + 'oauth_token="' + accessToken + '",'
            + 'oauth_signature_method="PLAINTEXT",'
            + 'oauth_signature="' + secret + '&' + accessSecret + '",'
            + 'oauth_version="1.0"',
          'User-Agent': 'MetalVault/1.0',
        },
      });
      if (identity.ok) {
        const data = await identity.json();
        username = data.username || null;
      }
    } catch {}

    // Save access token + username
    await admin.from('discogs_tokens').upsert({
      user_id:          userId,
      access_token:     accessToken,
      access_secret:    accessSecret,
      discogs_username: username,
    }, { onConflict: 'user_id' });

    return NextResponse.redirect(
      appUrl + '/?discogs_connected=1&username=' + encodeURIComponent(username || '')
    );
  } catch (e) {
    return NextResponse.redirect(
      appUrl + '/?discogs_error=' + encodeURIComponent(e.message.slice(0, 100))
    );
  }
}
