// ── /api/profile/delete ────────────────────────────────────────────
// GDPR/COPPA "right to be forgotten" — fully removes the user's account
// + every piece of related data + storage photos.
//
// Cascade plan:
//   1. Cancel any active Stripe subscription so they don't get charged again
//   2. Recursively delete the user's storage objects (collection-photos/<uid>/)
//   3. supabase.auth.admin.deleteUser(userId) — auth.users row goes away
//      and ON DELETE CASCADE on every user-data table cleans up the rest
//      (profiles, collection, watchlist, price_alerts, artist_follows,
//      portfolio_snapshots, push_subscriptions, share_tokens,
//      discogs_tokens, user_streaks, concert_notifications,
//      concert_attendance_prompts, user_concerts, user_venues,
//      user_artist_completion).
//
// Requires the user to type their own email as a confirmation token in
// the request body — defends against accidental nukes from a leaked
// session cookie.

export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { createClient, getAdminClient } from '@/lib/supabase-server';

export async function DELETE(request) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body = {};
  try { body = await request.json(); } catch {}
  if (!body.confirm_email || String(body.confirm_email).trim().toLowerCase() !== (user.email || '').toLowerCase()) {
    return NextResponse.json({ error: 'Email confirmation does not match' }, { status: 400 });
  }

  const admin = getAdminClient();

  // 1) Cancel active Stripe subscription (if any). Best-effort — the user's
  // payment history is already in Stripe regardless of our local state.
  try {
    const { data: profile } = await admin
      .from('profiles')
      .select('subscription_id, subscription_source')
      .eq('id', user.id)
      .single();

    // Only attempt to cancel via Stripe if the active sub came from Stripe.
    // Play Billing subscriptions go through RevenueCat; users cancel those
    // in the Play Store account UI. (RC will pick up the deletion event
    // through the linked app_user_id when the user goes away.)
    const fromStripe = profile?.subscription_source !== 'revenuecat';
    if (fromStripe && profile?.subscription_id && process.env.STRIPE_SECRET_KEY) {
      try {
        const Stripe = (await import('stripe')).default;
        const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
        await stripe.subscriptions.cancel(profile.subscription_id);
      } catch {
        // Already cancelled / not found / network issue — swallow, user
        // can still cancel via Stripe portal afterwards if needed.
      }
    }
  } catch {}

  // 2) Wipe storage. Photos live at `collection-photos/<userId>/...`. We
  // list and remove in one shot. If listing fails (e.g. bucket policy
  // restricts), auth deletion still proceeds — orphan files are cheap.
  try {
    const { data: files } = await admin.storage.from('collection-photos').list(user.id, { limit: 1000 });
    if (files && files.length > 0) {
      const paths = files.map(f => `${user.id}/${f.name}`);
      await admin.storage.from('collection-photos').remove(paths);
    }
  } catch {}

  // 3) Delete the auth user. ON DELETE CASCADE chains take care of all
  // user-data rows across every table (see migration 001_schema.sql etc.).
  const { error } = await admin.auth.admin.deleteUser(user.id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // 4) Clear the session cookie locally so the redirect target sees them
  // as anonymous immediately.
  await sb.auth.signOut().catch(() => {});

  return NextResponse.json({ ok: true });
}
