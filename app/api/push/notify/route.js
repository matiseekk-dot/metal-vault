import { NextResponse } from 'next/server';
import { createClient, getAdminClient } from '@/lib/supabase-server';
import { isFcmConfigured, sendFcm } from '@/lib/fcm';


export const dynamic = 'force-dynamic';

async function sendPush(subscription, payload) {
  const webpush = (await import('web-push')).default;
  webpush.setVapidDetails(
    'mailto:' + (process.env.FROM_EMAIL || 'alerts@metal-vault.app'),
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
  return webpush.sendNotification(
    {
      endpoint: subscription.endpoint,
      keys: { p256dh: subscription.p256dh, auth: subscription.auth },
    },
    JSON.stringify(payload)
  );
}

// Web Push (VAPID) — browsers / installed PWA.
async function notifyWebPush(sb, userId, payload) {
  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) return 0;
  const { data: subs } = await sb
    .from('push_subscriptions').select('*').eq('user_id', userId);
  if (!subs?.length) return 0;

  const results = await Promise.allSettled(subs.map(s => sendPush(s, payload)));

  // Remove expired subscriptions (410 Gone)
  for (let i = 0; i < results.length; i++) {
    if (results[i].status === 'rejected') {
      const err = results[i].reason;
      if (err?.statusCode === 410 || err?.statusCode === 404) {
        await sb.from('push_subscriptions').delete().eq('id', subs[i].id);
      }
    }
  }
  return results.filter(r => r.status === 'fulfilled').length;
}

// FCM — the Capacitor Android app, where the WebView can't do Web Push.
async function notifyFcm(sb, userId, payload) {
  if (!isFcmConfigured()) return 0;
  const { data: devices } = await sb
    .from('device_tokens').select('id, token').eq('user_id', userId);
  if (!devices?.length) return 0;

  const results = await Promise.allSettled(devices.map(d => sendFcm(d.token, payload)));

  // A dead token (app uninstalled / token rotated away) stops being
  // useful forever — drop it so every future cron doesn't retry it.
  const dead = [];
  let sent = 0;
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') {
      if (r.value.ok) sent++;
      else if (r.value.invalid) dead.push(devices[i].id);
    }
  });
  if (dead.length) await sb.from('device_tokens').delete().in('id', dead);
  return sent;
}

// Send a notification to every device a user has: browser subscriptions
// and Android app installs. Delivery channels fail independently — a
// broken FCM setup must not stop web push, and vice versa. Returns
// per-channel delivered counts (used by the manual test endpoint).
export async function notifyUser(userId, payload) {
  const webConfigured = !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
  const summary = { web: 0, fcm: 0, fcmConfigured: isFcmConfigured(), webConfigured };
  if (!webConfigured && !summary.fcmConfigured) return summary;

  const sb = getAdminClient();
  const [web, fcm] = await Promise.allSettled([
    notifyWebPush(sb, userId, payload),
    notifyFcm(sb, userId, payload),
  ]);
  if (web.status === 'fulfilled') summary.web = web.value;
  if (fcm.status === 'fulfilled') summary.fcm = fcm.value;
  else console.warn('[push] FCM delivery failed:', fcm.reason?.message);
  return summary;
}

// Manual test endpoint — Profile's "send test notification" button.
export async function POST(request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const summary = await notifyUser(user.id, {
    title: '🤘 Metal Vault',
    body: 'Push notifications are working!',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    url: '/',
    tag: 'mv-test',
  });

  return NextResponse.json({ success: true, ...summary });
}
