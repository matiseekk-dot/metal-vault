// ── Daily Digest Push Cron — concerts edition ─────────────────
// Runs every morning 08:00 UTC. One combined push per user containing:
//   • Triggered price alerts (last 24h)
//   • New pre-orders from followed artists
//   • Concert proximity: shows in user's radius ≤ 14 days from today
//   • Tour announcements: events that weren't in our snapshot 24h ago
//
// Skips users with no content. Idempotent: concert_notifications dedupes
// per (user, event, kind) so users never see the same alert twice.

export const dynamic = 'force-dynamic';
const BUDGET_MS_DIGEST = 4 * 60 * 1000;
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';

const BANDSINTOWN = 'https://rest.bandsintown.com/artists';

// Haversine — same as in /api/concerts
function distanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371, toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat/2)**2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon/2)**2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

async function sendPushToUser(userId, payload) {
  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) return;
  try {
    const { notifyUser } = await import('@/app/api/push/notify/route');
    await notifyUser(userId, payload);
  } catch (e) {
    console.warn('Push failed:', e.message);
  }
}

// Fetch Bandsintown events for an artist, dedupe vs snapshot to detect announcements.
// Returns { events: [...], newAnnouncements: [...] }.
async function fetchAndDiff(artistName, sb) {
  const appId = process.env.BANDSINTOWN_APP_ID;
  if (!appId) return { events: [], newAnnouncements: [] };

  let events = [];
  try {
    const safeArtist = encodeURIComponent(artistName).replace(/!/g, '%21');
    const r = await fetch(BANDSINTOWN + '/' + safeArtist + '/events?app_id=' + appId,
      { signal: AbortSignal.timeout(5000) });
    if (!r.ok) return { events: [], newAnnouncements: [] };

    const raw = await r.json();
    events = (Array.isArray(raw) ? raw : []).map(e => ({
      id:        e.id,
      datetime:  e.datetime,
      venue:     e.venue?.name || '',
      city:      e.venue?.city || '',
      country:   e.venue?.country || '',
      lat:       e.venue?.latitude  ? Number(e.venue.latitude)  : null,
      lng:       e.venue?.longitude ? Number(e.venue.longitude) : null,
      ticketsUrl: e.offers?.find(o => o.type === 'Tickets')?.url || e.url,
    })).filter(ev => ev.id && ev.datetime);
  } catch { return { events: [], newAnnouncements: [] }; }

  // Diff vs snapshot: load existing event IDs for this artist
  const { data: snapshot } = await sb
    .from('artist_event_snapshots')
    .select('event_id')
    .eq('artist_name', artistName);

  const seenIds = new Set((snapshot || []).map(s => s.event_id));
  const newAnnouncements = events.filter(e => !seenIds.has(e.id));

  // Update snapshot — upsert all current events
  if (events.length > 0) {
    const rows = events.map(e => ({
      artist_name: artistName,
      event_id:    e.id,
      event_date:  e.datetime.split('T')[0],
      venue:       e.venue,
      city:        e.city,
      country:     e.country,
    }));
    await sb.from('artist_event_snapshots').upsert(rows, {
      onConflict: 'artist_name,event_id',
      ignoreDuplicates: false,
    });
  }

  return { events, newAnnouncements };
}

export async function GET(request) {
  const auth = request.headers.get('authorization');
  if (process.env.CRON_SECRET && auth !== 'Bearer ' + process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const sb = supabaseAdmin;
  const now = new Date();
  const yesterday = new Date(now); yesterday.setDate(yesterday.getDate() - 1);
  const fortnight = new Date(now); fortnight.setDate(fortnight.getDate() + 14);

  const results = { usersChecked: 0, pushed: 0, skipped: 0, errors: 0,
                    bandsintown: { artistsScanned: 0, announcementsTotal: 0 } };

  try {
    // Step 1: Build artist→events map for ALL followed artists (deduplicated across users)
    // This avoids hitting Bandsintown N times per artist when M users follow them.
    const { data: allFollows } = await sb
      .from('artist_follows').select('user_id, artist_name');

    const uniqueArtists = [...new Set((allFollows || []).map(f => f.artist_name).filter(Boolean))];
    const artistEventMap = new Map();      // artistName → events[]
    const artistAnnouncementMap = new Map(); // artistName → newAnnouncements[]

    // Process in batches of 6 (Bandsintown is gentle, but we don't want to spam)
    for (let i = 0; i < uniqueArtists.length; i += 6) {
      const batch = uniqueArtists.slice(i, i + 6);
      const fetched = await Promise.all(batch.map(a => fetchAndDiff(a, sb)));
      batch.forEach((a, idx) => {
        artistEventMap.set(a, fetched[idx].events);
        artistAnnouncementMap.set(a, fetched[idx].newAnnouncements);
      });
      results.bandsintown.artistsScanned += batch.length;
      results.bandsintown.announcementsTotal +=
        fetched.reduce((s, r) => s + r.newAnnouncements.length, 0);
    }

    // Step 2: For each user with push subscription, build their personalized digest
    const { data: subs } = await sb
      .from('push_subscriptions').select('user_id').order('user_id');
    const userIds = [...new Set((subs || []).map(s => s.user_id))];

    for (const userId of userIds) {
      if (budgetExpired()) {
        results.skippedBudget = (results.skippedBudget || 0) + 1;
        continue;
      }
      results.usersChecked++;
      try {
        const items = [];

        // 2a) Triggered alerts (last 24h)
        const { data: alerts } = await sb
          .from('price_alerts')
          .select('id')
          .eq('user_id', userId)
          .not('triggered_at', 'is', null)
          .gte('triggered_at', yesterday.toISOString());

        if (alerts && alerts.length > 0) {
          items.push({
            text: alerts.length + ' price alert' + (alerts.length > 1 ? 's' : '') + ' triggered',
          });
        }

        // 2b) User's followed artists + profile location
        const { data: userFollows } = await sb
          .from('artist_follows').select('artist_name').eq('user_id', userId);
        const userArtists = (userFollows || []).map(f => f.artist_name).filter(Boolean);

        const { data: profile } = await sb
          .from('profiles').select('location_lat, location_lng, location_radius_km').eq('id', userId).single();

        const hasLocation = profile?.location_lat != null && profile?.location_lng != null;
        const radiusKm    = profile?.location_radius_km || 300;

        // 2c) Concert proximity — events ≤14d from today, within radius
        const proximityEvents = [];
        for (const artist of userArtists) {
          const events = artistEventMap.get(artist) || [];
          for (const ev of events) {
            const eventDate = new Date(ev.datetime);
            if (isNaN(eventDate)) continue;
            if (eventDate < now || eventDate > fortnight) continue;
            // If user has location, filter by radius
            if (hasLocation && ev.lat != null && ev.lng != null) {
              const km = distanceKm(profile.location_lat, profile.location_lng, ev.lat, ev.lng);
              if (km > radiusKm) continue;
            }
            proximityEvents.push({ ...ev, artist });
          }
        }

        // Dedupe — skip events we already notified about
        let unseenProximity = proximityEvents;
        if (proximityEvents.length > 0) {
          const eventIds = proximityEvents.map(e => e.id);
          const { data: notified } = await sb
            .from('concert_notifications')
            .select('event_id')
            .eq('user_id', userId)
            .eq('kind', 'proximity')
            .in('event_id', eventIds);
          const notifiedIds = new Set((notified || []).map(n => n.event_id));
          unseenProximity = proximityEvents.filter(e => !notifiedIds.has(e.id));
        }

        if (unseenProximity.length > 0) {
          const ev = unseenProximity[0];
          const daysUntil = Math.ceil((new Date(ev.datetime) - now) / 86400000);
          items.push({
            text: ev.artist + ' plays ' + (ev.city || ev.venue) + ' in ' + daysUntil + 'd',
            type: 'proximity',
            event: ev,
          });
        }

        // 2d) Tour announcements — new events not in snapshot (last 24h)
        const announcements = [];
        for (const artist of userArtists) {
          const newOnes = artistAnnouncementMap.get(artist) || [];
          if (newOnes.length > 0) {
            announcements.push({ artist, count: newOnes.length, sample: newOnes[0] });
          }
        }

        // Dedupe announcements (rare edge case — if cron fails mid-run and re-runs)
        let unseenAnnouncements = announcements;
        if (announcements.length > 0) {
          const evIds = announcements.map(a => a.sample.id);
          const { data: notified } = await sb
            .from('concert_notifications')
            .select('event_id')
            .eq('user_id', userId)
            .eq('kind', 'announcement')
            .in('event_id', evIds);
          const notifiedIds = new Set((notified || []).map(n => n.event_id));
          unseenAnnouncements = announcements.filter(a => !notifiedIds.has(a.sample.id));
        }

        if (unseenAnnouncements.length > 0) {
          const a = unseenAnnouncements[0];
          items.push({
            text: a.artist + ' announced ' + a.count + ' new tour date' + (a.count > 1 ? 's' : ''),
            type: 'announcement',
            artist: a.artist,
          });
        }

        // 2e) Skip if nothing to push
        if (items.length === 0) { results.skipped++; continue; }

        // 2f) Build push payload
        const proximityItem = items.find(i => i.type === 'proximity');
        const announcementItem = items.find(i => i.type === 'announcement');

        let title, url;
        if (proximityItem) {
          title = '🎸 ' + proximityItem.text;
          url = '/?tab=calendar';
        } else if (announcementItem) {
          title = '📢 ' + announcementItem.text;
          url = '/?tab=calendar';
        } else if (items.length === 1) {
          title = '🔥 ' + items[0].text;
          url = '/?tab=feed';
        } else {
          title = '🤘 Metal Vault — ' + items.length + ' updates';
          url = '/?tab=feed';
        }

        const body = items.map(i => i.text).slice(0, 3).join(' · ').substring(0, 140);

        await sendPushToUser(userId, {
          title,
          body,
          icon:  '/icons/icon-192.png',
          badge: '/icons/icon-192.png',
          url,
          tag:   'daily-digest-' + now.toISOString().split('T')[0],
        });

        // 2g) Mark concert notifications as sent (dedup)
        const notifRows = [];
        for (const ev of unseenProximity) {
          notifRows.push({ user_id: userId, event_id: ev.id, kind: 'proximity' });
        }
        for (const a of unseenAnnouncements) {
          notifRows.push({ user_id: userId, event_id: a.sample.id, kind: 'announcement' });
        }
        if (notifRows.length > 0) {
          await sb.from('concert_notifications').upsert(notifRows, {
            onConflict: 'user_id,event_id,kind',
            ignoreDuplicates: true,
          });
        }

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
