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

export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabase-server';

const BUDGET_MS = 3 * 60 * 1000;        // 3 minutes hard ceiling per invocation
const PACING_MS = 600;                  // Discogs rate-limit safe pacing
const MAX_ITEMS = Math.floor(BUDGET_MS / PACING_MS);  // ~300

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
  const auth = request.headers.get('authorization');
  if (auth !== 'Bearer '+process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

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

  // ── 1. Refresh collection prices ─────────────────────────────
  // Order by last_price_check ASC NULLS FIRST → stale items go first.
  // Cap to MAX_ITEMS so we never exceed Vercel timeout.
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
      await sb.from('collection').update({
        current_price:    lowest,
        median_price:     median,
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

  // ── 2. Evaluate active price alerts (only if budget remaining) ──
  if (!budgetExpired()) {
    const { data: alerts } = await sb
      .from('price_alerts')
      .select('*, auth_user:user_id(email)')
      .eq('is_active', true)
      .order('updated_at', { ascending: true, nullsFirst: true });

    const remainingMs   = BUDGET_MS - (Date.now() - startedAt);
    const alertsBudget  = Math.floor(remainingMs / PACING_MS);
    const alertsToCheck = (alerts || []).slice(0, alertsBudget);
    results.alertsSkippedBudget = (alerts?.length || 0) - alertsToCheck.length;

    for (const alert of alertsToCheck) {
      if (budgetExpired()) break;
      try {
        const r = await fetch(
          'https://api.discogs.com/marketplace/stats/'+alert.discogs_id,
          { headers: { Authorization: discogsAuth, 'User-Agent': 'MetalVault/1.0' } }
        );
        if (!r.ok) continue;
        const d = await r.json();
        const lowest = Number(d.lowest_price?.value) || null;
        if (!lowest) continue;

        const target = Number(alert.target_price);
        const dir    = alert.direction || 'below';
        const trigger = (dir === 'below' && lowest <= target)
                     || (dir === 'above' && lowest >= target);

        if (trigger) {
          await sb.from('price_alerts').update({
            triggered_at: new Date().toISOString(),
            is_active:    false,
            last_seen_price: lowest,
          }).eq('id', alert.id);

          await sendPushToUser(alert.user_id, {
            title: '🎯 Price alert hit',
            body:  alert.artist + ' — ' + alert.album + ' is now $' + lowest.toFixed(0),
            url:   '/?tab=vault',
            tag:   'alert-' + alert.id,
          });

          if (alert.auth_user?.email) {
            await sendEmail(
              alert.auth_user.email,
              'Price alert: ' + alert.artist + ' — ' + alert.album,
              '<h2>' + alert.artist + ' — ' + alert.album + '</h2>'
              + '<p>Now <strong>$' + lowest.toFixed(0) + '</strong> on Discogs (your target: $' + target + ')</p>'
              + '<p><a href="https://metal-vault-six.vercel.app/?tab=vault">Open Metal Vault →</a></p>'
            );
          }
          results.alertsTriggered++;
        } else {
          // Even if not triggered, update last_seen_price + updated_at so we rotate fairly
          await sb.from('price_alerts').update({
            last_seen_price: lowest,
            updated_at:      new Date().toISOString(),
          }).eq('id', alert.id);
        }
      } catch (e) {
        results.errors.push('alert:'+alert.id+':'+e.message.slice(0,30));
      }
      await new Promise(r => setTimeout(r, PACING_MS));
    }
  }

  results.durationMs = Date.now() - startedAt;
  return NextResponse.json({ success: true, ...results });
}
