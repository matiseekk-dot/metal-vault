export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabase-server';

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

// Send push to all subscriptions for a user
export async function notifyUser(userId, payload) {
  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) return;
  const sb = getAdminClient();
  const { data: subs } = await sb
    .from('push_subscriptions').select('*').eq('user_id', userId);
  if (!subs?.length) return;

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
}

// Manual test endpoint
export async function POST(request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  await notifyUser(user.id, {
    title: '🤘 Metal Vault',
    body: 'Push notifications are working!',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    url: '/',
  });

  return NextResponse.json({ success: true });
}
