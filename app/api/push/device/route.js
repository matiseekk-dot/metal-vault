import { NextResponse } from 'next/server';
import { createClient, getAdminClient } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';

// FCM registration tokens are ~150-170 chars of [A-Za-z0-9_:-]; allow
// generous headroom but reject anything that can't be one.
const TOKEN_RE = /^[A-Za-z0-9_\-:.]{50,4096}$/;

// POST /api/push/device  { token, appVersion? }
// Registers (or re-assigns) this install's FCM token to the signed-in
// user. Written with the service role because `token` is unique across
// users: when another account signs in on the same phone the row has to
// move to them, and RLS (correctly) won't let one user UPDATE a row
// owned by another. The session check above is what authorizes it.
export async function POST(request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const token = typeof body.token === 'string' ? body.token.trim() : '';
  if (!TOKEN_RE.test(token)) {
    return NextResponse.json({ error: 'Invalid token' }, { status: 400 });
  }
  const appVersion = typeof body.appVersion === 'string' ? body.appVersion.slice(0, 32) : null;

  const admin = getAdminClient();
  const { error } = await admin.from('device_tokens').upsert({
    user_id:      user.id,
    token,
    platform:     'android',
    app_version:  appVersion,
    last_seen_at: new Date().toISOString(),
  }, { onConflict: 'token' });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}

// DELETE /api/push/device  { token }
// Only removes a token that belongs to the caller.
export async function DELETE(request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const token = typeof body.token === 'string' ? body.token.trim() : '';
  if (!TOKEN_RE.test(token)) {
    return NextResponse.json({ error: 'Invalid token' }, { status: 400 });
  }

  const admin = getAdminClient();
  await admin.from('device_tokens').delete().eq('token', token).eq('user_id', user.id);
  return NextResponse.json({ success: true });
}
