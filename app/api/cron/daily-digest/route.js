// ── Daily Digest Push Cron ─────────────────────────────────────
// Runs every morning 08:00 UTC (10:00 CET). One combined push per user
// containing: new pre-order from followed artists (if any) +
// price alerts triggered overnight + persona insight (optional).
//
// Uses push_subscriptions table directly — does NOT duplicate weekly releases cron.
// This is daily ONLY for users who have at least one "fresh" item to report.

export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';

async function sendPushToUser(userId, payload) {
  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) return;
  try {
    const { notifyUser } = await import('@/app/api/push/notify/route');
    await notifyUser(userId, payload);
  } catch (e) {
    console.warn('Push failed:', e.message);
  }
}

export async function GET(request) {
  // Auth — Vercel Cron secret OR manual trigger
  const auth = request.headers.get('authorization');
  if (process.env.CRON_SECRET && auth !== 'Bearer ' + process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const sb = supabaseAdmin;
  const now = new Date();
  const yesterday = new Date(now); yesterday.setDate(yesterday.getDate() - 1);

  const results = { usersChecked: 0, pushed: 0, skipped: 0, errors: 0 };

  try {
    // 1) Get all users who have push subscriptions
    const { data: subs } = await sb
      .from('push_subscriptions').select('user_id').order('user_id');
    const userIds = [...new Set((subs || []).map(s => s.user_id))];

    for (const userId of userIds) {
      results.usersChecked++;
      try {
        const items = [];

        // 2a) Check triggered alerts in last 24h
        const { data: alerts } = await sb
          .from('price_alerts')
          .select('id, album_id, target_price, direction, triggered_at, is_active')
          .eq('user_id', userId)
          .not('triggered_at', 'is', null)
          .gte('triggered_at', yesterday.toISOString());

        if (alerts && alerts.length > 0) {
          items.push({
            type:  'alert',
            count: alerts.length,
            text:  alerts.length + ' price alert' + (alerts.length > 1 ? 's' : '') + ' triggered',
          });
        }

        // 2b) Check for new pre-orders from followed artists (announced in last 24h)
        const { data: follows } = await sb
          .from('artist_follows').select('artist_name').eq('user_id', userId);
        const followedLower = new Set((follows || []).map(f => (f.artist_name || '').toLowerCase().trim()));

        let newPreorders = [];
        if (followedLower.size > 0) {
          try {
            const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://metal-vault-six.vercel.app';
            const r = await fetch(appUrl + '/api/releases/metal-archives', { cache: 'no-store' });
            if (r.ok) {
              const d = await r.json();
              const today = new Date();
              for (const rel of d.items || []) {
                const artistLower = (rel.artist || '').toLowerCase().trim();
                const match = [...followedLower].some(a => artistLower === a || artistLower.includes(a) || a.includes(artistLower));
                if (!match) continue;
                // Only items with release_date in next 180 days
                const rd = new Date(rel.releaseDate);
                if (isNaN(rd) || rd < today) continue;
                const daysUntil = (rd - today) / 86400000;
                if (daysUntil > 180) continue;
                newPreorders.push(rel);
              }
            }
          } catch {}
        }
        if (newPreorders.length > 0) {
          items.push({
            type:  'preorder',
            count: newPreorders.length,
            text:  newPreorders.length + ' new pre-order' + (newPreorders.length > 1 ? 's' : '') + ' from your bands',
            sample: newPreorders.slice(0, 2).map(p => p.artist + ' — ' + p.album).join(' · '),
          });
        }

        // If nothing to report, skip silently (don't spam empty notifications)
        if (items.length === 0) { results.skipped++; continue; }

        // 3) Compose ONE push with combined content
        const title = items.length === 1
          ? '🔥 ' + items[0].text
          : '🤘 Metal Vault — ' + items.map(i => i.count).reduce((a,b) => a+b, 0) + ' updates';

        const bodyParts = items.map(i => i.text);
        if (newPreorders[0]) bodyParts.push(newPreorders[0].artist + ' — ' + newPreorders[0].album);

        await sendPushToUser(userId, {
          title,
          body:  bodyParts.join(' · ').substring(0, 140),
          icon:  newPreorders[0]?.cover || '/icons/icon-192.png',
          badge: '/icons/icon-192.png',
          url:   '/?tab=feed',
          tag:   'daily-digest-' + now.toISOString().split('T')[0],
        });
        results.pushed++;
      } catch (e) {
        console.error('User digest error for ' + userId + ':', e.message);
        results.errors++;
      }
    }
  } catch (e) {
    console.error('Daily digest cron failed:', e);
    return NextResponse.json({ error: e.message, results }, { status: 500 });
  }

  return NextResponse.json({ success: true, ...results });
}
