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
  // Also load the full venue row including cat so we can UPGRADE
  // venues that were previously imported as 'Other' to 'Festival'
  // when the new scrape proves they're actually festivals.
  const { data: venuesFull } = await admin
    .from('user_venues')
    .select('client_id, name, cat')
    .eq('user_id', user.id);
  const venueRowById = new Map((venuesFull || []).map(v => [v.client_id, v]));
  const venueByName = new Map();
  for (const v of (venues || [])) {
    venueByName.set(normaliseVenueName(v.name), v.client_id);
  }

  // Heuristic: Last.fm itself classifies events vs festivals by URL
  // path. /festival/N+Name = festival, /event/N+Name = concert.
  // Plus belt-and-braces keyword scan on the event title for cases
  // where Last.fm got it wrong or the data was migrated badly
  // (matches "Festival", "Fest", "Open Air", "Fesztivál" etc).
  function isFestivalEvent(ev) {
    if (ev?.ticketsUrl && /\/festival\//i.test(ev.ticketsUrl)) return true;
    const t = String(ev?.title || '').toLowerCase();
    if (/\b(festival|fest|open air|openair)\b/.test(t))     return true;
    // Known Polish/German metal festival keywords that don't match
    // the generic patterns above.
    if (/\b(graspop|hellfest|wacken|mystic|summer breeze|with full force|brutal assault|metaldays|inferno|tons of rock|exit|sweden rock|nova rock|copenhell|alcatraz)\b/.test(t)) return true;
    return false;
  }

  // Track which existing venues we UPGRADE Other → Festival in
  // this pass — applied at the end in a single UPDATE.
  const venuesToUpgrade = [];

  // Build rows + venue inserts.
  let imported = 0;
  let skipped  = 0;
  const concertRows = [];
  const newVenues   = [];

  for (const ev of scrapedEvents) {
    const venueName = ev.venue || '';
    const year      = ev.datetime ? String(new Date(ev.datetime).getFullYear()) : '';
    if (!venueName || !year) { skipped++; continue; }

    const isFest = isFestivalEvent(ev);
    const venueNorm = normaliseVenueName(venueName);
    let venueId = venueByName.get(venueNorm);
    if (!venueId) {
      // New venue. Tag cat from the per-event heuristic instead of
      // the old hardcoded 'Other'. Festivals tagged here will be
      // picked up by the festival aggregator in ConcertsTab — the
      // event lineup auto-groups into one expandable card.
      venueId = crypto.randomUUID();
      newVenues.push({
        user_id:   user.id,
        client_id: venueId,
        name:      venueName,
        city:      ev.city || '',
        cat:       isFest ? 'Festival' : 'Other',
      });
      venueByName.set(venueNorm, venueId);
    } else if (isFest) {
      // Existing venue we recognise as a festival — upgrade if it
      // was imported under the old "always Other" rule. Don't
      // downgrade Arena/Klub/Hall venues that the user tagged
      // manually; only flip Other → Festival.
      const existingRow = venueRowById.get(venueId);
      if (existingRow && existingRow.cat === 'Other'
          && !venuesToUpgrade.find(u => u.client_id === venueId)) {
        venuesToUpgrade.push({ client_id: venueId, name: existingRow.name });
      }
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

  // Upgrade existing 'Other' venues that this import recognised as
  // festivals. Per-id update (Supabase JS doesn't have multi-row
  // conditional UPDATE in one call without an RPC) — list is tiny
  // in practice (few festivals per user) so the loop is cheap.
  let venues_upgraded = 0;
  for (const v of venuesToUpgrade) {
    try {
      const { error } = await admin.from('user_venues')
        .update({ cat: 'Festival' })
        .eq('user_id', user.id)
        .eq('client_id', v.client_id);
      if (!error) venues_upgraded++;
    } catch {}
  }

  return NextResponse.json({
    imported,
    skipped,
    scanned: scrapedEvents.length,
    venues_created: newVenues.length,
    venues_upgraded,
    diag,
  });
}
