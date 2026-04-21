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

    // ── Fetch Metal Archives upcoming once — shared across all users ──
    // MA has the BEST pre-order data: labels submit release dates months ahead.
    let maUpcoming = [];
    try {
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://metal-vault-six.vercel.app';
      const r = await fetch(appUrl + '/api/releases/metal-archives');
      if (r.ok) {
        const d = await r.json();
        maUpcoming = d.items || [];
      }
    } catch (e) { console.warn('MA fetch failed:', e.message); }

    for (const [userId, userData] of Object.entries(byUser)) {
      try {
        const newReleases = [];

        // ── Match MA upcoming against user's followed artists ──
        // Use fuzzy match (case-insensitive includes) — Discogs names often have "(2)" suffix
        const userArtistsLower = userData.artists.map(a => a.toLowerCase().replace(/\s*\(\d+\)$/, '').trim());
        for (const rel of maUpcoming) {
          const relArtistLower = (rel.artist || '').toLowerCase();
          if (!userArtistsLower.some(a => relArtistLower === a || relArtistLower.includes(a) || a.includes(relArtistLower))) continue;
          // Only notify about items announced in last 7 days (created_at unavailable — use release date ≤ 6 months future)
          const releaseDate = rel.releaseDate;
          if (!releaseDate) continue;
          const daysUntil = (new Date(releaseDate) - new Date()) / 86400000;
          if (daysUntil < 0 || daysUntil > 180) continue; // skip past or too-far-future
          newReleases.push({
            artist: rel.artist,
            album:  rel.album,
            cover:  null,
            date:   releaseDate,
            url:    rel.albumUrl || null,
            source: 'metal_archives',
          });
          results.newReleases++;
        }

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
            subject: `🔥 Metal Vault: ${newReleases.length} nowych premier od Twoich artystów`,
            html: `
              <div style="font-family: 'Courier New', monospace; background: #0a0a0a; color: #f0f0f0; padding: 28px 24px; max-width: 520px; margin: 0 auto;">
                <div style="border-bottom: 2px solid #dc2626; padding-bottom: 16px; margin-bottom: 20px;">
                  <div style="font-size: 32px; font-weight: bold; letter-spacing: 0.06em; color: #f0f0f0; line-height: 1;">METAL VAULT</div>
                  <div style="font-size: 10px; color: #dc2626; letter-spacing: 0.25em; text-transform: uppercase; margin-top: 4px;">TYGODNIOWE PREMIERY</div>
                </div>
                <div style="font-size: 13px; color: #888; margin-bottom: 20px;">
                  Ten tydzień: <span style="color: #f5c842; font-weight: bold;">${newReleases.length} nowe wydanie${newReleases.length > 1 ? 'a' : ''}</span> od śledzonych przez Ciebie artystów.
                </div>
                <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
                  ${albumRows}
                </table>
                <a href="${process.env.NEXT_PUBLIC_APP_URL || 'https://metal-vault-six.vercel.app'}/?tab=feed"
                   style="display: block; background: #dc2626; color: #fff; text-decoration: none; text-align: center; padding: 14px; border-radius: 8px; font-size: 14px; font-weight: bold; letter-spacing: 0.08em; margin-bottom: 20px;">
                  🔥 OTWÓRZ FEED →
                </a>
                <div style="font-size: 10px; color: #333; text-align: center; line-height: 1.6;">
                  Metal Vault · <a href="${process.env.NEXT_PUBLIC_APP_URL || 'https://metal-vault-six.vercel.app'}/api/unsubscribe" style="color: #555;">Wypisz się</a>
                </div>
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
