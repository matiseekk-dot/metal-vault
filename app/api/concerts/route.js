// ── Ticketmaster Discovery API — concerts integration ────────────
// Fetches upcoming events for the user's followed artists from
// Ticketmaster's public Discovery API (free tier: 5000 req/day, 2/s).
// Cached 24h per artist (concerts don't change minute-by-minute).
//
// Migration notes (from Bandsintown):
//   - Bandsintown stopped accepting unauthorized app_id strings (returns 403).
//   - Ticketmaster requires API key (free signup at developer.ticketmaster.com).
//   - Output schema preserved 1:1 with Bandsintown — UI components unchanged.
//
// Query params:
//   ?lat=50.27&lng=19.02&radius_km=300   — optional location filter
//   ?artist=Gojira                        — single-artist mode (no auth)
//
// Auth: when artist NOT specified, requires logged-in user (uses their
// followed_artists). When artist IS specified, public lookup.

import { NextResponse } from 'next/server';
import { createClient, getAdminClient } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';

const TICKETMASTER_BASE = 'https://app.ticketmaster.com/discovery/v2';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;  // 24h
const REQUEST_TIMEOUT_MS = 6000;

// Haversine distance in km — for radius filtering on response (Ticketmaster
// has its own location filter via lat/long but we keep client-side filtering
// to handle the case where TM returns events outside requested radius).
function distanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat/2)**2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon/2)**2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Map Ticketmaster event JSON → our internal schema (compatible with
// existing UpcomingConcertsTab.js, no UI changes needed).
//
// ticketsUrl fallback chain — `e.url` is preferred but the Discovery
// API occasionally returns it empty for events imported via partner
// feeds (festivals, regional promoters), and even when present the
// URL sometimes 404s for users in a different country than the event.
// Walk down: event URL → artist's Ticketmaster page → public search.
// Never returns empty (last resort = global TM search by artist name).
function buildTicketsUrl(e) {
  if (e?.url && /^https?:\/\//.test(e.url)) return e.url;
  const attractions = e?._embedded?.attractions || [];
  const artistUrl = attractions.find(a => a?.url && /^https?:\/\//.test(a.url))?.url;
  if (artistUrl) return artistUrl;
  // Public search keyed on the headline attraction name (or the event
  // name as a last resort). encodeURIComponent handles diacritics.
  const keyword = attractions[0]?.name || e?.name || '';
  if (keyword) return 'https://www.ticketmaster.com/search?q=' + encodeURIComponent(keyword);
  return 'https://www.ticketmaster.com/';
}

function mapTicketmasterEvent(e) {
  const v = e._embedded?.venues?.[0] || {};
  const dates = e.dates?.start || {};

  // Ticketmaster timestamps: "2026-06-15" + "20:00:00" or full "dateTime"
  const datetime = dates.dateTime
    || (dates.localDate && dates.localTime ? `${dates.localDate}T${dates.localTime}` : null)
    || (dates.localDate ? `${dates.localDate}T20:00:00` : null);  // fallback noon→8pm

  // Lineup: Ticketmaster returns "attractions" embedded
  const lineup = (e._embedded?.attractions || [])
    .map(a => a.name)
    .filter(Boolean);

  return {
    id:          e.id,
    datetime,
    venue:       v.name || 'Unknown venue',
    city:        v.city?.name || '',
    region:      v.state?.name || v.state?.stateCode || '',
    country:     v.country?.countryCode || v.country?.name || '',
    lat:         v.location?.latitude  ? Number(v.location.latitude)  : null,
    lng:         v.location?.longitude ? Number(v.location.longitude) : null,
    lineup,
    ticketsUrl:  buildTicketsUrl(e),
    onSale:      dates.status?.code === 'onsale',
  };
}

// Lookup events for a single artist via Ticketmaster Discovery API
async function fetchArtistEvents(artistName, sb) {
  const apiKey = process.env.TICKETMASTER_API_KEY;
  if (!apiKey) return { events: [], skipped: 'no_api_key' };

  // Cache key — bumped to v3 to invalidate stale entries with empty
  // ticketsUrl from before buildTicketsUrl fallback chain landed.
  const cacheKey = 'tm-v3::' + artistName.toLowerCase().replace(/\s+/g, '_');

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

  // Live lookup — Ticketmaster Discovery API
  // We use 'keyword' search rather than 'attractionId' lookup because:
  //   1. We don't store TM attraction IDs (would require extra mapping step)
  //   2. Keyword search handles fuzzy matching ("In Flames" vs "InFlames")
  // Filtered to classificationName=Music to avoid sports/theatre noise.
  try {
    const params = new URLSearchParams({
      apikey:             apiKey,
      keyword:            artistName,
      classificationName: 'Music',
      size:               '20',          // max 20 events per artist
      sort:               'date,asc',
    });

    const url = TICKETMASTER_BASE + '/events.json?' + params.toString();
    const r = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });

    if (!r.ok) {
      // 429 = rate limit; 401 = bad key; 404 = no results (treated as empty)
      if (r.status === 429) return { events: [], error: 'rate_limited' };
      if (r.status === 401) return { events: [], error: 'invalid_api_key' };
      return { events: [], error: 'http_' + r.status };
    }

    const raw = await r.json();
    const tmEvents = raw._embedded?.events || [];

    // Map + filter — exclude events without datetime (rare but happens)
    const events = tmEvents
      .map(mapTicketmasterEvent)
      .filter(ev => ev.datetime);

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

  // Limit to 30 artists per request — Ticketmaster allows 5000/day total
  // so 30 artists × 24h cache = 720 calls/day worst case (well under limit).
  const artists = followed.slice(0, 30).map(f => f.artist_name).filter(Boolean);

  // Sequential batching with small parallelism — Ticketmaster rate limit
  // is 2 req/sec, so we use batches of 4 with 50ms gap between batches.
  const allEvents = [];
  for (let i = 0; i < artists.length; i += 4) {
    const batch = artists.slice(i, i + 4);
    const results = await Promise.all(batch.map(a => fetchArtistEvents(a, sb)));
    for (let j = 0; j < results.length; j++) {
      const r = results[j];
      const artistName = batch[j];
      for (const ev of r.events || []) {
        allEvents.push({ ...ev, artist: artistName });
      }
    }
    // Small gap between batches to respect 2 req/sec rate limit
    if (i + 4 < artists.length) await new Promise(r => setTimeout(r, 100));
  }

  // Optional location filter
  let filtered = allEvents;
  if (lat != null && lng != null && radiusKm != null) {
    filtered = allEvents.filter(ev => {
      if (ev.lat == null || ev.lng == null) return false;
      return distanceKm(lat, lng, ev.lat, ev.lng) <= radiusKm;
    });
  }

  // Deduplicate — same event can appear under multiple artists (e.g. festival)
  // We keep the first occurrence (which will be sorted by primary artist).
  const seen = new Set();
  const deduped = [];
  for (const ev of filtered) {
    if (!seen.has(ev.id)) {
      seen.add(ev.id);
      deduped.push(ev);
    }
  }

  // Sort by date ascending
  deduped.sort((a, b) => new Date(a.datetime) - new Date(b.datetime));

  return NextResponse.json({
    events:           deduped,
    total:            deduped.length,
    artistsTotal:     artists.length,
    locationApplied:  lat != null && lng != null,
    provider:         'ticketmaster',
  });
}
