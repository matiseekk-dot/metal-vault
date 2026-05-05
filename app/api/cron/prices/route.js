// ── Daily price refresh + alert evaluation cron ────────────────
// Runs 09:00 UTC daily on Vercel. Each invocation has a strict ~3min budget;
// if there are more items than fit in one run, the next day's cron picks up
// the rest (we order by `last_price_check ASC NULLS FIRST` so stale-most
// items are processed first).
//
// Scaling math:
//   Discogs allows ~100 req/min auth → ~600ms safe pacing
//   3min budget @ 600ms = 300 items per cron run
//   Worst case: 1000 collection items → fully fresh in ~4 days
//   Real world: most items are still <23h old → skipped → much faster
//
// If you outgrow this, add a second cron at 21:00 UTC and split the work.

import { NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabase-server';


export const dynamic       = 'force-dynamic';
// IMPORTANT: without this, Vercel kills the function at 10s (Hobby) /
// 60s (Pro default), chopping off the alerts loop before it ever runs.
// 300 = 5 minutes, the max for Pro plans on /api routes.
export const maxDuration   = 300;

const BUDGET_MS = 4 * 60 * 1000;        // 4 minutes hard ceiling per invocation
const PACING_MS = 600;                  // Discogs rate-limit safe pacing
const MAX_ITEMS = Math.floor(BUDGET_MS / PACING_MS);  // ~400

function authHeader() {
  const key = process.env.DISCOGS_KEY, secret = process.env.DISCOGS_SECRET, token = process.env.DISCOGS_TOKEN;
  if (!key && !token) return null;
  return key && secret ? 'Discogs key='+key+', secret='+secret : 'Discogs token='+token;
}

async function sendPushToUser(userId, payload) {
  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) return;
  try {
    const { notifyUser } = await import('@/app/api/push/notify/route');
    await notifyUser(userId, payload);
  } catch {}
}

async function sendEmail(to, subject, html) {
  const key = process.env.RESEND_API_KEY;
  if (!key) return;
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer '+key },
    body: JSON.stringify({
      from: process.env.FROM_EMAIL || 'Metal Vault <onboarding@resend.dev>',
      to, subject, html,
    }),
  });
}

export async function GET(request) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Server misconfigured: CRON_SECRET unset' }, { status: 500 });
  }
  const auth = request.headers.get('authorization');
  if (auth !== 'Bearer '+process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://metal-vault-six.vercel.app';

  const sb = getAdminClient();
  const discogsAuth = authHeader();
  if (!discogsAuth) return NextResponse.json({ error: 'Discogs not configured' });

  const startedAt = Date.now();
  const budgetExpired = () => (Date.now() - startedAt) > BUDGET_MS;
  const results = {
    collectionUpdated: 0, collectionSkippedBudget: 0,
    alertsTriggered:   0, alertsSkippedBudget: 0,
    errors:            [],
    durationMs:        0,
    budgetMs:          BUDGET_MS,
  };

  // ── 1. Evaluate active price alerts FIRST ────────────────────
  // Alerts are user-facing and rare (a handful per active user) so we
  // process them BEFORE the much larger collection-refresh phase. The
  // bug this fixes: original ordering had collection refresh first,
  // and at ~600ms per item the function would burn its entire timeout
  // before reaching the alerts loop. With alerts first, even a 12-alert
  // user gets them processed in ~7s — well under any timeout.
  {
    // ORDER BY last_triggered ASC NULLS FIRST: never-triggered alerts
    // get processed first (they're the user's "I'm waiting on this"
    // signal), then we cycle through previously-triggered ones in
    // age order. Earlier code referenced a nonexistent `updated_at`
    // column here — Postgres would 42703 the whole select, which is
    // why the cron silently no-op'd for everyone.
    const { data: alerts, error: alertsErr } = await sb
      .from('price_alerts')
      .select('*, auth_user:user_id(email)')
      .eq('is_active', true)
      .order('last_triggered', { ascending: true, nullsFirst: true });
    if (alertsErr) console.error('[cron/prices] alerts select failed:', alertsErr.message);

    const alertsToCheck = alerts || [];
    results.totalAlertsActive = alertsToCheck.length;

    for (const alert of alertsToCheck) {
      if (budgetExpired()) break;
      // Skip alerts with no Discogs ID — those came from BandsTab "♥
      // wanted" toggles or MB-fallback rows and have nothing for the
      // marketplace stats endpoint to look up. They stay in the table
      // as wishlist reminders but don't consume the cron budget.
      if (!alert.discogs_id) {
        results.alertsSkippedNoId = (results.alertsSkippedNoId || 0) + 1;
        continue;
      }
      try {
        const r = await fetch(
          'https://api.discogs.com/marketplace/stats/'+alert.discogs_id,
          { headers: { Authorization: discogsAuth, 'User-Agent': 'MetalVault/1.0' } }
        );
        if (!r.ok) continue;
        const d = await r.json();
        const lowest = Number(d.lowest_price?.value) || null;
        const numForSale = d.num_for_sale ?? null;
        if (!lowest && alert.alert_type !== 'LOW_STOCK') continue;

        const target   = Number(alert.target_price);
        const baseline = Number(alert.baseline_price) || null;
        // Resolve effective alert type. Older rows predate alert_type
        // and only have `direction`; honour that here. Without this
        // mapping every legacy row falls through to PRICE_DROP and
        // misses every "alert me when price RISES above X" intent.
        const legacyDir   = alert.direction || 'below';
        const type        = alert.alert_type
          || (legacyDir === 'above' ? 'PRICE_RISE' : 'PRICE_DROP');

        let trigger = false;
        let triggerMsg = '';
        if (type === 'LOW_STOCK') {
          // Stock alert: triggers when copies on Discogs drop ≤ target
          if (numForSale != null && numForSale <= target) {
            trigger = true;
            triggerMsg = 'only ' + numForSale + ' copies for sale';
          }
        } else if (type === 'PRICE_DROP') {
          if (lowest <= target) {
            trigger = true;
            triggerMsg = 'is now $' + lowest.toFixed(0);
          }
        } else if (type === 'PRICE_RISE') {
          if (lowest >= target) {
            trigger = true;
            triggerMsg = 'is now $' + lowest.toFixed(0);
          }
        } else if (type === 'PERCENT_DROP' && baseline) {
          const dropPct = ((baseline - lowest) / baseline) * 100;
          if (dropPct >= target) {
            trigger = true;
            triggerMsg = 'dropped ' + dropPct.toFixed(0) + '% to $' + lowest.toFixed(0);
          }
        } else if (type === 'PERCENT_RISE' && baseline) {
          const risePct = ((lowest - baseline) / baseline) * 100;
          if (risePct >= target) {
            trigger = true;
            triggerMsg = 'rose ' + risePct.toFixed(0) + '% to $' + lowest.toFixed(0);
          }
        }

        if (trigger) {
          // Use last_triggered (the column that exists) instead of
          // triggered_at + last_seen_price (which don't). Old code
          // silently failed every UPDATE here, leaving is_active=true
          // forever — same alert re-fired on every cron pass.
          const { error: upErr } = await sb.from('price_alerts').update({
            last_triggered: new Date().toISOString(),
            is_active:      false,
          }).eq('id', alert.id);
          if (upErr) console.error('[cron/prices] trigger update failed:', upErr.message);

          await sendPushToUser(alert.user_id, {
            title: '🎯 Price alert hit',
            body:  alert.artist + ' — ' + alert.album + ' ' + triggerMsg,
            url:   '/?tab=vault',
            tag:   'alert-' + alert.id,
          });

          if (alert.auth_user?.email) {
            await sendEmail(
              alert.auth_user.email,
              'Price alert: ' + alert.artist + ' — ' + alert.album,
              '<h2>' + alert.artist + ' — ' + alert.album + '</h2>'
              + '<p>Now <strong>$' + lowest.toFixed(0) + '</strong> on Discogs (your target: $' + target + ')</p>'
              + '<p><a href="' + APP_URL + '/?tab=vault">Open Metal Vault →</a></p>'
            );
          }
          results.alertsTriggered++;
        }
        // No-fire branch intentionally writes nothing — last_seen_price
        // and updated_at columns don't exist in the schema, and
        // last_triggered must stay NULL until the alert actually fires
        // (the order-by uses NULLs-first to prioritise un-triggered
        // alerts each pass).
      } catch (e) {
        results.errors.push('alert:'+alert.id+':'+e.message.slice(0,30));
      }
      await new Promise(r => setTimeout(r, PACING_MS));
    }
  }

  // ── 2. Refresh collection prices in remaining budget ─────────
  // Runs AFTER alerts so a slow function never starves the user-facing
  // notification path. Order by last_price_check ASC NULLS FIRST so
  // stale items go first. Cap to MAX_ITEMS so we never exceed the
  // function timeout.
  if (!budgetExpired()) {
    const { data: items } = await sb
      .from('collection')
      .select('id, discogs_id, artist, album, user_id')
      .not('discogs_id', 'is', null)
      .or('last_price_check.is.null,last_price_check.lt.'+new Date(Date.now()-23*60*60*1000).toISOString())
      .order('last_price_check', { ascending: true, nullsFirst: true })
      .limit(MAX_ITEMS);

    const totalCollectionPending = items?.length || 0;

    for (const item of (items || [])) {
      if (budgetExpired()) {
        results.collectionSkippedBudget = totalCollectionPending - results.collectionUpdated;
        break;
      }
      try {
        const r = await fetch(
          'https://api.discogs.com/marketplace/stats/'+item.discogs_id,
          { headers: { Authorization: discogsAuth, 'User-Agent': 'MetalVault/1.0' } }
        );
        if (!r.ok) continue;
        const d = await r.json();
        const lowest = d.lowest_price?.value || null;
        const median = d.median?.value       || null;
        const numForSale = d.num_for_sale ?? null;
        await sb.from('collection').update({
          current_price:    lowest,
          median_price:     median,
          num_for_sale:     numForSale,
          last_price_check: new Date().toISOString(),
        }).eq('id', item.id);
        if (lowest || median) {
          await sb.from('price_history').upsert({
            discogs_id:    item.discogs_id,
            snapshot_date: new Date().toISOString().split('T')[0],
            lowest_price:  lowest,
            median_price:  median,
          }, { onConflict: 'discogs_id,snapshot_date' });
        }
        results.collectionUpdated++;
      } catch (e) {
        results.errors.push('col:'+item.id+':'+e.message.slice(0,30));
      }
      await new Promise(r => setTimeout(r, PACING_MS));
    }
  }

  results.durationMs = Date.now() - startedAt;
  return NextResponse.json({ success: true, ...results });
}
