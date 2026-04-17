// ── DEPRECATED: legacy callback route ───────────────────────────
// The canonical callback is /api/discogs/oauth/callback/[userId]/route.js.
// Step 1 always embeds userId in the URL path, so Discogs hits the
// canonical route. This file exists only as a safety net for any
// old bookmarks / cached redirect URIs reading user_id from query string.
export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabase-server';
import { accessTokenHeader, apiCallHeader } from '@/lib/oauth';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const oauthToken    = searchParams.get('oauth_token');
  const oauthVerifier = searchParams.get('oauth_verifier');
  const userId        = searchParams.get('user_id');   // legacy: query string
  const appUrl        = process.env.NEXT_PUBLIC_APP_URL || 'https://metal-vault-six.vercel.app';

  if (!oauthToken || !oauthVerifier || !userId) {
    return NextResponse.redirect(appUrl + '/?discogs_error=missing_params');
  }

  const key    = process.env.DISCOGS_KEY;
  const secret = process.env.DISCOGS_SECRET;
  const admin  = getAdminClient();

  try {
    const { data: stored } = await admin
      .from('discogs_tokens').select('access_secret').eq('user_id', userId).single();
    const requestTokenSecret = stored?.access_secret || '';

    const r = await fetch('https://api.discogs.com/oauth/access_token', {
      method: 'POST',
      headers: {
        Authorization:  accessTokenHeader(key, secret, oauthToken, requestTokenSecret, oauthVerifier),
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent':   'MetalVault/1.0',
      },
    });
    const text = await r.text();
    if (!r.ok) return NextResponse.redirect(appUrl + '/?discogs_error=' + encodeURIComponent(text.slice(0, 200)));

    const p = new URLSearchParams(text);
    const accessToken  = p.get('oauth_token');
    const accessSecret = p.get('oauth_token_secret');
    if (!accessToken) return NextResponse.redirect(appUrl + '/?discogs_error=no_access_token');

    let username = null;
    try {
      const ir = await fetch('https://api.discogs.com/oauth/identity', {
        headers: { Authorization: apiCallHeader(key, secret, accessToken, accessSecret), 'User-Agent': 'MetalVault/1.0' },
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
