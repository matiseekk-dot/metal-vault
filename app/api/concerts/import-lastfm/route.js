// ── /api/concerts/import-lastfm — backfill user_concerts from Last.fm ──
//
// For Last.fm users who marked gigs as "attended" / "going" over many
// years, this is the one-tap way to seed the personal concert journal
// without typing 200 rows by hand.
//
// Flow:
//   1. Look up the signed-in user's lastfm_tokens.username
//   2. Walk /user/{username}/events?past=1&page=N pages
//   3. For each event: insert ONE user_concerts row per performer
//      in the lineup (festivals naturally produce many rows that
//      group back together via the festival aggregator in the UI)
//   4. Skip rows that already exist (band + year + venue match)
//      so a repeat import is idempotent
//
// Returns { imported, skipped, scanned, error? }. Pagination cap +
// per-page pacing keep us off Last.fm's rate-limit radar.

import { NextResponse } from 'next/server';
import { createClient, getAdminClient } from '@/lib/supabase-server';
import { lastfmUserEventsAll } from '@/lib/lastfm';

export const dynamic = 'force-dynamic';
// Long deadline — historical archive walks ~10 year-tabs sequentially
// (one HTTP per year, then potentially multiple pages per year).
// For matiskura with 2010..2018 + Upcoming + ~1-2 pages/year = ~20
// requests at 250ms pacing + 400ms inter-year = ~9s + scrape time.
// 120s gives plenty of headroom for users with deeper archives.
export const maxDuration = 120;

// Country code → ISO-2 just for the common European countries the
// matched-venue-name lookup needs. Kept narrow because user venues
// are stored as free text — we only normalise enough to match the
// few canonical festival names that might come back in different
// language variants.
function normaliseVenueName(s) {
  return String(s || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ');
}

export async function POST() {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = getAdminClient();

  // Get the user's Last.fm username from the tokens row. If they
  // haven't connected Last.fm yet, surface a clear error.
  const { data: lfmTok } = await admin
    .from('lastfm_tokens')
    .select('username')
    .eq('user_id', user.id)
    .maybeSingle();
  const username = lfmTok?.username;
  if (!username) {
    return NextResponse.json({
      error: 'Last.fm not connected — connect it in Profile first',
    }, { status: 400 });
  }

  // Walk EVERY year tab on the user's events page + the upcoming
  // tab. lastfmUserEventsAll first detects which years they have
  // archive content for (Last.fm renders tabs only for years with
  // events) then scrapes each /events/{YYYY} archive plus /events
  // for upcoming. Past/?past=1 was a dead-end from an older UI;
  // the year tabs are the canonical archive surface.
  let rawEvents = [];
  try {
    rawEvents = await lastfmUserEventsAll(username, {
      maxPages:    60,
      maxYears:    60,
      pacingMs:    250,
      yearDelayMs: 400,
    });
  } catch (e) {
    return NextResponse.json({ error: 'Scrape failed: ' + e.message }, { status: 502 });
  }

  // Dedupe by (date prefix, venue, headline performer) so two passes
  // touching the same event under different year tabs (rare but
  // possible at year boundaries) only land one row.
  const mergeMap = new Map();
  const mergeKey = (e) => {
    const d = (e.datetime || '').slice(0, 10);
    const v = (e.venue || '').toLowerCase().trim();
    const a = (e.lineup?.[0] || '').toLowerCase().trim();
    return d + '|' + v + '|' + a;
  };
  for (const e of rawEvents) {
    const k = mergeKey(e);
    if (!mergeMap.has(k)) mergeMap.set(k, e);
  }
  const scrapedEvents = [...mergeMap.values()];

  const diag = {
    targets_scanned: rawEvents.__debug?.targets?.length || 0,
    pages_scanned:   rawEvents.__debug?.trace?.length || 0,
    raw_count:       rawEvents.length,
    merged:          scrapedEvents.length,
    last_status:     rawEvents.__debug?.lastStatus || 'unknown',
  };

  if (scrapedEvents.length === 0) {
    return NextResponse.json({ imported: 0, skipped: 0, scanned: 0, diag });
  }

  // Existing user_concerts rows — build a dedup index by (band_norm,
  // year, venue_norm) so repeat imports don't duplicate.
  const { data: existing } = await admin
    .from('user_concerts')
    .select('band, year, venue_id, client_id');
  const { data: venues } = await admin
    .from('user_venues')
    .select('client_id, name')
    .eq('user_id', user.id);
  const venueNameById = new Map((venues || []).map(v => [v.client_id, normaliseVenueName(v.name)]));
  const existingKeys = new Set();
  for (const r of (existing || [])) {
    const bandKey = String(r.band || '').toLowerCase().trim();
    const yearKey = String(r.year || '').trim();
    const venueKey = venueNameById.get(r.venue_id) || '';
    existingKeys.add(bandKey + '::' + yearKey + '::' + venueKey);
  }

  // Existing venues by normalised name → reuse rather than create
  // duplicate "Wacken Open Air" rows on every import.
  const venueByName = new Map();
  for (const v of (venues || [])) {
    venueByName.set(normaliseVenueName(v.name), v.client_id);
  }

  // Build rows + venue inserts.
  let imported = 0;
  let skipped  = 0;
  const concertRows = [];
  const newVenues   = [];

  for (const ev of scrapedEvents) {
    const venueName = ev.venue || '';
    const year      = ev.datetime ? String(new Date(ev.datetime).getFullYear()) : '';
    if (!venueName || !year) { skipped++; continue; }

    const venueNorm = normaliseVenueName(venueName);
    let venueId = venueByName.get(venueNorm);
    if (!venueId) {
      // Create a venue row keyed by a fresh uuid so future imports
      // hit the cache. We don't try to classify (Festival / Club /
      // Arena) — heuristic categorisation is unreliable; default to
      // "Other" so the user can re-tag in the UI if they want.
      venueId = crypto.randomUUID();
      newVenues.push({
        user_id: user.id,
        client_id: venueId,
        name: venueName,
        city: ev.city || '',
        cat:  'Other',
      });
      venueByName.set(venueNorm, venueId);
    }

    // One row per performer (so festivals naturally aggregate into
    // a single card in the UI via venue_id+year grouping).
    const lineup = Array.isArray(ev.lineup) && ev.lineup.length > 0
      ? ev.lineup
      : [ev.title || '<unknown>'];

    for (const band of lineup) {
      const bandStr = String(band || '').trim();
      if (!bandStr) continue;
      const dedupKey = bandStr.toLowerCase() + '::' + year + '::' + venueNorm;
      if (existingKeys.has(dedupKey)) { skipped++; continue; }
      existingKeys.add(dedupKey);
      concertRows.push({
        user_id:   user.id,
        client_id: crypto.randomUUID(),
        band:      bandStr,
        venue_id:  venueId,
        year,
        genre:     'Metal',
        rating:    0,
        price:     '',
        note:      'Imported from Last.fm',
      });
      imported++;
    }
  }

  // Insert in batches — 100/insert is cheap and well under the
  // PostgREST payload cap. We do venues first (FK reference) then
  // concerts.
  if (newVenues.length > 0) {
    for (let i = 0; i < newVenues.length; i += 100) {
      try {
        await admin.from('user_venues').insert(newVenues.slice(i, i + 100));
      } catch {}
    }
  }
  if (concertRows.length > 0) {
    for (let i = 0; i < concertRows.length; i += 100) {
      try {
        await admin.from('user_concerts').insert(concertRows.slice(i, i + 100));
      } catch {}
    }
  }

  return NextResponse.json({
    imported,
    skipped,
    scanned: scrapedEvents.length,
    venues_created: newVenues.length,
    diag,
  });
}
