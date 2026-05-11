// ── Concerts integration — Last.fm only ─────────────────────────
//
// Ticketmaster removed. User feedback: TM is effectively US-centric,
// app is European-focused, and Last.fm has dramatically better metal
// scene coverage (small clubs, DIY shows, European festivals).
//
// Last.fm shut down their public events API in 2018 but the events
// PAGES at /music/{artist}/+events still render structured JSON-LD
// (schema.org/MusicEvent). We scrape that — same data Last.fm shows
// in the UI, no auth dance, no rate-limiting risk that breaks the app.
//
// Migration history kept for posterity:
//   - Bandsintown (2018-2022) — REST API closed to non-partners
//   - Ticketmaster (2022-2026) — too sparse for metal in Europe
//   - Last.fm scrape (current) — primary and only source
//
// Query params:
//   ?lat=50.27&lng=19.02&radius_km=300   — optional location filter
//   ?artist=Gojira                        — single-artist mode (no auth)

import { NextResponse } from 'next/server';
import { createClient, getAdminClient } from '@/lib/supabase-server';
import { lastfmArtistEvents } from '@/lib/lastfm';

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
// Known-working Ticketmaster regional sites. The Discovery API also
// returns URLs for region-specific TM sub-brands that have since shut
// down (ticketmaster.pl was discontinued in 2022 and now serves a
// hard 404 / mismatched redirect; possibly others). Anything not on
// this list falls back to the universal search URL on ticketmaster.com
// which always resolves.
const TM_WORKING_DOMAINS = [
  'ticketmaster.com',
  'ticketmaster.ca',
  'ticketmaster.co.uk',
  'ticketmaster.de',
  'ticketmaster.at',
  'ticketmaster.ch',
  'ticketmaster.es',
  'ticketmaster.fr',
  'ticketmaster.it',
  'ticketmaster.nl',
  'ticketmaster.be',
  'ticketmaster.ie',
  'ticketmaster.dk',
  'ticketmaster.fi',
  'ticketmaster.no',
  'ticketmaster.se',
  'ticketmaster.com.au',
  'ticketmaster.co.nz',
  'ticketmaster.com.mx',
  // Livenation is TM's sister brand for some markets where the TM
  // domain was retired (Poland → livenation.pl).
  'livenation.pl',
  'livenation.com',
];

function isWorkingTmUrl(url) {
  if (!url || !/^https?:\/\//.test(url)) return false;
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    return TM_WORKING_DOMAINS.some(d => host === d || host.endsWith('.' + d));
  } catch { return false; }
}

// ticketsUrl fallback chain — prefer the event URL only when it points
// at a known-live Ticketmaster region. Empty / dead-domain URLs fall
// through to the artist's TM page → universal search. The search URL
// at ticketmaster.com always resolves regardless of the user's country,
// landing them on a list of the artist's events they can pick from.
function buildTicketsUrl(e) {
  if (isWorkingTmUrl(e?.url)) return e.url;
  const attractions = e?._embedded?.attractions || [];
  const artistUrl = attractions.find(a => isWorkingTmUrl(a?.url))?.url;
  if (artistUrl) return artistUrl;
  // Universal search — works in every region, never 404s.
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

// Cache-write helper used by all source paths. Empty results are
// cached too — stops a band that genuinely has no gigs from hitting
// the upstream every request.
async function writeEventsCache(sb, cacheKey, events) {
  try {
    await sb.from('discogs_cache').upsert(
      { cache_key: cacheKey, data: { events }, created_at: new Date().toISOString() },
      { onConflict: 'cache_key' }
    );
  } catch {}
}

// Cached read with TTL check. Returns null when no fresh cache hit so
// callers know to fall through to upstream.
async function readEventsCache(sb, cacheKey) {
  try {
    const { data } = await sb.from('discogs_cache')
      .select('data, created_at').eq('cache_key', cacheKey).single();
    if (!data?.data || !data.created_at) return null;
    if (Date.now() - new Date(data.created_at).getTime() > CACHE_TTL_MS) return null;
    return data.data.events || [];
  } catch { return null; }
}

// Last.fm scraper path (primary). Returns mapped events ready to merge.
async function fetchLastfmEvents(artistName, sb) {
  // Cache key separate from TM so the two sources don't evict each
  // other. lfm-v1 because if the JSON-LD structure ever changes we'll
  // want a clean re-fetch path.
  const cacheKey = 'lfm-events-v1::' + artistName.toLowerCase().replace(/\s+/g, '_');
  const cached = await readEventsCache(sb, cacheKey);
  if (cached) return cached;

  let events = [];
  try {
    events = await lastfmArtistEvents(artistName, { timeoutMs: REQUEST_TIMEOUT_MS });
  } catch { events = []; }
  await writeEventsCache(sb, cacheKey, events);
  return events;
}

// Public: single-source events fetch via Last.fm scraping.
async function fetchArtistEvents(artistName, sb) {
  const events = await fetchLastfmEvents(artistName, sb);
  return { events };
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
    provider:         'lastfm',
  });
}
