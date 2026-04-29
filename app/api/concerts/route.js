// ── Bandsintown concerts API ──────────────────────────────────
// Fetches upcoming events for the user's followed artists, filtered by
// optional location radius. Cached 24h per artist (concerts don't change
// minute-by-minute and we want to be gentle with the free API).
//
// Query params:
//   ?lat=50.27&lng=19.02&radius_km=300   — optional location filter
//   ?artist=Gojira                        — single-artist mode (no auth)
//
// Auth: when artist NOT specified, requires logged-in user (uses their
// followed_artists). When artist IS specified, public lookup.

export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { createClient, getAdminClient } from '@/lib/supabase-server';

const BANDSINTOWN = 'https://rest.bandsintown.com/artists';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;  // 24h

// Haversine distance in km — for radius filtering on Bandsintown response
function distanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat/2)**2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon/2)**2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Lookup a single artist on Bandsintown with cache layer
async function fetchArtistEvents(artistName, sb) {
  const appId = process.env.BANDSINTOWN_APP_ID;
  if (!appId) return { events: [], skipped: 'no_app_id' };

  const cacheKey = 'bit::' + artistName.toLowerCase().replace(/\s+/g, '_');

  // Try cache
  try {
    const { data } = await sb
      .from('discogs_cache')  // reuse existing cache table
      .select('data, created_at')
      .eq('cache_key', cacheKey)
      .single();
    if (data?.data && data.created_at) {
      const age = Date.now() - new Date(data.created_at).getTime();
      if (age < CACHE_TTL_MS) {
        return { events: data.data.events || [], cached: true };
      }
    }
  } catch {}

  // Live lookup
  try {
    // Bandsintown encodes artist names as URL path component — / and ? must be encoded
    const safeArtist = encodeURIComponent(artistName).replace(/!/g, '%21');
    const url = BANDSINTOWN + '/' + safeArtist + '/events?app_id=' + appId;
    const r = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!r.ok) {
      // Bandsintown returns 200 with empty array even for no-artist; 404 means real error
      return { events: [], error: 'http_' + r.status };
    }

    const raw = await r.json();
    // Bandsintown returns array directly. Map to our schema.
    const events = (Array.isArray(raw) ? raw : []).map(e => ({
      id:           e.id,
      datetime:     e.datetime,
      venue:        e.venue?.name || 'Unknown venue',
      city:         e.venue?.city || '',
      region:       e.venue?.region || '',
      country:      e.venue?.country || '',
      lat:          e.venue?.latitude  ? Number(e.venue.latitude)  : null,
      lng:          e.venue?.longitude ? Number(e.venue.longitude) : null,
      lineup:       Array.isArray(e.lineup) ? e.lineup : [],
      ticketsUrl:   e.offers?.find(o => o.type === 'Tickets')?.url || e.url,
      onSale:       e.offers?.find(o => o.type === 'Tickets')?.status === 'available',
    })).filter(ev => ev.datetime);

    // Cache (even empty result, to throttle repeat lookups)
    await sb.from('discogs_cache').upsert(
      { cache_key: cacheKey, data: { events }, created_at: new Date().toISOString() },
      { onConflict: 'cache_key' }
    );

    return { events };
  } catch (e) {
    return { events: [], error: e.message };
  }
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const singleArtist = (searchParams.get('artist') || '').trim();
  const lat = searchParams.get('lat')  ? Number(searchParams.get('lat'))  : null;
  const lng = searchParams.get('lng')  ? Number(searchParams.get('lng'))  : null;
  const radiusKm = searchParams.get('radius_km')
    ? Number(searchParams.get('radius_km')) : null;

  const sb = getAdminClient();

  // Single-artist public mode — used by VinylModal "Upcoming concerts" section
  if (singleArtist) {
    const result = await fetchArtistEvents(singleArtist, sb);
    return NextResponse.json({ artist: singleArtist, ...result });
  }

  // Multi-artist mode — uses logged-in user's followed_artists
  const userClient = await createClient();
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: followed } = await sb
    .from('artist_follows').select('artist_name').eq('user_id', user.id);

  if (!followed || followed.length === 0) {
    return NextResponse.json({ events: [], message: 'No followed artists' });
  }

  // Limit to 30 artists per request (Bandsintown is free but be polite + fast)
  const artists = followed.slice(0, 30).map(f => f.artist_name).filter(Boolean);

  // Parallel lookups (up to 6 at a time to avoid overload)
  const allEvents = [];
  for (let i = 0; i < artists.length; i += 6) {
    const batch = artists.slice(i, i + 6);
    const results = await Promise.all(batch.map(a => fetchArtistEvents(a, sb)));
    for (let j = 0; j < results.length; j++) {
      const r = results[j];
      const artistName = batch[j];
      for (const ev of r.events || []) {
        allEvents.push({ ...ev, artist: artistName });
      }
    }
  }

  // Optional location filter
  let filtered = allEvents;
  if (lat != null && lng != null && radiusKm != null) {
    filtered = allEvents.filter(ev => {
      if (ev.lat == null || ev.lng == null) return false;
      return distanceKm(lat, lng, ev.lat, ev.lng) <= radiusKm;
    });
  }

  // Sort by date ascending
  filtered.sort((a, b) => new Date(a.datetime) - new Date(b.datetime));

  return NextResponse.json({
    events:        filtered,
    total:         filtered.length,
    artistsTotal:  artists.length,
    locationApplied: lat != null && lng != null,
  });
}
