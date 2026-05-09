// ── /api/lastfm/callback — exchange ?token for session_key ─────
// Stores the result in lastfm_tokens and redirects back to the app
// with success/error param so SpotifySyncCard-style UI can react.

import { NextResponse } from 'next/server';
import { createClient, getAdminClient } from '@/lib/supabase-server';
import { lastfmGetSession } from '@/lib/lastfm';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  const url    = new URL(request.url);
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || url.origin;
  const token  = url.searchParams.get('token');

  if (!token) {
    return NextResponse.redirect(appUrl + '/?lastfm_error=no_token');
  }

  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) {
    return NextResponse.redirect(appUrl + '/?lastfm_error=unauthorized');
  }

  let session;
  try {
    session = await lastfmGetSession(token);
  } catch (e) {
    return NextResponse.redirect(appUrl + '/?lastfm_error=' + encodeURIComponent(e.message));
  }

  const admin = getAdminClient();
  const { error: upErr } = await admin
    .from('lastfm_tokens')
    .upsert({
      user_id:     user.id,
      session_key: session.session_key,
      username:    session.name || 'unknown',
    }, { onConflict: 'user_id' });
  if (upErr) {
    return NextResponse.redirect(appUrl + '/?lastfm_error=' + encodeURIComponent(upErr.message));
  }

  return NextResponse.redirect(appUrl + '/?lastfm_connected=1&tab=profile');
}
