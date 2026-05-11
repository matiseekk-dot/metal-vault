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
import { lastfmUserEventsAll, lastfmEventFullLineup } from '@/lib/lastfm';

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

  // Cleanup pass — earlier broken parser runs inserted '<unknown>'
  // band rows when the title fell back through an empty lineup. Strip
  // those before computing dedup so they don't haunt the journal.
  try {
    await admin.from('user_concerts')
      .delete()
      .eq('user_id', user.id)
      .eq('band', '<unknown>');
  } catch {}

  if (scrapedEvents.length === 0) {
    return NextResponse.json({ imported: 0, skipped: 0, scanned: 0, diag });
  }

  // Existing user_concerts rows — build a dedup index by (band_norm,
  // year, venue_norm) so repeat imports don't duplicate. CRITICAL:
  // .eq('user_id', user.id) — the admin client bypasses RLS and the
  // default 1000-row Supabase select cap could otherwise eat THIS
  // user's rows when other users have a lot of concerts, causing
  // existingKeys to be empty → every band re-inserted → multiplication.
  const { data: existing } = await admin
    .from('user_concerts')
    .select('band, year, venue_id, client_id')
    .eq('user_id', user.id);
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
  // PLUS belt-and-braces keyword scan on the event title AND venue
  // name — useful for old data where Last.fm migrated festivals into
  // /event/ URLs or where the title is just a year ("Wacken 2024").
  function isFestivalEvent(ev) {
    if (ev?.ticketsUrl && /\/festival\//i.test(ev.ticketsUrl)) return true;
    const haystack = (
      String(ev?.title || '') + ' ' +
      String(ev?.venue || '')
    ).toLowerCase();
    // Generic festival vocabulary.
    if (/\b(festival|fest|open air|openair|fesztivál|fesztival)\b/.test(haystack)) return true;
    // Curated list of well-known European + global metal festivals
    // — extend liberally; false positives here are cheap (a festival
    // tagged Festival behaves correctly even if the actual gig was
    // a club show — the aggregator still groups it).
    if (/\b(graspop|hellfest|wacken|mystic|summer breeze|with full force|brutal assault|metaldays|inferno|tons of rock|sweden rock|nova rock|copenhell|alcatraz|pol[' ]?and[' ]?rock|metalmania|knock out|knock-out|woodstock|nuclear blast|metal church|mind over matter|nidrosian|midgardsblot|tuska|ruisrock|provinssi|metallsvenskan|gefle metal|maryland deathfest|psycho las vegas|netherlands deathfest|party san|rock in rio|download festival|donington|reading|leeds|glastonbury|coachella|lollapalooza|riot fest|metal hammer|impact festival|impact fest|carnage|asgardsrei|under the black sun|kilkim ž[au]ibu|fall of summer|kaltenbach|dong open air|sweden rock|hammer of doom)\b/.test(haystack)) return true;
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

  // Track how many events got their lineup enriched from event-detail
  // pages — surfaces in toast so the user knows the import wasn't just
  // grabbing the 3-band preview from the list view.
  let lineups_expanded = 0;

  for (const ev of scrapedEvents) {
    const venueName = ev.venue || '';
    const year      = ev.datetime ? String(new Date(ev.datetime).getFullYear()) : '';
    if (!venueName || !year) { skipped++; continue; }

    const isFest = isFestivalEvent(ev);

    // Enrich lineup from event detail page. The events-listing
    // page only renders 3-5 performer names per row for layout
    // reasons; bigger gigs (festivals, multi-act tours) hide the
    // rest behind a "+N more" link. We fetch the detail page when
    // either the URL says /festival/ OR the visible lineup looks
    // truncated for a non-festival (less than 2 acts on a row that
    // also has a venue + city — strong hint there's more behind
    // the "more" cutoff).
    const looksTruncated = isFest
      || (Array.isArray(ev.lineup) && ev.lineup.length <= 1 && ev.venue);
    if (looksTruncated && ev.ticketsUrl) {
      try {
        const full = await lastfmEventFullLineup(ev.ticketsUrl, { timeoutMs: 4500 });
        if (full.length > (ev.lineup?.length || 0)) {
          ev.lineup = full;
          lineups_expanded++;
        }
      } catch {}
      // Throttle to ~3 req/sec against Last.fm — gentle on their box.
      await new Promise(rr => setTimeout(rr, 300));
    }
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

    // Future-dated events are upcoming (user marked themselves as
    // "interested in" / "going" on Last.fm). They should land in the
    // "Nadchodzące" section in the UI, NOT in the historical concerts
    // list. is_planned=true with planned_date=ISO unlocks that path.
    // ev.datetime is ISO "2026-10-29T00:00:00"; compare day-prefix
    // against today to avoid TZ edge cases on the boundary day.
    const todayIso = new Date().toISOString().slice(0, 10);
    const evDateIso = (ev.datetime || '').slice(0, 10);
    const isUpcoming = evDateIso >= todayIso;

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
        // Upcoming-tracking fields populated only for future dates.
        // Past rows keep is_planned=false (schema default), so they
        // continue rendering in the history list / ranking as before.
        is_planned:     isUpcoming,
        tickets_bought: false,        // user marks this when they buy
        planned_date:   isUpcoming ? evDateIso : null,
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

  // Retroactive upcoming-flag pass for rows already in the DB from
  // earlier imports (back when this endpoint didn't write the
  // is_planned/planned_date trio). Match by (band lowercased, year,
  // venue normalised) — same key the dedup uses — and only flip
  // is_planned=false rows whose scraped datetime is in the future.
  // We don't downgrade past rows or rewrite existing is_planned=true
  // rows, so manual user edits are preserved.
  let promoted_upcoming = 0;
  try {
    const todayIsoP = new Date().toISOString().slice(0, 10);
    const futureScraped = scrapedEvents
      .filter(ev => (ev.datetime || '').slice(0, 10) >= todayIsoP);
    if (futureScraped.length > 0) {
      // Re-fetch current rows (post-insert) so we update rows we just
      // wrote in the same request as well as legacy ones.
      const { data: nowRows } = await admin.from('user_concerts')
        .select('client_id, band, year, venue_id, is_planned, planned_date')
        .eq('user_id', user.id)
        .eq('is_planned', false);
      // Build venue norm lookup again — newVenues might not be in
      // venueNameById since that map was built before insert.
      const vNameLookup = new Map(venueNameById);
      for (const v of newVenues) vNameLookup.set(v.client_id, normaliseVenueName(v.name));

      for (const ev of futureScraped) {
        const evDate = (ev.datetime || '').slice(0, 10);
        const evYear = String(new Date(ev.datetime).getFullYear());
        const evVenueNorm = normaliseVenueName(ev.venue || '');
        const evLineup = Array.isArray(ev.lineup) && ev.lineup.length > 0
          ? ev.lineup : [ev.title || ''];
        for (const band of evLineup) {
          const bandKey = String(band || '').toLowerCase().trim();
          if (!bandKey) continue;
          const match = (nowRows || []).find(r =>
            (r.band || '').toLowerCase().trim() === bandKey &&
            String(r.year || '') === evYear &&
            (vNameLookup.get(r.venue_id) || '') === evVenueNorm
          );
          if (!match) continue;
          try {
            const { error } = await admin.from('user_concerts')
              .update({ is_planned: true, planned_date: evDate })
              .eq('user_id', user.id)
              .eq('client_id', match.client_id);
            if (!error) promoted_upcoming++;
          } catch {}
        }
      }
    }
  } catch {}

  // Upgrade existing 'Other' venues that this import recognised as
  // festivals via name/URL heuristic. Per-id update.
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

  // ── Density-based auto-promote ─────────────────────────────
  // Real-world catch-all: any venue+year combination that ended up
  // with ≥4 distinct bands MUST be a festival in practice (a single-
  // night club show never has that many headliners). This rescues
  // events the keyword heuristic misses — e.g. Metal Hammer Festival
  // at Spodek Katowice 2018 where Spodek is a generic arena venue.
  //
  // Threshold of 4 is conservative: 3-band billings happen at clubs;
  // 4+ is festival territory. Only promotes 'Other' → 'Festival'
  // (preserves user-tagged Arena/Klub/Hall).
  let density_upgraded = 0;
  try {
    const { data: allRows } = await admin
      .from('user_concerts')
      .select('venue_id, year, band')
      .eq('user_id', user.id)
      .not('venue_id', 'is', null)
      .not('year', 'is', null);

    // Group: venue_id+year → Set<band lowercased>
    const groups = new Map();
    for (const r of (allRows || [])) {
      const k = r.venue_id + '::' + r.year;
      const s = groups.get(k) || new Set();
      s.add((r.band || '').toLowerCase().trim());
      groups.set(k, s);
    }

    // Pick venue_ids that appear with ≥4 bands in ANY year.
    const denseVenues = new Set();
    for (const [k, bands] of groups) {
      if (bands.size >= 4) denseVenues.add(k.split('::')[0]);
    }

    if (denseVenues.size > 0) {
      // Load current cats for those venues — only upgrade 'Other'.
      const { data: vRows } = await admin
        .from('user_venues')
        .select('client_id, cat')
        .eq('user_id', user.id)
        .in('client_id', [...denseVenues]);
      const toFlip = (vRows || []).filter(v => v.cat === 'Other').map(v => v.client_id);
      for (const cid of toFlip) {
        try {
          const { error } = await admin.from('user_venues')
            .update({ cat: 'Festival' })
            .eq('user_id', user.id)
            .eq('client_id', cid);
          if (!error) density_upgraded++;
        } catch {}
      }
    }
  } catch {}
  venues_upgraded += density_upgraded;

  return NextResponse.json({
    imported,
    skipped,
    scanned: scrapedEvents.length,
    venues_created: newVenues.length,
    venues_upgraded,
    promoted_upcoming,
    lineups_expanded,
    diag: {
      ...diag,
      existing_before: (existing || []).length,
      existing_keys:   existingKeys.size,
    },
  });
}
