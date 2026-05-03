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
import { NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabase-server';
import { accessTokenHeader, apiCallHeader } from '@/lib/oauth';


export const dynamic = 'force-dynamic';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const oauthToken    = searchParams.get('oauth_token');
  const oauthVerifier = searchParams.get('oauth_verifier');
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin;

  // Generic redirect builder — never includes raw upstream payloads or
  // signature fragments in the URL; details go to server logs/Sentry.
  const errorRedirect = (code) =>
    NextResponse.redirect(appUrl + '/?discogs_error=' + code);

  if (!oauthToken || !oauthVerifier) {
    return errorRedirect('missing_params');
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
      console.error('[discogs-callback] DB lookup failed:', dbError?.message || 'no_token_record');
      return errorRedirect('db_lookup_failed');
    }

    const { user_id: userId } = stored;
    const requestTokenSecret = (stored.access_secret || '').trim();

    if (!requestTokenSecret) {
      return errorRedirect('empty_request_token_secret');
    }

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
      // Full upstream body goes to server logs only; redirect carries an
      // opaque code so we don't expose Discogs internals or our computed
      // signature material via the URL bar / Referer header.
      console.error('[discogs-callback] access_token failed:', r.status, text.slice(0, 300));
      return errorRedirect('access_token_failed');
    }

    const p            = new URLSearchParams(text);
    const accessToken  = p.get('oauth_token');
    const accessSecret = p.get('oauth_token_secret');

    if (!accessToken) {
      return errorRedirect('no_access_token');
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
    return errorRedirect('exception');
  }
}
