// ── /api/revenuecat/webhook — receives subscription events ──
// Configured in RC dashboard: Project Settings → Integrations → Webhooks.
// URL: https://metal-vault-six.vercel.app/api/revenuecat/webhook
// Authorization header: Bearer <REVENUECAT_WEBHOOK_SECRET> (set in env)
//
// Idempotency: each RC event has unique `id`. INSERT-first approach —
// duplicate IDs hit primary key conflict → already processed, skip.

export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabase-server';
import { processWebhookEvent, verifyWebhookAuth } from '@/lib/revenuecat-server';

export async function POST(request) {
  // 1) Verify auth (custom RC header)
  const auth = request.headers.get('authorization');
  if (!verifyWebhookAuth(auth)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // 2) Parse body
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const event = body?.event;
  if (!event?.id || !event?.type || !event?.app_user_id) {
    return NextResponse.json({ error: 'Malformed event' }, { status: 400 });
  }

  const admin = getAdminClient();

  // 3) Idempotency — INSERT first
  const { error: dupErr } = await admin
    .from('revenuecat_events')
    .insert({
      id:          event.id,
      event_type:  event.type,
      app_user_id: event.app_user_id,
      payload:     body,
    });

  // Primary key conflict = already processed, return 200 so RC stops retrying
  if (dupErr && dupErr.code === '23505') {
    return NextResponse.json({ ok: true, deduped: true });
  }
  if (dupErr) {
    // Other DB error — let RC retry
    return NextResponse.json({ error: dupErr.message }, { status: 500 });
  }

  // 4) Translate event to profile update
  const profileUpdate = processWebhookEvent(body);
  if (!profileUpdate) {
    // Event ignored (e.g. TEST, TRANSFER) — but already logged. OK.
    return NextResponse.json({ ok: true, ignored: true, type: event.type });
  }

  // 5) Find matching profile.
  // RC's app_user_id should be set to Supabase user.id by the client SDK.
  // (See SDK setup: Purchases.configure({ appUserID: supabaseUser.id }))
  const { data: profile, error: findErr } = await admin
    .from('profiles')
    .select('id')
    .eq('id', event.app_user_id)
    .single();

  if (findErr || !profile) {
    // Profile not found — RC user isn't in our DB. Could happen if:
    //   1) User deleted account before sub event arrived
    //   2) RC event for unrelated user (shouldn't happen with proper appUserID)
    // Log but return 200 so RC doesn't retry forever.
    console.warn('[revenuecat-webhook] Profile not found for app_user_id:', event.app_user_id);
    return NextResponse.json({ ok: true, profile_not_found: true });
  }

  // 6) Apply update
  const { error: updErr } = await admin
    .from('profiles')
    .update(profileUpdate)
    .eq('id', profile.id);

  if (updErr) {
    return NextResponse.json({ error: updErr.message }, { status: 500 });
  }

  return NextResponse.json({
    ok:     true,
    type:   event.type,
    status: profileUpdate.subscription_status,
  });
}
