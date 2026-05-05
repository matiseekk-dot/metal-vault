// ── Diagnostic endpoint for price alerts ─────────────────────
//
// GET /api/alerts/debug
//
// Returns:
//   • Whether the operator's notification channels are configured
//     (VAPID keys for push, RESEND_API_KEY for email).
//   • All of THIS user's alerts with the data the cron uses to decide
//     whether to fire.
//   • For every alert with a Discogs ID, queries Discogs marketplace
//     stats live and reports what the lowest price IS right now plus
//     whether it crosses the alert threshold.
//
// This lets the user see WHY a given alert hasn't fired yet — the
// usual answer is "the price hasn't crossed the threshold yet" or
// "VAPID/RESEND not configured so the cron fires but can't reach you".

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';

// Admin gate. The debug endpoint dumps the user's full alert table +
// live Discogs lookups; keep it off in prod unless explicitly enabled.
function debugAllowed() {
  if (process.env.NODE_ENV !== 'production') return true;
  return process.env.DEBUG_ENDPOINTS_ENABLED === '1';
}

function discogsAuth() {
  const k = process.env.DISCOGS_KEY, s = process.env.DISCOGS_SECRET, t = process.env.DISCOGS_TOKEN;
  if (k && s) return 'Discogs key=' + k + ', secret=' + s;
  if (t)      return 'Discogs token=' + t;
  return null;
}

export async function GET() {
  if (!debugAllowed()) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const out = {
    you: { id: user.id, email: user.email },
    delivery_channels: {
      push_configured:  !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY),
      email_configured: !!process.env.RESEND_API_KEY,
      cron_configured:  !!process.env.CRON_SECRET,
    },
    cron_schedule:      'daily at 09:00 UTC (10:00 / 11:00 Polish time)',
  };

  // Push subscription rows for this user
  const { count: pushCount } = await sb
    .from('push_subscriptions').select('id', { count: 'exact', head: true })
    .eq('user_id', user.id);
  out.delivery_channels.push_subscriptions_for_you = pushCount || 0;

  // All alerts (active + already triggered) for the user
  const { data: alerts } = await sb
    .from('price_alerts').select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });

  if (!alerts || alerts.length === 0) {
    out.alerts = [];
    out.diagnosis = 'No alerts in the database for your account. If you tried to set one and it failed, check that migration 025_alerts_nullable_discogs.sql has been applied — without it, alerts on watchlist items without a numeric Discogs ID will fail with a NOT NULL constraint violation.';
    return NextResponse.json(out, { headers: { 'Cache-Control': 'no-store' } });
  }

  const auth = discogsAuth();
  out.alerts = [];

  for (const a of alerts) {
    const detail = {
      id:             a.id,
      artist:         a.artist,
      album:          a.album,
      type:           a.alert_type,
      target_price:   a.target_price,
      baseline_price: a.baseline_price,
      is_active:      a.is_active,
      triggered_at:   a.triggered_at,
      created_at:     a.created_at,
      last_seen_price: a.last_seen_price,
      discogs_id:     a.discogs_id,
      album_id:       a.album_id,
    };

    if (!a.is_active) {
      detail.status = 'INACTIVE — has already triggered (' + (a.triggered_at || 'unknown') + ') OR was manually disabled';
    } else if (!a.discogs_id) {
      detail.status = 'NO_DISCOGS_ID — cron cannot price-check this alert. Item came from BandsTab ♥ wanted toggle without a numeric ID. Treat as wishlist reminder.';
    } else if (!auth) {
      detail.status = 'NO_DISCOGS_AUTH — DISCOGS_KEY/SECRET/TOKEN missing on the server.';
    } else {
      // Hit Discogs LIVE to see what would happen if the cron ran now
      try {
        const r = await fetch('https://api.discogs.com/marketplace/stats/' + a.discogs_id, {
          headers: { Authorization: auth, 'User-Agent': 'MetalVault-debug/1.0' },
        });
        detail.discogs_status = r.status;
        if (r.status === 429) {
          detail.status = 'DISCOGS_RATE_LIMITED — cron will retry on next run. Try again later.';
        } else if (!r.ok) {
          detail.status = 'DISCOGS_ERROR_' + r.status + ' — Discogs returned an error for this item ID.';
        } else {
          const d = await r.json();
          const lowest      = Number(d.lowest_price?.value) || null;
          const numForSale  = d.num_for_sale ?? null;
          const target      = Number(a.target_price);
          const baseline    = Number(a.baseline_price) || null;
          const type        = a.alert_type
            || ((a.direction || 'below') === 'above' ? 'PRICE_RISE' : 'PRICE_DROP');

          detail.live = { lowest_price: lowest, num_for_sale: numForSale };

          let trigger = false;
          let why = '';
          if (type === 'LOW_STOCK') {
            trigger = numForSale != null && numForSale <= target;
            why = trigger
              ? 'WOULD FIRE: only ' + numForSale + ' copies for sale (target ≤ ' + target + ')'
              : 'NOT YET: ' + numForSale + ' copies for sale (target ≤ ' + target + ')';
          } else if (type === 'PRICE_DROP') {
            trigger = lowest != null && lowest <= target;
            why = trigger
              ? 'WOULD FIRE: lowest is $' + lowest + ' (target ≤ $' + target + ')'
              : 'NOT YET: lowest is $' + (lowest ?? '?') + ' (target ≤ $' + target + ')';
          } else if (type === 'PRICE_RISE') {
            trigger = lowest != null && lowest >= target;
            why = trigger
              ? 'WOULD FIRE: lowest is $' + lowest + ' (target ≥ $' + target + ')'
              : 'NOT YET: lowest is $' + (lowest ?? '?') + ' (target ≥ $' + target + ')';
          } else if (type === 'PERCENT_DROP' && baseline) {
            const dropPct = lowest != null ? ((baseline - lowest) / baseline) * 100 : 0;
            trigger = dropPct >= target;
            why = trigger
              ? 'WOULD FIRE: dropped ' + dropPct.toFixed(0) + '% from $' + baseline
              : 'NOT YET: only ' + dropPct.toFixed(0) + '% drop from $' + baseline + ' (target ≥ ' + target + '%)';
          } else if (type === 'PERCENT_RISE' && baseline) {
            const risePct = lowest != null ? ((lowest - baseline) / baseline) * 100 : 0;
            trigger = risePct >= target;
            why = trigger
              ? 'WOULD FIRE: rose ' + risePct.toFixed(0) + '% from $' + baseline
              : 'NOT YET: only ' + risePct.toFixed(0) + '% rise from $' + baseline + ' (target ≥ ' + target + '%)';
          } else {
            why = 'UNKNOWN_TYPE: ' + type;
          }

          detail.would_fire = trigger;
          detail.status     = why;
        }
      } catch (e) {
        detail.status = 'EXCEPTION: ' + e.message;
      }
    }

    out.alerts.push(detail);
  }

  // Top-level diagnosis summary
  const wouldFire   = out.alerts.filter(a => a.would_fire).length;
  const noDiscogs   = out.alerts.filter(a => a.status?.startsWith('NO_DISCOGS_ID')).length;
  const inactive    = out.alerts.filter(a => !a.is_active).length;
  const channels    = out.delivery_channels;

  out.diagnosis_summary = {
    total_alerts:      out.alerts.length,
    active_alerts:     out.alerts.filter(a => a.is_active).length,
    would_fire_now:    wouldFire,
    inactive_already:  inactive,
    no_discogs_id:     noDiscogs,
  };

  if (wouldFire > 0 && !channels.email_configured && channels.push_subscriptions_for_you === 0) {
    out.diagnosis_summary.warning = 'You have alerts that WOULD fire now, but neither email nor push delivery is reachable. Set RESEND_API_KEY in Vercel env, or grant the browser push permission and reload, then trigger the cron via /api/cron/prices with the CRON_SECRET to see notifications come through.';
  }

  return NextResponse.json(out, { headers: { 'Cache-Control': 'no-store' } });
}
