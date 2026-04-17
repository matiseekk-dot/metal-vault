// ── Discogs OAuth callback — dynamic [userId] path ───────────────
// Legacy route for backwards compatibility.
// The CANONICAL route is /api/discogs/oauth/callback (no userId in path).
// This route simply reads userId from the path and delegates to the
// same logic — looking up by oauth_token from the query string.
export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabase-server';
import { accessTokenHeader, apiCallHeader } from '@/lib/oauth';

export async function GET(request, { params }) {
  const { searchParams } = new URL(request.url);
  const oauthToken    = searchParams.get('oauth_token');
  const oauthVerifier = searchParams.get('oauth_verifier');
  const appUrl        = process.env.NEXT_PUBLIC_APP_URL || 'https://metal-vault-six.vercel.app';
  // params.userId is available but we look up by oauth_token for robustness

  if (!oauthToken || !oauthVerifier) {
    return NextResponse.redirect(appUrl + '/?discogs_error=missing_params');
  }

  const key    = process.env.DISCOGS_KEY;
  const secret = process.env.DISCOGS_SECRET;
  const admin  = getAdminClient();

  try {
    // Look up by oauth_token — same approach as canonical route
    const { data: stored, error: dbError } = await admin
      .from('discogs_tokens')
      .select('user_id, access_secret')
      .eq('access_token', oauthToken)
      .single();

    if (dbError || !stored) {
      const msg = dbError?.message || 'no_token_record';
      return NextResponse.redirect(appUrl + '/?discogs_error=' + encodeURIComponent('DB lookup failed: ' + msg));
    }

    const { user_id: userId } = stored;
    const requestTokenSecret = (stored.access_secret || '').trim();

    if (!requestTokenSecret) {
      return NextResponse.redirect(appUrl + '/?discogs_error=empty_request_token_secret');
    }

    const computedSig = secret + '&' + requestTokenSecret;
    const authHeader = accessTokenHeader(key, secret, oauthToken, requestTokenSecret, oauthVerifier);

    const r = await fetch('https://api.discogs.com/oauth/access_token', {
      method: 'POST',
      headers: {
        Authorization:  authHeader,
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent':   'MetalVault/1.0',
      },
    });

    const text = await r.text();
    if (!r.ok) {
      const diagMsg = text.slice(0, 300)
        + ' | WE SENT SIG: ' + computedSig.slice(0, 36)
        + '... (len=' + requestTokenSecret.length + ')';
      return NextResponse.redirect(appUrl + '/?discogs_error=' + encodeURIComponent(diagMsg));
    }

    const p            = new URLSearchParams(text);
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
      user_id:          userId,
      access_token:     accessToken,
      access_secret:    accessSecret,
      discogs_username: username,
    }, { onConflict: 'user_id' });

    return NextResponse.redirect(appUrl + '/?discogs_connected=1&username=' + encodeURIComponent(username || ''));
  } catch (e) {
    return NextResponse.redirect(appUrl + '/?discogs_error=' + encodeURIComponent(e.message.slice(0, 200)));
  }
}
