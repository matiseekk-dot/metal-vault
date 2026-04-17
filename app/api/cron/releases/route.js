export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';

// Send push notification to all user's devices
async function sendPushToUser(userId, payload) {
  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) return;
  try {
    const { notifyUser } = await import('@/app/api/push/notify/route');
    await notifyUser(userId, payload);
  } catch {}
}

// Send email via Resend REST API — no SDK constructor, build-safe
async function sendEmail({ to, subject, html }) {
  const key = process.env.RESEND_API_KEY;
  if (!key) return;
  const from = process.env.FROM_EMAIL || 'Metal Vault <onboarding@resend.dev>';
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({ from, to, subject, html }),
  });
}



// Called weekly on Monday 10:00 UTC by Vercel Cron
export async function GET(request) {
  const auth = request.headers.get('authorization');
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const results = { usersNotified: 0, newReleases: 0, errors: [] };

  try {
    // Get all users with followed artists
    const { data: follows } = await supabaseAdmin
      .from('artist_follows')
      .select('user_id, artist_name, artist_spotify_id, auth_user:user_id(email)');

    if (!follows || follows.length === 0) {
      return NextResponse.json({ ...results, message: 'No follows' });
    }

    // Group by user
    const byUser = {};
    for (const f of follows) {
      if (!byUser[f.user_id]) byUser[f.user_id] = { email: f.auth_user?.email, artists: [] };
      byUser[f.user_id].artists.push(f.artist_name);
    }

    // Get Spotify token
    let spotifyToken = null;
    try {
      const tokenRes = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: 'Basic ' + Buffer.from(
            `${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`
          ).toString('base64'),
        },
        body: 'grant_type=client_credentials',
      });
      const tokenData = await tokenRes.json();
      spotifyToken = tokenData.access_token;
    } catch (e) {
      results.errors.push({ step: 'spotify_token', error: e.message });
    }

    // Check for new releases (last 7 days) per artist
    const since = new Date();
    since.setDate(since.getDate() - 7);
    const sinceStr = since.toISOString().split('T')[0];

    for (const [userId, userData] of Object.entries(byUser)) {
      try {
        const newReleases = [];

        if (spotifyToken) {
          for (const artistName of userData.artists) {
            const res = await fetch(
              `https://api.spotify.com/v1/search?q=artist:"${encodeURIComponent(artistName)}"&type=album&limit=5`,
              { headers: { Authorization: `Bearer ${spotifyToken}` } }
            );
            const data = await res.json();
            const albums = data.albums?.items || [];

            for (const album of albums) {
              if (album.release_date >= sinceStr) {
                newReleases.push({
                  artist: artistName,
                  album: album.name,
                  cover: album.images?.[0]?.url,
                  date: album.release_date,
                  url: album.external_urls?.spotify,
                });
                results.newReleases++;
              }
            }
            await new Promise(r => setTimeout(r, 200));
          }
        }

        if (newReleases.length === 0) continue;

        // Send push notification
        await sendPushToUser(userId, {
          title: `🔥 ${newReleases.length} new release${newReleases.length > 1 ? 's' : ''} this week`,
          body:  newReleases.slice(0, 3).map(r => `${r.artist} — ${r.album}`).join(' · '),
          icon:  newReleases[0]?.cover || '/icons/icon-192.png',
          badge: '/icons/icon-192.png',
          url:   '/?tab=feed',
          tag:   'new-releases-' + new Date().toISOString().split('T')[0],
        });

        // Send email digest
        if (userData.email && process.env.RESEND_API_KEY) {
          const albumRows = newReleases.map(r => `
            <tr>
              <td style="padding: 10px 0; border-bottom: 1px solid #2a2a2a;">
                <div style="font-size: 14px; color: #f0f0f0;">${r.artist}</div>
                <div style="font-size: 12px; color: #888;">${r.album}</div>
                <div style="font-size: 10px; color: #555; margin-top: 2px;">📅 ${r.date}</div>
              </td>
              <td style="padding: 10px 0; border-bottom: 1px solid #2a2a2a; text-align: right; vertical-align: top;">
                ${r.url ? `<a href="${r.url}" style="color: #1db954; font-size: 11px; text-decoration: none;">▶ Spotify</a>` : ''}
              </td>
            </tr>
          `).join('');

          await sendEmail({
                  to: userData.email,
            subject: `🔥 ${newReleases.length} nowych premier w tym tygodniu`,
            html: `
              <div style="font-family: monospace; background: #0a0a0a; color: #f0f0f0; padding: 24px; border-radius: 8px; max-width: 500px;">
                <h1 style="color: #dc2626; font-size: 28px; margin: 0 0 4px;">METAL VAULT</h1>
                <p style="color: #888; font-size: 11px; letter-spacing: 0.2em; margin: 0 0 24px;">TYGODNIOWE PREMIERY</p>
                <table style="width: 100%; border-collapse: collapse;">
                  ${albumRows}
                </table>
                <p style="color: #444; font-size: 10px; margin-top: 20px; text-align: center;">
                  Metal Vault · Weekly digest of new releases from followed artists
                </p>
              </div>
            `,
          });
          results.usersNotified++;
        }
      } catch (e) {
        results.errors.push({ userId, error: e.message });
      }
    }
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }

  return NextResponse.json(results);
}
