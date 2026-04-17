// ── Debug: inspect Discogs OAuth configuration ──────────────────
// GET this endpoint to verify env vars and callback URL are correct.
export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { createClient, getAdminClient } from '@/lib/supabase-server';

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const key    = process.env.DISCOGS_KEY;
  const secret = process.env.DISCOGS_SECRET;
  const token  = process.env.DISCOGS_TOKEN;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || null;

  const checks = {
    env: {
      DISCOGS_KEY:         key    ? `set (${key.length} chars)`    : '❌ MISSING',
      DISCOGS_SECRET:      secret ? `set (${secret.length} chars)` : '❌ MISSING',
      DISCOGS_TOKEN:       token  ? `set (${token.length} chars)`  : 'not set (optional)',
      NEXT_PUBLIC_APP_URL: appUrl ? appUrl                          : '❌ MISSING',
    },
    expectedCallback: appUrl
      ? appUrl + '/api/discogs/oauth/callback'
      : 'cannot compute — NEXT_PUBLIC_APP_URL not set',
    callbackForCurrentUser: appUrl && user
      ? appUrl + '/api/discogs/oauth/callback/' + user.id
      : null,
    signedInAs: user ? { id: user.id, email: user.email } : null,
    storedToken: null,
    notes: [
      'The callback URL above must match the one registered at',
      'https://www.discogs.com/settings/developers → your app → Callback URL.',
      'Register EXACTLY: ' + (appUrl || '?') + '/api/discogs/oauth/callback',
    ],
  };

  if (user) {
    const { data } = await getAdminClient()
      .from('discogs_tokens')
      .select('user_id, discogs_username, created_at, access_token, access_secret')
      .eq('user_id', user.id)
      .single();

    if (data) {
      const phase =
        data.discogs_username            ? '✅ COMPLETE (Step 2 done)' :
        data.access_token?.length === 40 ? '⏳ STUCK at Step 1 (request token only)' :
        '?';
      checks.storedToken = {
        phase,
        discogs_username: data.discogs_username,
        created_at:       data.created_at,
        access_token_len: data.access_token?.length || 0,
        access_secret_len:data.access_secret?.length || 0,
      };
    } else {
      checks.storedToken = 'no row — click "Connect Discogs" to start OAuth';
    }
  }

  return NextResponse.json(checks, { status: 200 });
}
