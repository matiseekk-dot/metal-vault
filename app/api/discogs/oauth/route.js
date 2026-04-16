// ── Discogs OAuth 1.0a — Step 1: get request token ───────────────
// Uses HMAC-SHA1 (not PLAINTEXT) so the consumer secret is never
// transmitted over the wire, even inside TLS-encrypted headers.
export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { buildOAuthHeader } from '@/lib/oauth';

export async function GET(request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const key    = process.env.DISCOGS_KEY;
  const secret = process.env.DISCOGS_SECRET;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://metal-vault-six.vercel.app';

  if (!key || !secret) {
    return NextResponse.json({
      error:   'Discogs OAuth requires Consumer Key + Consumer Secret. Go to discogs.com/settings/developers → Create App.',
      helpUrl: 'https://www.discogs.com/settings/developers',
    }, { status: 503 });
  }

  try {
    // userId in PATH — Discogs strips query params when appending oauth_token/verifier
    const callbackUrl = appUrl + '/api/discogs/oauth/callback/' + user.id;

    const REQUEST_TOKEN_URL = 'https://api.discogs.com/oauth/request_token';
    const authHeader = buildOAuthHeader(
      'GET',
      REQUEST_TOKEN_URL,
      { oauth_callback: callbackUrl },
      key, secret,
      /* tokenKey= */ '', /* tokenSecret= */ '',
    );

    const r = await fetch(REQUEST_TOKEN_URL, {
      headers: {
        Authorization:  authHeader,
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent':   'MetalVault/1.0',
      },
    });

    const text = await r.text();
    if (!r.ok) return NextResponse.json({ error: 'Discogs: ' + text }, { status: r.status });

    const params           = new URLSearchParams(text);
    const oauthToken       = params.get('oauth_token');
    const oauthTokenSecret = params.get('oauth_token_secret');

    if (!oauthToken) return NextResponse.json({ error: 'No token from Discogs' }, { status: 500 });

    // Temporarily persist request secret (needed to sign the access_token exchange)
    const { getAdminClient } = await import('@/lib/supabase-server');
    await getAdminClient().from('discogs_tokens').upsert({
      user_id:          user.id,
      access_token:     oauthToken,
      access_secret:    oauthTokenSecret,
      discogs_username: null,
    }, { onConflict: 'user_id' });

    return NextResponse.json({ authorizeUrl: 'https://www.discogs.com/oauth/authorize?oauth_token=' + oauthToken });

  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
