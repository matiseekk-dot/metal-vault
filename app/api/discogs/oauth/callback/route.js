// ── Discogs OAuth 1.0a — Step 2: exchange tokens ─────────────────
// This is the CANONICAL callback route registered in Discogs app settings.
//
// KEY DESIGN: We look up by `oauth_token` (request token, always present
// in the Discogs callback URL) instead of by userId in the URL path.
// This works regardless of what callback URL is registered in Discogs.
//
// In your Discogs app settings, register:
//   https://YOUR_APP_URL/api/discogs/oauth/callback
// (no trailing slash, no dynamic segments)
export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabase-server';
import { accessTokenHeader, apiCallHeader } from '@/lib/oauth';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const oauthToken    = searchParams.get('oauth_token');
  const oauthVerifier = searchParams.get('oauth_verifier');
  const appUrl        = process.env.NEXT_PUBLIC_APP_URL || 'https://metal-vault-six.vercel.app';

  if (!oauthToken || !oauthVerifier) {
    return NextResponse.redirect(appUrl + '/?discogs_error=missing_params');
  }

  const key    = process.env.DISCOGS_KEY;
  const secret = process.env.DISCOGS_SECRET;
  const admin  = getAdminClient();

  try {
    // Look up by oauth_token (request token) — NOT by userId in URL path.
    // We stored access_token = request_token in Step 1, so this always works.
    const { data: stored, error: dbError } = await admin
      .from('discogs_tokens')
      .select('user_id, access_secret')
      .eq('access_token', oauthToken)
      .single();

    if (dbError || !stored) {
      const msg = dbError?.message || 'no_token_record';
      console.error('[discogs-callback] DB lookup failed:', msg, 'oauth_token:', oauthToken);
      return NextResponse.redirect(appUrl + '/?discogs_error=' + encodeURIComponent('DB lookup failed: ' + msg));
    }

    const { user_id: userId } = stored;
    const requestTokenSecret = (stored.access_secret || '').trim();

    if (!requestTokenSecret) {
      return NextResponse.redirect(appUrl + '/?discogs_error=empty_request_token_secret');
    }

    // Exchange request token for access token
    // Build the signature we will send — show in error for debugging
    const computedSig = secret + '&' + requestTokenSecret;
    const authHeader = accessTokenHeader(key, secret, oauthToken, requestTokenSecret, oauthVerifier);

    // Log key values to Vercel logs
    console.log('[discogs-callback] oauth_token:', oauthToken.slice(0,8)+'...');
    console.log('[discogs-callback] requestTokenSecret (from DB):', requestTokenSecret.slice(0,8)+'...'+requestTokenSecret.slice(-4), '(len='+requestTokenSecret.length+')');
    console.log('[discogs-callback] computedSig:', computedSig.slice(0,20)+'...');

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
      console.error('[discogs-callback] access_token failed:', r.status, text);
      // Include our computed sig so user can compare with Discogs "Expected" value
      const diagMsg = text.slice(0, 300)
        + ' | WE SENT SIG: ' + computedSig.slice(0, 36)
        + '... (tokenSecretLen=' + requestTokenSecret.length + ')';
      return NextResponse.redirect(
        appUrl + '/?discogs_error=' + encodeURIComponent(diagMsg),
      );
    }

    const p            = new URLSearchParams(text);
    const accessToken  = p.get('oauth_token');
    const accessSecret = p.get('oauth_token_secret');

    if (!accessToken) {
      return NextResponse.redirect(appUrl + '/?discogs_error=no_access_token');
    }

    // Fetch Discogs username
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

    // Persist final access token (overwrite the temp request token)
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
    console.error('[discogs-callback] exception:', e.message);
    return NextResponse.redirect(
      appUrl + '/?discogs_error=' + encodeURIComponent(e.message.slice(0, 200)),
    );
  }
}
