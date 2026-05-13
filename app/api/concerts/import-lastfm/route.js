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
// Vercel max — 300s on Pro plan. Big imports now do TWO layers of
// scraping:
//   1) Year-tab walk (~10 years × 1-2 pages × 250ms pacing = ~10s)
//   2) Per-festival lineup expansion (~7 lineup pages × 7 festivals
//      × 250ms = ~12s minimum, 30s worst case for power users)
// Plus actual HTTP latency (Last.fm = 200-800ms / req from EU edge).
// 240s gives comfortable headroom; failing imports time out cleanly
// instead of dying mid-INSERT and leaving a half-imported journal.
export const maxDuration = 240;

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

// Band-name dedup helper. Collapses unicode-equivalent forms so e.g.
// "Bölzer" written as NFC ("ö") matches "Bölzer" written as NFD
// ("ö") — Last.fm has been observed to deliver both forms
// across different archive pages, producing the duplicate rows the
// user screenshotted ("Behemoth / Batushka / Bölzer" × 2). Also
// strips zero-width / BOM / non-breaking-space invisibles that
// silently break naive string equality.
function normaliseBandName(s) {
  return String(s || '')
    .normalize('NFC')
    .replace(/[​-‍﻿]/g, '')   // zero-width chars
    .replace(/ /g, ' ')                 // nbsp → regular space
    .toLowerCase()
    .trim();
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
      maxPages:    10,    // 60 was wasteful — typical user has 1-3 pages per year
      maxYears:    60,
      pacingMs:    150,   // halved from 250ms — tight enough to stay under Vercel 240s
      yearDelayMs: 250,   // halved from 400ms
    });
  } catch (e) {
    return NextResponse.json({ error: 'Scrape failed: ' + e.message }, { status: 502 });
  }

  // Dedupe scraped events. Last.fm lists the same event in BOTH the
  // 'upcoming' tab AND the corresponding year tab — same event, but
  // the lineup ordering can differ between tabs (one lists Amon Amarth
  // first, the other lists Orbit Culture first) so an order-based key
  // missed the duplicate and we'd insert the whole lineup twice.
  //
  // Now we key on the EVENT ID extracted from the URL (LFM gives every
  // event a stable numeric id), with a (date+venue) fallback for the
  // rare row that lacks one.
  const mergeMap = new Map();
  const mergeKey = (e) => {
    // The id parser stamps lfm-event:NNN when the URL had /event/NNN
    // or /festival/NNN — same number for both surfaces of the same event.
    if (e?.id) return e.id;
    const d = (e.datetime || '').slice(0, 10);
    const v = (e.venue || '').toLowerCase().trim();
    return 'fallback|' + d + '|' + v;
  };
  for (const e of rawEvents) {
    const k = mergeKey(e);
    if (!mergeMap.has(k)) mergeMap.set(k, e);
  }
  const scrapedEvents = [...mergeMap.values()];

  // Per-year breakdown — for "the importer cut off 2010" reports we
  // need to know whether the year tab was DETECTED (=> Last.fm renders
  // it in the year-picker), whether we FETCHED the page (=> not a 404),
  // and how many events came back from the parser. Three independent
  // failure modes, three independent counters.
  const yearStats = {};   // { 2010: { fetched: 1, parsed: 0 }, ... }
  for (const t of (rawEvents.__debug?.trace || [])) {
    const tgt = String(t.target || '');
    if (!yearStats[tgt]) yearStats[tgt] = { fetched: 0, parsed: 0 };
    yearStats[tgt].fetched++;
    yearStats[tgt].parsed += (t.finalEvents || 0);
  }
  const diag = {
    targets_scanned: rawEvents.__debug?.targets?.length || 0,
    targets:         rawEvents.__debug?.targets || [],     // explicit year list
    pages_scanned:   rawEvents.__debug?.trace?.length || 0,
    raw_count:       rawEvents.length,
    merged:          scrapedEvents.length,
    last_status:     rawEvents.__debug?.lastStatus || 'unknown',
    year_stats:      yearStats,
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

  // Pre-import duplicate sweep — earlier importer revisions could
  // insert the same (band, year, venue) twice or more (concurrent
  // 📻 Last.fm clicks, race-conditions, broken pre-mergeKey runs,
  // duplicate venue rows created across imports). Keep the OLDEST
  // row of each (band, year, venue_NORMALIZED-NAME) group; delete
  // the rest. We key on the normalised VENUE NAME, not venue_id —
  // earlier runs sometimes created two venue rows for the same
  // physical venue (e.g. "Stocznia Cesarska" vs "Stocznia Cesarska
  // (B90)") and a venue-id-based dedup would miss those.
  let pre_dedup_killed = 0;
  try {
    // Load venues first so we can resolve venue_id → normalised name.
    const { data: allVenues } = await admin
      .from('user_venues')
      .select('client_id, name')
      .eq('user_id', user.id);
    const venueNormById = new Map();
    for (const v of (allVenues || [])) {
      venueNormById.set(v.client_id, normaliseVenueName(v.name));
    }
    const { data: lfmRows } = await admin
      .from('user_concerts')
      .select('client_id, band, year, venue_id, planned_date, created_at')
      .eq('user_id', user.id)
      .eq('note', 'Imported from Last.fm')
      .order('created_at', { ascending: true });
    const seen = new Map();   // (band+year+venue_norm[+date]) → first client_id
    const toDelete = [];
    for (const r of (lfmRows || [])) {
      const venueNorm = venueNormById.get(r.venue_id) || '';
      // PER-EVENT dedup. Use the exact date when present (which it is
      // for everything migration 038 stamped — all LFM imports going
      // forward). Year is a fallback ONLY for legacy rows from before
      // 038 that still have planned_date=null.
      //
      // This protects the "saw Opeth 5 times at different venues" case
      // AND the "two-night residency at the same venue" case: two
      // Iron Maiden rows at O2 Arena dated 2024-09-15 and 2024-09-16
      // produce DIFFERENT keys (the date segment differs) → not merged.
      // Same-day duplicates (e.g. the same LFM event imported twice
      // via 'upcoming' + year tab) DO merge — they share the date.
      const k = r.planned_date
        ? normaliseBandName(r.band) + '::d::' + r.planned_date + '::' + venueNorm
        : normaliseBandName(r.band) + '::y::' + (r.year || '') + '::' + venueNorm;
      if (seen.has(k)) {
        toDelete.push(r.client_id);
      } else {
        seen.set(k, r.client_id);
      }
    }
    for (const cid of toDelete) {
      try {
        const { error } = await admin.from('user_concerts')
          .delete()
          .eq('user_id', user.id)
          .eq('client_id', cid);
        if (!error) pre_dedup_killed++;
      } catch {}
    }
  } catch {}

  if (scrapedEvents.length === 0) {
    return NextResponse.json({ imported: 0, skipped: 0, scanned: 0, diag });
  }

  // ── User-explicit exclusions (migration 039) ────────────────
  // Bands the user previously DELETED from an LFM-imported festival.
  // The user said: "nobody saw every band at a 200-act festival — let
  // me prune the lineup and have it stick." When the user × a row,
  // /api/user-concerts records an exclude_key here. We load that Set
  // now and merge it into existingKeys so the insert phase silently
  // skips those (band, year, venue) tuples.
  let excludeKeys = new Set();
  try {
    const { data: excl } = await admin
      .from('user_concert_excludes')
      .select('exclude_key')
      .eq('user_id', user.id);
    excludeKeys = new Set((excl || []).map(r => r.exclude_key));
  } catch {}

  // Existing user_concerts rows — build a dedup index by (band_norm,
  // year, venue_norm) so repeat imports don't duplicate. CRITICAL:
  // .eq('user_id', user.id) — the admin client bypasses RLS and the
  // default 1000-row Supabase select cap could otherwise eat THIS
  // user's rows when other users have a lot of concerts, causing
  // existingKeys to be empty → every band re-inserted → multiplication.
  const { data: existing } = await admin
    .from('user_concerts')
    .select('band, year, venue_id, planned_date, client_id')
    .eq('user_id', user.id);
  const { data: venues } = await admin
    .from('user_venues')
    .select('client_id, name')
    .eq('user_id', user.id);
  const venueNameById = new Map((venues || []).map(v => [v.client_id, normaliseVenueName(v.name)]));
  // PER-EVENT identity: exact date when row has one, year as fallback
  // for legacy rows. Same shape used by pre/post-dedup AND the insert-
  // loop below so all four dedup surfaces agree. Two-night residency
  // (Iron Maiden at O2 on 2024-09-15 and 2024-09-16) produces two
  // separate keys → both rows survive.
  const existingKeys = new Set();
  for (const r of (existing || [])) {
    const bandKey  = normaliseBandName(r.band);
    const venueKey = venueNameById.get(r.venue_id) || '';
    const k = r.planned_date
      ? bandKey + '::d::' + r.planned_date + '::' + venueKey
      : bandKey + '::y::' + String(r.year || '').trim() + '::' + venueKey;
    existingKeys.add(k);
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
  // Extract the headliner band name from an event title.
  // On Last.fm's user-events listing, the title cell shows the
  // headliner band name as a hyperlink while the lineup cell shows
  // ONLY the support bands. Without prepending the title we'd lose
  // every headliner — e.g. "Katatonia" event with lineup "Agent
  // Fresco, VOLA" imported as just Agent Fresco + VOLA, Katatonia
  // dropped.
  //
  // Tour-titled events ("Mayhem - World Tour 2026") get split on
  // " - " and the first segment used. Festival titles ("Brutal
  // Assault XXI", "Hellfest 2026") are recognised separately via
  // isFestivalEvent above and skipped here.
  function extractHeadlinerFromTitle(title) {
    if (!title) return null;
    let head = String(title).trim();
    // Strip everything after a tour/album separator. Last.fm titles
    // come in many flavours; we slice off the suffix for ALL of these:
    //   • "Mayhem - World Tour 2026"      → "Mayhem"
    //   • "Kreator: Krushers of the World"→ "Kreator"
    //   • "Behemoth — Opvs Contra Natvram" → "Behemoth"
    //   • "Amon Amarth ft. Carcass"       → "Amon Amarth"
    //   • "Metallica with Mammoth WVH"    → "Metallica"
    //   • "Ghost (Re-Imperatour)"         → "Ghost"
    head = head.split(/\s+[–—-]\s+/)[0].trim();   // any dash with spaces
    head = head.split(':')[0].trim();             // colon-separator suffix
    head = head.split(/\s+(?:feat\.?|ft\.?|with|w\/|presents)\s+/i)[0].trim();
    head = head.replace(/\s*\([^)]*\)\s*$/, '').trim();   // trailing (...)
    // Strip trailing year + tour suffix words.
    head = head.replace(/\s+\d{4}\s*$/, '').trim();
    head = head.replace(/\s+(Tour|Europe|UK|World|North America|Asia|South America)\s*$/i, '').trim();
    // Reject anything that's clearly a festival/show name even after
    // stripping. "European Metal Festival" etc.
    if (/\b(festival|fest|open air|tour|live)\b/i.test(head)) return null;
    // Reject if too long (band names rarely > 60 chars; festival
    // descriptions often are).
    if (!head || head.length > 60) return null;
    return head;
  }

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

  // Diag counters for the lineup-expansion pass.
  // `lineups_attempted` = how many events even triggered the /lineup
  //   walk (festival or apparently-truncated). If this stays 0 across
  //   a big import the heuristic isn't recognising festivals at all.
  // `lineups_expanded` = how many of those got back MORE bands than
  //   the listing-view originally had. Big gap between these two →
  //   /lineup walker is failing somewhere (rate limit, timeout, regex).
  let lineups_attempted = 0;
  let lineups_expanded  = 0;

  for (const ev of scrapedEvents) {
    const venueName = ev.venue || '';
    const year      = ev.datetime ? String(new Date(ev.datetime).getFullYear()) : '';
    if (!venueName || !year) { skipped++; continue; }

    const isFest = isFestivalEvent(ev);

    // Title-extracted headliner — used both for the truncation
    // heuristic below and the final prepend pass. Only computed for
    // non-festival events (festival titles like "Wacken Open Air"
    // aren't band names). When the extracted name is ONE word
    // (Igorrr, Mayhem, Slayer, Behemoth), we trust it as a high-
    // confidence band name; that drives an extra trip to the event
    // detail page so the walker can fill in supports we missed.
    // Multi-word titles ("Polish Satanist", "Sounds Of A Playground
    // Fading") get the conservative empty-lineup-only treatment so
    // we don't pollute the journal with album/tour names.
    const titleHead = !isFest ? extractHeadlinerFromTitle(ev.title) : null;
    const singleWordTitleHead = !!titleHead && /^\S+$/.test(String(titleHead).trim());
    const titleHeadInLineup = titleHead && (ev.lineup || []).some(n =>
      normaliseBandName(n) === normaliseBandName(titleHead));

    // Enrich lineup from event detail page. The events-listing
    // page only renders 3-5 performer names per row for layout
    // reasons; bigger gigs (festivals, multi-act tours) hide the
    // rest behind a "+N more" link. We fetch the detail page when:
    //   - the URL says /festival/, OR
    //   - the visible lineup looks truncated for a non-festival
    //     (≤1 acts on a row that also has a venue), OR
    //   - ANY title-extracted-headliner (single OR multi-word) is
    //     missing from the lineup AND the lineup is small (≤3 bands)
    //     — covers "Born of Osiris" (3-word headliner with [Volumes,
    //     Veil of Maya, BCI] as cell supports) on top of the IGORRR
    //     case from before.
    // The ≤3 cap bounds budget — we don't re-walk events that
    // already look like full festival bills.
    const looksTruncated = isFest
      || (Array.isArray(ev.lineup) && ev.lineup.length <= 1 && ev.venue)
      || (titleHead && !titleHeadInLineup && ev.venue && (ev.lineup || []).length <= 3);
    // Track whether the walker actually returned a non-empty lineup.
    // We use this to decide whether to trust its silence — if it
    // succeeded and the title-extracted-headliner is STILL missing,
    // that's a strong signal the title is a promo / album name
    // ("Polish Satanist" event tag) rather than a band, so we don't
    // prepend. When the walker fails (LFM event page purged after
    // 2018 events deprecation, timeout, rate-limit), prepend kicks
    // in as a last-resort fallback.
    let walkerSucceeded = false;
    if (looksTruncated && ev.ticketsUrl) {
      lineups_attempted++;
      try {
        // maxPages 12 (was 6). User reported a festival showing 9 bands
        // when the actual lineup is 90+ — 6 pages × ~8 bands/page wasn't
        // enough depth for big festivals. 12 covers up to ~100 bands per
        // event; for the rare 200+ Wacken-class lineup, re-clicking 📻
        // is idempotent and dedup-aware so a second pass adds the long
        // tail without duplicating rows.
        const full = await lastfmEventFullLineup(ev.ticketsUrl, {
          timeoutMs: 6000, maxPages: 12,
        });
        // UNION not REPLACE — the user-events page cell sometimes
        // contains bands the /lineup walker doesn't see (Last.fm
        // surfaces "Confirmed" tier on the user listing but reorders
        // /lineup paginated into tier groups). Equally the walker
        // returns the long tail the cell omits.
        if ((full?.length || 0) > 0) {
          walkerSucceeded = true;
          const seenN = new Set();
          const merged = [];
          const push = (n) => {
            const k = normaliseBandName(n);
            if (!k || seenN.has(k)) return;
            seenN.add(k);
            merged.push(n);
          };
          for (const n of (ev.lineup || [])) push(n);
          for (const n of full) push(n);
          if (merged.length > (ev.lineup?.length || 0)) {
            ev.lineup = merged;
            lineups_expanded++;
          }
        }
      } catch {}
      await new Promise(rr => setTimeout(rr, 200));
    }

    // Non-festival events: prepend the title-extracted headliner
    // whenever it's missing from the final lineup. The earlier
    // "walker succeeded so trust its silence" gate misfired on the
    // Born of Osiris case — the event-page walker returned the same
    // [Volumes, Veil of Maya, BCI] as the cell-parser (BoO wasn't
    // listed there either, even though the title says "Born of
    // Osiris"). Both surfaces missed the headliner; the title's the
    // only place we know it.
    //
    // Accepts the occasional "Polish Satanist"-style promo-as-band
    // false positive (multi-word title that isn't really a band).
    // extractHeadlinerFromTitle already filters tour / festival /
    // live / open-air vocabulary, and 60-char-plus descriptions
    // get rejected. What survives is band-shaped; if it's wrong,
    // the user × deletes it once and the migration-039 tombstone
    // keeps it away on every re-import.
    //
    // (walkerSucceeded is kept in scope for diag/future use even
    // though the gate is gone.)
    if (!isFest && titleHead) {
      const stillMissing = (ev.lineup || []).every(n =>
        normaliseBandName(n) !== normaliseBandName(titleHead));
      if (stillMissing) {
        ev.lineup = [titleHead, ...(ev.lineup || [])];
      }
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
      // Same key shape as existingKeys above + the pre/post dedup
      // passes: exact date when known (which it always is for LFM
      // imports thanks to migration 038), year as legacy fallback.
      // Bands+venue+different dates count as DIFFERENT events.
      const dedupKey = evDateIso
        ? normaliseBandName(bandStr) + '::d::' + evDateIso + '::' + venueNorm
        : normaliseBandName(bandStr) + '::y::' + year + '::' + venueNorm;
      // User explicitly removed this band from this event in the
      // past — respect their pruning. (Migration 039 tombstones.)
      if (excludeKeys.has(dedupKey)) { skipped++; continue; }
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
        is_planned:     isUpcoming,
        tickets_bought: false,
        // Inverted attended-flag default for LFM imports: lineup rows
        // come back with the FULL festival roster (often 100+ bands)
        // but the user typically only saw a small subset. Default OFF
        // so the user opts in per-band via the ✓ toggle — much less
        // friction than un-ticking 80 of 90 acts at a major festival.
        // Manual entries (via the +Dodaj koncert form) stay attended
        // =true (the column default) since typing a band name in by
        // hand is a deliberate "I saw this" action.
        attended:       false,
        // ALWAYS store the full event date, not just for upcoming.
        // Migration 038 named the column planned_date but it accepts
        // any date — we re-use it as "exact event date" for every
        // LFM-imported row. Lets the density heuristic below tell
        // a one-day festival apart from 4 separate gigs at the same
        // club spread across a year.
        planned_date:   evDateIso || null,
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
          const bandKey = normaliseBandName(band);
          if (!bandKey) continue;
          const match = (nowRows || []).find(r =>
            normaliseBandName(r.band) === bandKey &&
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
  // Real-world catch-all: any venue+DATE combination with ≥4 distinct
  // bands is a festival. We previously grouped by venue+YEAR which
  // collapsed every gig at a busy club (Mega Club hosting 20+ concerts
  // a year with 2-3 bands each totals >4 across the year → wrongly
  // flagged as festival, merged everything into one card).
  //
  // Now: only same-DATE clusters count. Past LFM imports get their
  // planned_date populated above, so this works for history too.
  //
  // Threshold of 4 stays conservative: 3-band billings happen at clubs;
  // 4+ on the same date = festival. Only promotes 'Other' → 'Festival'.
  let density_upgraded = 0;
  // Lifted out of try-block so the downgrade pass below can read it.
  // Built inside the try-block on success; stays an empty Set on
  // failure so the downgrade pass treats every Festival-tagged venue
  // as a candidate (which is the safe-conservative outcome — we'd
  // rather under-downgrade than reclassify festivals based on a
  // partial density computation).
  let denseVenues = new Set();
  try {
    const { data: allRows } = await admin
      .from('user_concerts')
      .select('venue_id, planned_date, year, band')
      .eq('user_id', user.id)
      .not('venue_id', 'is', null);

    // Group: venue_id+EXACT date → Set<band lowercased>.
    //
    // No year-fallback: rows without planned_date are SKIPPED. Legacy
    // pre-038 rows where planned_date is null get year-fallback-grouped
    // would otherwise wrongly promote STODOŁA / SPODEK / DEKOMPRESJA
    // (mid-size clubs hosting many separate single-band gigs across the
    // year — 3-4 events × 1-2 bands = ≥4 distinct bands per year-bucket
    // → promoted to Festival even though no single date had 4 bands).
    // Strict same-DATE check eliminates the false-positive.
    const groups = new Map();
    for (const r of (allRows || [])) {
      if (!r.planned_date) continue;        // strict: same-date required
      const k = r.venue_id + '::' + r.planned_date;
      const s = groups.get(k) || new Set();
      s.add(normaliseBandName(r.band));
      groups.set(k, s);
    }

    // Pick venue_ids that have ≥4 bands ON THE SAME DATE in any group.
    // (denseVenues declared at the outer scope so the downgrade pass
    // below can use it.)
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

  // ── DOWNGRADE pass — undo earlier broken Festival promotions ─
  // Earlier importer revisions used venue+YEAR density which falsely
  // upgraded clubs like STODOŁA and SPODEK to Festival when they
  // hosted >4 distinct single-band gigs across a year. The strict
  // venue+DATE density above no longer makes that mistake, but
  // existing wrongly-flagged venues stay Festival until something
  // sets them back. This pass downgrades any venue currently marked
  // Festival that has NO single date with ≥4 bands AND isn't matched
  // by the URL/keyword festival detector via its name.
  //
  // We only touch venues that were created by Last.fm imports (rows
  // exist in user_concerts with note='Imported from Last.fm') so
  // manually-tagged "Festival" venues stay untouched — the user
  // might want a custom venue category override.
  let venues_downgraded = 0;
  try {
    // Build a set of venues that DO have ≥4 same-date bands (the
    // legitimately festival-shaped ones from the densitymap above).
    const goodFestivalVenues = new Set(denseVenues);

    // Match the festival-name keyword used by isFestivalEvent —
    // venues called "Wacken Open Air" etc. should NOT be downgraded
    // even if their lineup looks sparse (festival in name = festival).
    const festNameRx = /\b(festival|fest|open air|openair|graspop|hellfest|wacken|mystic|summer breeze|brutal assault|metaldays|inferno|tons of rock|sweden rock|nova rock|copenhell|metalmania|woodstock|pol[' ]?and[' ]?rock|impact festival|impact fest)\b/i;

    // Find every Festival-tagged venue the user has.
    const { data: festVenues } = await admin
      .from('user_venues')
      .select('client_id, name, cat')
      .eq('user_id', user.id)
      .eq('cat', 'Festival');

    // Only touch venues that have LFM-imported rows — manual venues
    // tagged Festival by the user stay (they may have categorised a
    // multi-stage warehouse as "Festival" for their own taxonomy).
    const { data: lfmConcerts } = await admin
      .from('user_concerts')
      .select('venue_id')
      .eq('user_id', user.id)
      .eq('note', 'Imported from Last.fm');
    const lfmVenueIds = new Set((lfmConcerts || []).map(r => r.venue_id).filter(Boolean));

    // Of those, which ones (a) are NOT in the legit set AND (b) don't
    // have a festival-flavoured name AND (c) were touched by LFM →
    // downgrade to 'Other'.
    const downgradeCandidates = (festVenues || []).filter(v => {
      if (goodFestivalVenues.has(v.client_id)) return false;
      if (festNameRx.test(v.name || '')) return false;
      if (!lfmVenueIds.has(v.client_id))   return false;
      return true;
    });

    for (const v of downgradeCandidates) {
      try {
        const { error } = await admin.from('user_venues')
          .update({ cat: 'Other' })
          .eq('user_id', user.id)
          .eq('client_id', v.client_id);
        if (!error) venues_downgraded++;
      } catch {}
    }
  } catch {}

  // ── One-time cleanup: title-as-band rows ───────────────────
  // Legacy from before extractHeadlinerFromTitle handled colon and
  // em-dash separators — rows like "Kreator: Krushers of the World"
  // or "Mayhem — Daemonic Rites Tour" were inserted as BAND names.
  // Re-extract the clean headliner; if a row with that clean name
  // already exists in the same (year, venue) bucket, drop the dirty
  // row. Otherwise rename it in-place. Idempotent — clean rows pass
  // through untouched.
  let title_band_cleaned = 0;
  try {
    const { data: titleVenues } = await admin
      .from('user_venues')
      .select('client_id, name')
      .eq('user_id', user.id);
    const venueNormById3 = new Map();
    for (const v of (titleVenues || [])) {
      venueNormById3.set(v.client_id, normaliseVenueName(v.name));
    }
    const { data: dirtyRows } = await admin
      .from('user_concerts')
      .select('client_id, band, year, venue_id, planned_date')
      .eq('user_id', user.id)
      .eq('note', 'Imported from Last.fm');
    // Build a set of "clean" (band, year, venue) keys that already
    // exist so we can detect when renaming would create a duplicate.
    const cleanIndex = new Set();
    for (const r of (dirtyRows || [])) {
      const venueNorm = venueNormById3.get(r.venue_id) || '';
      cleanIndex.add(normaliseBandName(r.band) + '::' +
                     (r.year || '') + '::' + venueNorm);
    }
    for (const r of (dirtyRows || [])) {
      const b = String(r.band || '');
      // Trigger only for rows whose band name has a separator that
      // suggests it's actually a title: colon, em/en dash, or trailing
      // parenthetical (e.g. "(Re-Imperatour)").
      if (!/[:—–]|\s+-\s+|\s+\([^)]+\)\s*$/.test(b)) continue;
      const cleaned = extractHeadlinerFromTitle(b);
      if (!cleaned || cleaned.toLowerCase() === b.toLowerCase()) continue;
      const venueNorm = venueNormById3.get(r.venue_id) || '';
      const cleanKey = normaliseBandName(cleaned) + '::' +
                       (r.year || '') + '::' + venueNorm;
      if (cleanIndex.has(cleanKey)) {
        // Clean variant exists at this event — drop the dirty row.
        try {
          const { error } = await admin.from('user_concerts')
            .delete()
            .eq('user_id', user.id)
            .eq('client_id', r.client_id);
          if (!error) title_band_cleaned++;
        } catch {}
      } else {
        // Rename in place. Update cleanIndex so a subsequent dirty row
        // with the same cleaned name dedups against this one.
        try {
          const { error } = await admin.from('user_concerts')
            .update({ band: cleaned })
            .eq('user_id', user.id)
            .eq('client_id', r.client_id);
          if (!error) {
            title_band_cleaned++;
            cleanIndex.add(cleanKey);
          }
        } catch {}
      }
    }
  } catch {}

  // ── Post-import dedup sweep ─────────────────────────────────
  // Same logic as pre-dedup but runs AFTER inserts so it catches
  // race conditions (user clicks 📻 Last.fm twice in rapid succession
  // and both requests proceed concurrently — each sees an empty DB
  // at pre-dedup time, both insert the same lineup → duplicates).
  //
  // Key uses normalised VENUE NAME, not venue_id — covers the case
  // where the same physical venue exists with multiple slightly-
  // different name variants in user_venues.
  let post_dedup_killed = 0;
  try {
    const { data: postVenues } = await admin
      .from('user_venues')
      .select('client_id, name')
      .eq('user_id', user.id);
    const venueNormById2 = new Map();
    for (const v of (postVenues || [])) {
      venueNormById2.set(v.client_id, normaliseVenueName(v.name));
    }
    const { data: postRows } = await admin
      .from('user_concerts')
      .select('client_id, band, year, venue_id, planned_date, created_at')
      .eq('user_id', user.id)
      .eq('note', 'Imported from Last.fm')
      .order('created_at', { ascending: true });
    const seen2 = new Map();
    const toDel2 = [];
    for (const r of (postRows || [])) {
      const venueNorm = venueNormById2.get(r.venue_id) || '';
      // PER-EVENT dedup (same logic as pre-dedup above): exact date
      // when known, year fallback only for legacy rows without it.
      // Two-night residencies (Opeth at Stodoła on 2024-04-12 and
      // 2024-04-13) stay distinct because the date segment differs.
      const k = r.planned_date
        ? normaliseBandName(r.band) + '::d::' + r.planned_date + '::' + venueNorm
        : normaliseBandName(r.band) + '::y::' + (r.year || '') + '::' + venueNorm;
      if (seen2.has(k)) {
        toDel2.push(r.client_id);
      } else {
        seen2.set(k, r.client_id);
      }
    }
    for (const cid of toDel2) {
      try {
        const { error } = await admin.from('user_concerts')
          .delete()
          .eq('user_id', user.id)
          .eq('client_id', cid);
        if (!error) post_dedup_killed++;
      } catch {}
    }
  } catch {}

  return NextResponse.json({
    imported,
    skipped,
    scanned: scrapedEvents.length,
    venues_created: newVenues.length,
    venues_upgraded,
    venues_downgraded,
    promoted_upcoming,
    lineups_attempted,
    lineups_expanded,
    pre_dedup_killed,
    post_dedup_killed,
    title_band_cleaned,
    excludes_active: excludeKeys.size,
    diag: {
      ...diag,
      existing_before: (existing || []).length,
      existing_keys:   existingKeys.size,
    },
  });
}
