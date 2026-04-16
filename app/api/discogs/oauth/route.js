export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';

// Discogs OAuth 1.0a - Step 1: Get request token
export async function GET(request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const key    = process.env.DISCOGS_KEY;
  const secret = process.env.DISCOGS_SECRET;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://metal-vault-six.vercel.app';

  // OAuth requires Consumer Key+Secret (not personal token)
  // If user only has DISCOGS_TOKEN, show helpful message
  if (!key || !secret) {
    return NextResponse.json({
      error: 'Discogs OAuth requires Consumer Key + Consumer Secret. Go to discogs.com/settings/developers → Create App to get them. Your DISCOGS_TOKEN cannot be used for OAuth.',
      helpUrl: 'https://www.discogs.com/settings/developers'
    }, { status: 503 });
  }

  try {
    // user_id in PATH (not query string) — Discogs strips query params when appending oauth_token/verifier
    const callback = encodeURIComponent(appUrl + '/api/discogs/oauth/callback/' + user.id);

    const r = await fetch(
      'https://api.discogs.com/oauth/request_token',
      {
        method: 'GET',
        headers: {
          Authorization: 'OAuth oauth_consumer_key="'+key+'",'
            + 'oauth_nonce="'+Math.random().toString(36).slice(2)+'",'
            + 'oauth_timestamp="'+Math.floor(Date.now()/1000)+'",'
            + 'oauth_callback="'+callback+'",'
            + 'oauth_signature_method="PLAINTEXT",'
            + 'oauth_version="1.0",'
            + 'oauth_signature="'+secret+'&"',
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'MetalVault/1.0',
        },
      }
    );

    const text = await r.text();
    if (!r.ok) return NextResponse.json({ error: 'Discogs: ' + text }, { status: r.status });

    const params  = new URLSearchParams(text);
    const oauthToken       = params.get('oauth_token');
    const oauthTokenSecret = params.get('oauth_token_secret');

    if (!oauthToken) return NextResponse.json({ error: 'No token from Discogs' }, { status: 500 });

    // Store token secret in session (via cookie via Supabase)
    // We'll use a simple DB table for this
    const { getAdminClient } = await import('@/lib/supabase-server');
    await getAdminClient().from('discogs_tokens').upsert({
      user_id:      user.id,
      access_token: oauthToken,         // temp: request token
      access_secret: oauthTokenSecret,  // temp: request secret
      discogs_username: null,
    }, { onConflict: 'user_id' });

    const authorizeUrl = 'https://www.discogs.com/oauth/authorize?oauth_token=' + oauthToken;
    return NextResponse.json({ authorizeUrl });

  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
