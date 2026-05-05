// ── Manual alerts trigger (debug + on-demand check) ──────────
//
// POST /api/alerts/trigger
//
// Auth: must be signed-in. Re-evaluates ONLY this user's active alerts
// against live Discogs prices and fires push/email for any that hit
// the threshold. Same logic as /api/cron/prices (alerts phase) but
// scoped to one user and reachable without CRON_SECRET — so the user
// can verify their alert flow without waiting for the daily cron.
//
// Use case: the daily cron at 09:00 UTC means newly-created alerts
// can take up to 24h to fire even if they'd trigger immediately.
// This endpoint lets the user say "check my alerts NOW".
//
// Cooldown: 5 min per user via in-memory token bucket — calling this
// in a tight loop would exhaust Discogs rate limit.

import { NextResponse } from 'next/server';
import { createClient, supabaseAdmin } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';

const PACING_MS = 600;
const cooldown = new Map();   // userId → ms timestamp of last allowed call
const COOLDOWN_MS = 5 * 60 * 1000;

function discogsAuth() {
  const k = process.env.DISCOGS_KEY, s = process.env.DISCOGS_SECRET, t = process.env.DISCOGS_TOKEN;
  if (k && s) return 'Discogs key=' + k + ', secret=' + s;
  if (t)      return 'Discogs token=' + t;
  return null;
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
    method:  'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer '+key },
    body:    JSON.stringify({
      from: process.env.FROM_EMAIL || 'Metal Vault <onboarding@resend.dev>',
      to, subject, html,
    }),
  });
}

export async function POST() {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const last = cooldown.get(user.id) || 0;
  const wait = (last + COOLDOWN_MS) - Date.now();
  if (wait > 0) {
    return NextResponse.json({
      error: 'Cooldown — try again in ' + Math.ceil(wait / 1000) + 's',
    }, { status: 429 });
  }
  cooldown.set(user.id, Date.now());

  const auth = discogsAuth();
  if (!auth) return NextResponse.json({ error: 'Discogs not configured' }, { status: 500 });

  // Pull alerts. Earlier code tried to embed auth_user:user_id(email)
  // for the email-send path, but PostgREST embed across schemas
  // (public → auth) requires explicit grants which weren't ever set
  // up. The select silently returned null for everyone — `data: null`
  // unchecked → empty alerts list → trigger pretended to run with
  // 0 rows. User saw `{checked:0, triggered:0, skipped_no_id:0, results:[]}`
  // even with active alerts in the DB.
  // Fixed by dropping the embed and looking the email up separately
  // via supabaseAdmin (service-role bypass) only at the moment we
  // need it.
  const { data: alerts, error: alertsErr } = await sb
    .from('price_alerts').select('*')
    .eq('user_id', user.id).eq('is_active', true);
  if (alertsErr) {
    console.error('[alerts/trigger] select failed:', alertsErr.message);
    return NextResponse.json({
      error: 'Could not load alerts: ' + alertsErr.message,
    }, { status: 500 });
  }

  // Resolve user email for email-on-trigger. Single auth.admin call
  // outside the loop. Tolerate failure — push still fires regardless.
  let userEmail = user.email || null;
  if (!userEmail) {
    try {
      const { data } = await supabaseAdmin.auth.admin.getUserById(user.id);
      userEmail = data?.user?.email || null;
    } catch {}
  }

  const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://metal-vault-six.vercel.app';
  const out = { checked: 0, triggered: 0, skipped_no_id: 0, results: [] };

  // Pre-fetch all referenced collection rows in one round-trip so we
  // can fall back to collection.discogs_id when the alert row itself
  // doesn't have one (watchlist-originated alerts often store
  // album_id as a slug, which the POST normalisation strips to NULL).
  const collectionIds = (alerts || []).map(a => a.collection_id).filter(Boolean);
  let colMap = {};
  if (collectionIds.length) {
    const { data: cols } = await sb
      .from('collection').select('id, discogs_id').in('id', collectionIds);
    for (const c of (cols || [])) colMap[c.id] = c.discogs_id;
  }

  // Resolve a usable Discogs release ID for an alert, even when the
  // alert row itself has discogs_id=null. Order:
  //   1. alert.discogs_id (already a numeric column)
  //   2. collection_id → collection.discogs_id (collection-anchored alerts)
  //   3. album_id, if it parses to a positive integer (some watchlist
  //      rows store the Discogs master/release id there as a string)
  // Returns null if none work — caller should record skipped_no_id.
  const resolveDiscogsId = (alert) => {
    if (alert.discogs_id) return alert.discogs_id;
    if (alert.collection_id && colMap[alert.collection_id]) return colMap[alert.collection_id];
    if (alert.album_id) {
      const n = Number(alert.album_id);
      if (Number.isFinite(n) && n > 0) return n;
    }
    return null;
  };

  for (const alert of (alerts || [])) {
    const did = resolveDiscogsId(alert);
    if (!did) {
      out.skipped_no_id++;
      out.results.push({ id: alert.id, status: 'no_discogs_id', album_id: alert.album_id });
      continue;
    }
    out.checked++;
    try {
      const r = await fetch(
        'https://api.discogs.com/marketplace/stats/' + did,
        { headers: { Authorization: auth, 'User-Agent': 'MetalVault/1.0' } }
      );
      if (!r.ok) {
        out.results.push({ id: alert.id, status: 'discogs_' + r.status });
        continue;
      }
      const d = await r.json();
      const lowest     = Number(d.lowest_price?.value) || null;
      const numForSale = d.num_for_sale ?? null;
      const target     = Number(alert.target_price);
      const baseline   = Number(alert.baseline_price) || null;
      const type       = alert.alert_type
        || ((alert.direction || 'below') === 'above' ? 'PRICE_RISE' : 'PRICE_DROP');

      let trigger = false, msg = '';
      if (type === 'LOW_STOCK')              { trigger = numForSale != null && numForSale <= target; msg = trigger ? 'only ' + numForSale + ' copies for sale' : ''; }
      else if (type === 'PRICE_DROP')        { trigger = lowest != null && lowest <= target;          msg = trigger ? 'is now $' + lowest.toFixed(0) : ''; }
      else if (type === 'PRICE_RISE')        { trigger = lowest != null && lowest >= target;          msg = trigger ? 'is now $' + lowest.toFixed(0) : ''; }
      else if (type === 'PERCENT_DROP' && baseline) {
        const dropPct = ((baseline - lowest) / baseline) * 100;
        trigger = dropPct >= target; msg = trigger ? 'dropped ' + dropPct.toFixed(0) + '% to $' + lowest.toFixed(0) : '';
      }
      else if (type === 'PERCENT_RISE' && baseline) {
        const risePct = ((lowest - baseline) / baseline) * 100;
        trigger = risePct >= target; msg = trigger ? 'rose ' + risePct.toFixed(0) + '% to $' + lowest.toFixed(0) : '';
      }

      if (trigger) {
        // Schema reality: price_alerts has `last_triggered`, NOT
        // `triggered_at`. Earlier code referenced two more columns
        // (`last_seen_price`, `updated_at`) that were never added.
        // Both UPDATEs were silently failing — alert stayed
        // is_active=true forever, push/email did fire on first hit
        // but every subsequent cron pass re-fired the same alert
        // because is_active never flipped.
        const { error: upErr } = await sb.from('price_alerts').update({
          last_triggered: new Date().toISOString(),
          is_active:      false,
        }).eq('id', alert.id);
        if (upErr) console.error('[alerts/trigger] update failed:', upErr.message);
        await sendPushToUser(alert.user_id, {
          title: '🎯 Price alert hit',
          body:  alert.artist + ' — ' + alert.album + ' ' + msg,
          url:   '/?tab=vault',
          tag:   'alert-' + alert.id,
        });
        if (userEmail) {
          await sendEmail(
            userEmail,
            'Price alert: ' + alert.artist + ' — ' + alert.album,
            '<h2>' + alert.artist + ' — ' + alert.album + '</h2>'
            + '<p>Now <strong>$' + lowest.toFixed(0) + '</strong> on Discogs (your target: $' + target + ')</p>'
            + '<p><a href="' + APP_URL + '/?tab=vault">Open Metal Vault →</a></p>'
          );
        }
        out.triggered++;
        out.results.push({ id: alert.id, status: 'TRIGGERED', msg });
      } else {
        // No-fire branch — there's no real column to write here in
        // the current schema (last_seen_price + updated_at don't
        // exist). Just record the result for the response payload.
        out.results.push({ id: alert.id, status: 'NO_FIRE', lowest, target });
      }
    } catch (e) {
      out.results.push({ id: alert.id, status: 'error', msg: e.message?.slice(0, 80) });
    }
    await new Promise(r => setTimeout(r, PACING_MS));
  }

  return NextResponse.json(out);
}
