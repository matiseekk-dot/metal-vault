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

// Vercel default for /api routes is 10s Hobby / 60s Pro — Last.fm
// page scraping is slower per artist than the old TM JSON API was
// (HTML body + JSON-LD parse vs a thin REST response). 30 followed
// artists at 3s each in batches of 10 = ~9s, comfortably under 60s.
export const maxDuration = 60;

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

// Last.fm scraper path. Returns mapped events ready to render.
// Per-artist timeout deliberately tight (3s) because we may fan out
// to dozens of artists in parallel and one slow page mustn't drag
// the whole multi-artist GET past its budget.
async function fetchLastfmEvents(artistName, sb) {
  // v2 — bumped after the artist-page parser was added. v1 cached
  // empty arrays for every artist (the old parser missed the new
  // markup) and would have served stale empties for 24h post-fix.
  const cacheKey = 'lfm-events-v2::' + artistName.toLowerCase().replace(/\s+/g, '_');
  const cached = await readEventsCache(sb, cacheKey);
  if (cached) return cached;

  let events = [];
  try {
    events = await lastfmArtistEvents(artistName, { timeoutMs: 3000 });
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

  // 30-artist cap — covers the vast majority of users (most follow
  // <20 metal bands). For Last.fm scraping the per-request cost is
  // CPU + outbound HTTP, not a paid quota, so we can be more
  // generous with parallelism than the old TM-rate-limited path.
  const artists = followed.slice(0, 30).map(f => f.artist_name).filter(Boolean);

  // Bumped batch 4 → 10 with the TM switch behind us. Last.fm
  // doesn't have a 2 req/sec rate limit on scraping (it's just
  // hitting public HTML), and the per-artist call is now
  // 3s-timeout-bounded, so 3 batches of 10 = ~9s end-to-end for a
  // full 30-artist cold pull. Cache hits return instantly.
  let upstreamHits = 0;
  let resolvedArtists = 0;
  const allEvents = [];
  for (let i = 0; i < artists.length; i += 10) {
    const batch = artists.slice(i, i + 10);
    const results = await Promise.all(batch.map(a => fetchArtistEvents(a, sb)));
    for (let j = 0; j < results.length; j++) {
      const r = results[j];
      const artistName = batch[j];
      if ((r.events || []).length > 0) resolvedArtists++;
      upstreamHits += (r.events || []).length;
      for (const ev of r.events || []) {
        allEvents.push({ ...ev, artist: artistName });
      }
    }
    // Tiny gap between batches — courtesy spacing, not enforced.
    if (i + 10 < artists.length) await new Promise(r => setTimeout(r, 50));
  }

  // Optional location filter — two-tier strategy.
  //
  // Tier 1 (precise): events WITH coords get a proper distance check.
  //   Used by the legacy TM cache entries that had lat/lng.
  // Tier 2 (coarse, default for Last.fm): event has city + country but
  //   no coords. We approximate "near the user" by inferring the
  //   user's CONTINENT from their lat/lng via hardcoded bboxes, then
  //   keeping only events whose country falls into the same continent.
  //   This drops US-only events for a Polish user without erasing every
  //   coord-less LFM scrape (which was the previous over-correction).
  //
  // Continent buckets keep the list short and forgiving — no need for
  // a full reverse-geocode service when "show me Europe vs USA vs the
  // rest" is the actual user intent.
  const CONTINENT = {
    EU: { latMin: 35, latMax: 72, lngMin: -15, lngMax: 45,
          countries: new Set(['PL','DE','CZ','SK','HU','AT','CH','GB','UK','IE','FR','ES','PT','IT','NL','BE','LU','DK','SE','NO','FI','EE','LV','LT','BG','RO','GR','HR','SI','RS','BA','MK','AL','UA','BY','RU','TR','IS','MT','CY','MC','LI','SM','VA','AD','MD']) },
    NA: { latMin: 14, latMax: 72, lngMin: -170, lngMax: -50,
          countries: new Set(['US','USA','CA','MX']) },
    SA: { latMin: -60, latMax: 14, lngMin: -82, lngMax: -34,
          countries: new Set(['BR','AR','CL','CO','PE','VE','UY','PY','BO','EC']) },
    AS: { latMin: 5, latMax: 55, lngMin: 45, lngMax: 180,
          countries: new Set(['JP','KR','CN','TW','HK','SG','TH','MY','ID','PH','VN','IN','IL','AE','SA']) },
    OC: { latMin: -50, latMax: -5, lngMin: 110, lngMax: 180,
          countries: new Set(['AU','NZ']) },
  };
  function inferContinent(la, lo) {
    for (const [code, b] of Object.entries(CONTINENT)) {
      if (la >= b.latMin && la <= b.latMax && lo >= b.lngMin && lo <= b.lngMax) {
        return { code, countries: b.countries };
      }
    }
    return null;
  }

  let filtered = allEvents;
  if (lat != null && lng != null && radiusKm != null) {
    const cont = inferContinent(lat, lng);
    // Continent fallback is only safe for continent-scale searches.
    // QA caught the bug: 100 km from Katowice was returning Sweden
    // events because they came from the Last.fm scraper without
    // coords, and the continent check waved them through as 'still
    // in EU'. For tighter radii we REQUIRE precise coords — better
    // to hide unknown-location events than show Stockholm when the
    // user asked for 100 km around Katowice. Threshold matches the
    // largest radius chip surfaced in UI (~2000 km would be 'EU-wide').
    const CONTINENT_FALLBACK_MIN_RADIUS_KM = 2000;
    filtered = allEvents.filter(ev => {
      if (ev.lat != null && ev.lng != null) {
        // Precise — distance check.
        return distanceKm(lat, lng, ev.lat, ev.lng) <= radiusKm;
      }
      // No coords. Only let through for continent-scale searches.
      if (radiusKm < CONTINENT_FALLBACK_MIN_RADIUS_KM) return false;
      // No continent inferred (poles, ocean) → keep everything.
      if (!cont) return true;
      const c = String(ev.country || '').toUpperCase();
      if (!c) return true;   // unknown country → safer to show
      return cont.countries.has(c);
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
    // Diagnostic counters — if total=0 but resolvedArtists=0 too, the
    // scraper is failing for every artist (likely Last.fm changed
    // their JSON-LD structure or rate-limiting us). If resolvedArtists
    // > 0 but total=0, it's a location-filter problem.
    resolvedArtists,
    rawEvents:        upstreamHits,
    locationApplied:  lat != null && lng != null,
    provider:         'lastfm',
  });
}
