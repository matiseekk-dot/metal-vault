// ── Manual Discogs sync fallback ─────────────────────────────────
// Only usable by the authenticated user for their own account.
export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { createClient, getAdminClient } from '@/lib/supabase-server';

export async function POST(request) {
  // Must be authenticated
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { username } = await request.json();

  if (!username) {
    return NextResponse.json({ error: 'Missing username' }, { status: 400 });
  }

  const admin = getAdminClient();
  const { error } = await admin.from('discogs_tokens').upsert({
    user_id:          user.id,   // always use the authenticated user's ID
    access_token:     'manual_token',
    access_secret:    'manual_secret',
    discogs_username: username.trim(),
  }, { onConflict: 'user_id' });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, message: `Manual sync activated for ${username}` });
}
