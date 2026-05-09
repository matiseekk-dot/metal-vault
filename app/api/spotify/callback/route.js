// ── /api/spotify/callback — Spotify OAuth redirect target ───────
//
// Spotify hits this with ?code= (success) or ?error= (denied).
// We exchange the code for refresh+access tokens, write them to
// `spotify_tokens` (upsert by user_id), then redirect back to the
// app with a success/error query param so the UI can show feedback.

import { NextResponse } from 'next/server';
import { createClient, getAdminClient } from '@/lib/supabase-server';
import { spotifyExchangeCode, spotifyGetMe } from '@/lib/spotify';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  const url = new URL(request.url);
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || url.origin;
  const code   = url.searchParams.get('code');
  const error  = url.searchParams.get('error');
  const stateB = url.searchParams.get('state');

  // User clicked "deny" on Spotify's consent screen
  if (error) {
    return NextResponse.redirect(appUrl + '/?spotify_error=' + encodeURIComponent(error));
  }
  if (!code) {
    return NextResponse.redirect(appUrl + '/?spotify_error=no_code');
  }

  // Validate state — must decode + match the calling user.
  let stateUserId = null;
  try {
    const parsed = JSON.parse(Buffer.from(stateB, 'base64url').toString('utf8'));
    stateUserId = parsed?.u || null;
  } catch {}

  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user || !stateUserId || user.id !== stateUserId) {
    return NextResponse.redirect(appUrl + '/?spotify_error=state_mismatch');
  }

  const redirectUri = appUrl + '/api/spotify/callback';

  let tokens;
  try {
    tokens = await spotifyExchangeCode({ code, redirectUri });
  } catch (e) {
    return NextResponse.redirect(appUrl + '/?spotify_error=' + encodeURIComponent(e.message));
  }
  if (!tokens.refresh_token) {
    return NextResponse.redirect(appUrl + '/?spotify_error=no_refresh_token');
  }

  // Resolve display name (nice-to-have, lets Profile show
  // "Connected as <name>"). Best-effort.
  let me = null;
  try { me = await spotifyGetMe(tokens.access_token); } catch {}

  // Persist via admin client — RLS would also allow this since the
  // policy is auth.uid() = user_id, but admin write is symmetric with
  // /api/discogs/oauth/callback and avoids one round-trip.
  const admin = getAdminClient();
  const { error: upErr } = await admin
    .from('spotify_tokens')
    .upsert({
      user_id:        user.id,
      refresh_token:  tokens.refresh_token,
      scope:          tokens.scope || null,
      spotify_id:     me?.id || null,
      display_name:   me?.display_name || null,
    }, { onConflict: 'user_id' });
  if (upErr) {
    return NextResponse.redirect(appUrl + '/?spotify_error=' + encodeURIComponent(upErr.message));
  }

  return NextResponse.redirect(appUrl + '/?spotify_connected=1&tab=profile');
}
