// ── /api/cron/this-day — daily "This day in metal" push ──────────
//
// Fires once a day (vercel cron 17:00 UTC = 18:00 PL / 19:00 DE) for
// every user with push subscribed AND notifications enabled.
//
// Payload:
//   "Today 1986: Slayer — Reign in Blood. Do you own it?"
//
// Tap → app opens to Feed with ?day=2026-05-09 query, the FeedTab can
// surface the fact in a small modal/banner with three CTAs:
//   ✓ Mark as listened today
//   + Add to wishlist
//   ✕ Skip
//
// We DON'T pre-check whether the user owns it — adding that join
// would 5× the work and we'd lose the "discovery" angle (the point
// of the push is to remind them of a classic).
//
// Skip: dates without an entry in metal-history.js (~30% of the
// year). Better to miss days than show filler facts.

import { NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabase-server';
import { metalForDate } from '@/lib/metal-history';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Server misconfigured: CRON_SECRET unset' }, { status: 500 });
  }
  const auth = request.headers.get('authorization');
  if (auth !== 'Bearer ' + process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const fact = metalForDate(new Date());
  if (!fact) {
    return NextResponse.json({ skipped: true, reason: 'no entry for today' });
  }

  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
    return NextResponse.json({ error: 'VAPID keys not configured' }, { status: 503 });
  }

  const sb = getAdminClient();

  // Fan out to every user with at least one push subscription. We
  // join nothing else — we don't need to filter by "user is active"
  // or "has a collection". The push is a discovery prompt, not a
  // collection-driven alert.
  const { data: subs, error } = await sb
    .from('push_subscriptions')
    .select('user_id')
    .limit(50_000);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const userIds = [...new Set((subs || []).map(s => s.user_id))];

  let { notifyUser } = await import('@/app/api/push/notify/route');
  // notifyUser fans out to all of a user's subscriptions internally.

  let pushesSent = 0;
  const errors = [];
  // Date suffix for deep-link so the in-app handler knows which day's
  // fact to surface even if the user opens the push 3h later.
  const dateParam = new Date().toISOString().slice(0, 10);  // YYYY-MM-DD

  for (const uid of userIds) {
    try {
      await notifyUser(uid, {
        title: '🤘 ' + fact.year + ' · ' + fact.artist,
        body:  fact.album + ' — listen today?',
        url:   '/?tab=feed&day=' + dateParam,
        tag:   'this-day-' + dateParam,   // collapse if user already got it
      });
      pushesSent++;
    } catch (e) {
      errors.push(uid + ':' + (e.message || '').slice(0, 30));
    }
  }

  return NextResponse.json({
    success:     true,
    fact,
    users_total: userIds.length,
    pushes_sent: pushesSent,
    errors:      errors.slice(0, 10),
  });
}
