export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabase-server';

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

// Called daily at 09:00 UTC by Vercel Cron
export async function GET(request) {
  const auth = request.headers.get('authorization');
  if (auth !== 'Bearer '+process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const sb = getAdminClient();
  const discogsAuth = authHeader();
  if (!discogsAuth) return NextResponse.json({ error: 'Discogs not configured' });

  const results = { collectionUpdated: 0, alertsTriggered: 0, errors: [] };

  // ── 1. Refresh all collection prices ─────────────────────────
  const { data: items } = await sb
    .from('collection')
    .select('id, discogs_id, artist, album, user_id')
    .not('discogs_id', 'is', null)
    .or('last_price_check.is.null,last_price_check.lt.'+new Date(Date.now()-23*60*60*1000).toISOString());

  for (const item of (items || [])) {
    try {
      const r = await fetch(
        'https://api.discogs.com/marketplace/stats/'+item.discogs_id,
        { headers: { Authorization: discogsAuth, 'User-Agent': 'MetalVault/1.0' } }
      );
      if (!r.ok) continue;
      const d = await r.json();
      const lowest = d.lowest_price?.value  || null;
      const median  = d.median?.value        || null;
      await sb.from('collection').update({
        current_price:    lowest,
        median_price:     median,
        last_price_check: new Date().toISOString(),
      }).eq('id', item.id);
      // Save price history snapshot (deduped by date)
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
    await new Promise(r => setTimeout(r, 600)); // Discogs rate limit ~100/min max
  }

  // ── 2. Check price alerts (collection) ───────────────────────
  const { data: alerts } = await sb
    .from('price_alerts')
    .select('*, auth_user:user_id(email)')
    .eq('is_active', true);

  for (const alert of (alerts || [])) {
    try {
      const r = await fetch(
        'https://api.discogs.com/marketplace/stats/'+alert.discogs_id,
        { headers: { Authorization: discogsAuth, 'User-Agent': 'MetalVault/1.0' } }
      );
      if (!r.ok) continue;
      const d = await r.json();
      const price = d.lowest_price?.value;
      if (!price || price > alert.target_price) continue;

      // Don't re-trigger within 7 days
      if (alert.last_triggered) {
        const days = (Date.now() - new Date(alert.last_triggered)) / (1000*60*60*24);
        if (days < 7) continue;
      }

      results.alertsTriggered++;
      const email = alert.auth_user?.email;

      // Push notification
      await sendPushToUser(alert.user_id, {
        title: '💎 Price Alert: '+alert.artist,
        body:  alert.album+' — now $'+price.toFixed(0)+' (target: $'+alert.target_price+')',
        icon:  '/icons/icon-192.png',
        badge: '/icons/icon-192.png',
        url:   'https://www.discogs.com/search/?q='+encodeURIComponent(alert.artist+' '+alert.album)+'&type=release&format=Vinyl',
      });

      // Email
      if (email) {
        await sendEmail(email, '💎 Price alert: '+alert.artist+' — '+alert.album,
          '<div style="font-family:monospace;background:#0a0a0a;color:#f0f0f0;padding:24px;border-radius:8px">'
          +'<h1 style="color:#dc2626;font-size:24px;margin:0 0 4px">METAL VAULT</h1>'
          +'<p style="color:#888;font-size:11px;margin:0 0 20px">PRICE ALERT</p>'
          +'<div style="background:#141414;border:1px solid #2a2a2a;border-left:4px solid #f5c842;border-radius:8px;padding:16px;margin-bottom:20px">'
          +'<div style="font-size:18px;color:#f0f0f0">'+(alert.artist||'')+'</div>'
          +'<div style="font-size:13px;color:#888">'+(alert.album||'')+'</div>'
          +'<div style="margin-top:12px;display:flex;gap:20px">'
          +'<div><div style="font-size:10px;color:#555;text-transform:uppercase">Current</div><div style="font-size:22px;color:#4ade80">$'+price.toFixed(0)+'</div></div>'
          +'<div><div style="font-size:10px;color:#555;text-transform:uppercase">Your target</div><div style="font-size:22px;color:#f5c842">$'+alert.target_price+'</div></div>'
          +'</div></div>'
          +'<a href="https://www.discogs.com/search/?q='+encodeURIComponent((alert.artist||'')+' '+(alert.album||''))+'&type=release&format=Vinyl" style="display:block;background:#dc2626;color:#fff;text-decoration:none;text-align:center;padding:12px;border-radius:8px">View on Discogs</a>'
          +'</div>'
        );
      }

      await sb.from('price_alerts').update({ last_triggered: new Date().toISOString() }).eq('id', alert.id);
    } catch (e) {
      results.errors.push('alert:'+alert.id+':'+e.message.slice(0,30));
    }
    await new Promise(r => setTimeout(r, 600));
  }

  // ── 3. Check wantlist price thresholds ───────────────────────
  const { data: wantAlerts } = await sb
    .from('price_alerts')
    .select('*, auth_user:user_id(email)')
    .eq('is_active', true)
    .is('collection_id', null); // wantlist alerts have no collection_id

  // (already handled in alerts loop above since discogs_id is set for both)

  // ── 4. Update portfolio snapshots for all users ──────────────
  const { data: users } = await sb.from('collection').select('user_id').eq('user_id', sb.auth);
  // Done per-user via updateSnapshot in collection route on each save

  return NextResponse.json({ ...results, itemsChecked: (items||[]).length });
}
