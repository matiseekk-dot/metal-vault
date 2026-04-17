// ── Discogs OAuth 1.0a — Step 1: get request token ───────────────
// PLAINTEXT signature over HTTPS (the Discogs-documented approach).
export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { createClient, getAdminClient } from '@/lib/supabase-server';
import { requestTokenHeader } from '@/lib/oauth';

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

    const r = await fetch('https://api.discogs.com/oauth/request_token', {
      method: 'GET',
      headers: {
        Authorization:  requestTokenHeader(key, secret, callbackUrl),
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent':   'MetalVault/1.0',
      },
    });

    const text = await r.text();
    if (!r.ok) {
      return NextResponse.json(
        { error: 'Discogs ' + r.status + ': ' + text.slice(0, 300) },
        { status: r.status },
      );
    }

    const params           = new URLSearchParams(text);
    const oauthToken       = params.get('oauth_token');
    const oauthTokenSecret = params.get('oauth_token_secret');

    if (!oauthToken) return NextResponse.json({ error: 'No token from Discogs' }, { status: 500 });

    // Persist request token secret — needed to sign Step 2
    await getAdminClient().from('discogs_tokens').upsert({
      user_id:          user.id,
      access_token:     oauthToken,
      access_secret:    oauthTokenSecret,
      discogs_username: null,
    }, { onConflict: 'user_id' });

    return NextResponse.json({
      authorizeUrl: 'https://www.discogs.com/oauth/authorize?oauth_token=' + oauthToken,
    });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
