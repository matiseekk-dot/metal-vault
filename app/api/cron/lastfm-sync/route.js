// ── /api/cron/lastfm-sync — nightly auto-pull of new concerts ──
//
// User asked: "A nowe wydarzenia pobiera automatycznie?" → Yes, now.
//
// Runs once a day (vercel.json schedule). For every user who has
// connected Last.fm, fetches ONLY the upcoming tab + the current
// year archive — 2 lightweight HTTP requests per user, no festival
// lineup walking, no full 15-year scan. Inserts any events not
// already in the user's journal (existingKeys dedup) and respects
// per-band exclusion tombstones the user set via × delete.
//
// Scaling math:
//   - 2 LFM requests/user × ~1s each + 600ms pacing = ~3s/user
//   - 300s maxDuration → ~80-100 users per run
//   - When/if userbase outgrows that, split by user_id hash across
//     two crons at different times, or move to per-user lazy
//     refresh on ConcertsTab mount (option #2 from the proposal).
//
// Auth: CRON_SECRET via Bearer header — same pattern as every other
// cron in this project. Vercel injects the secret automatically when
// invoking the scheduled task.

import { NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabase-server';
import { lastfmUserEventsAll } from '@/lib/lastfm';

export const dynamic     = 'force-dynamic';
export const maxDuration = 300;

const BUDGET_MS        = 4 * 60 * 1000;   // 4 minutes hard ceiling
const PACING_PER_USER  = 600;             // 600ms between users to keep LFM happy
const SAFETY_MARGIN_MS = 30 * 1000;       // bail 30s before maxDuration

// Same helpers the importer uses — duplicated rather than imported
// because /api/cron/* shouldn't pull a fat dependency tree.
function normaliseVenueName(s) {
  return String(s || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ');
}
function normaliseBandName(s) {
  return String(s || '')
    .normalize('NFC')
    .replace(/[​-‍﻿]/g, '')
    .replace(/ /g, ' ')
    .toLowerCase()
    .trim();
}

export async function GET(request) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Server misconfigured: CRON_SECRET unset' }, { status: 500 });
  }
  const auth = request.headers.get('authorization');
  if (auth !== 'Bearer ' + process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const startTs = Date.now();
  const deadline = startTs + BUDGET_MS - SAFETY_MARGIN_MS;
  const admin = getAdminClient();

  // Pull every user with a LFM username on file. Service-role read,
  // RLS bypassed.
  const { data: tokens, error: tokensErr } = await admin
    .from('lastfm_tokens')
    .select('user_id, username');
  if (tokensErr) {
    return NextResponse.json({ error: tokensErr.message }, { status: 500 });
  }

  const totals = {
    users_total:     (tokens || []).length,
    users_scanned:   0,
    users_skipped:   0,
    new_concerts:    0,
    errors:          0,
    bail_reason:     null,
  };

  for (const tok of (tokens || [])) {
    if (Date.now() > deadline) {
      totals.bail_reason = 'time_budget_exhausted';
      break;
    }
    const username = (tok.username || '').trim();
    if (!username || !tok.user_id) { totals.users_skipped++; continue; }

    try {
      // Lean scrape: upcoming + current year ONLY. The full-archive
      // walk lives behind the manual 📻 Last.fm button; this nightly
      // pass is for "did you go to anything new since yesterday".
      let scraped = [];
      try {
        scraped = await lastfmUserEventsAll(username, {
          maxYears:  1,       // → upcoming + most-recent year only
          maxPages:  3,
          pacingMs:  150,
          timeoutMs: 6000,
        });
      } catch {
        totals.errors++;
        continue;
      }

      if (!scraped || scraped.length === 0) {
        totals.users_scanned++;
        continue;
      }

      // Dedup scrape against the user's existing journal + the
      // exclusion tombstones (deleted bands the user pruned).
      const [
        { data: existing },
        { data: venues },
        { data: excl },
      ] = await Promise.all([
        admin.from('user_concerts')
          .select('band, year, venue_id, planned_date')
          .eq('user_id', tok.user_id),
        admin.from('user_venues')
          .select('client_id, name, cat')
          .eq('user_id', tok.user_id),
        admin.from('user_concert_excludes')
          .select('exclude_key')
          .eq('user_id', tok.user_id),
      ]);

      const venueNameById = new Map(
        (venues || []).map(v => [v.client_id, normaliseVenueName(v.name)])
      );
      const venueByName = new Map(
        (venues || []).map(v => [normaliseVenueName(v.name), v.client_id])
      );

      // Same per-event key shape the importer uses (date when known,
      // year fallback) so dedup matches across surfaces.
      const existingKeys = new Set();
      for (const r of (existing || [])) {
        const bandKey  = normaliseBandName(r.band);
        const venueKey = venueNameById.get(r.venue_id) || '';
        const k = r.planned_date
          ? bandKey + '::d::' + r.planned_date + '::' + venueKey
          : bandKey + '::y::' + String(r.year || '').trim() + '::' + venueKey;
        existingKeys.add(k);
      }
      const excludeKeys = new Set((excl || []).map(e => e.exclude_key));

      // Build rows to insert. Same logic as import-lastfm but no
      // festival lineup walking (too slow for a cron loop). The
      // cell-based lineup from the user-events page is enough for
      // "did you go to anything new" updates — manual 📻 still
      // available for full lineup expansion.
      const todayIso = new Date().toISOString().slice(0, 10);
      const newConcertRows = [];
      const newVenues       = [];

      for (const ev of scraped) {
        const venueName = ev.venue || '';
        const year      = ev.datetime ? String(new Date(ev.datetime).getFullYear()) : '';
        if (!venueName || !year) continue;

        const venueNorm = normaliseVenueName(venueName);
        let venueId = venueByName.get(venueNorm);
        const isFest = (ev.ticketsUrl && /\/festival\//i.test(ev.ticketsUrl))
          || /\b(festival|fest|open\s*air)\b/i.test((ev.title || '') + ' ' + venueName);
        if (!venueId) {
          venueId = crypto.randomUUID();
          newVenues.push({
            user_id:   tok.user_id,
            client_id: venueId,
            name:      venueName,
            city:      ev.city || '',
            cat:       isFest ? 'Festival' : 'Other',
          });
          venueByName.set(venueNorm, venueId);
          venueNameById.set(venueId, venueNorm);
        }

        const evDateIso = (ev.datetime || '').slice(0, 10);
        const isUpcoming = evDateIso >= todayIso;
        const lineup = Array.isArray(ev.lineup) && ev.lineup.length > 0
          ? ev.lineup
          : [ev.title || ''];

        for (const band of lineup) {
          const bandStr = String(band || '').trim();
          if (!bandStr) continue;
          const dedupKey = evDateIso
            ? normaliseBandName(bandStr) + '::d::' + evDateIso + '::' + venueNorm
            : normaliseBandName(bandStr) + '::y::' + year + '::' + venueNorm;
          if (excludeKeys.has(dedupKey)) continue;
          if (existingKeys.has(dedupKey)) continue;
          existingKeys.add(dedupKey);
          newConcertRows.push({
            user_id:        tok.user_id,
            client_id:      crypto.randomUUID(),
            band:           bandStr,
            venue_id:       venueId,
            year,
            genre:          'Metal',
            rating:         0,
            price:          '',
            note:           'Imported from Last.fm',
            is_planned:     isUpcoming,
            tickets_bought: false,
            attended:       false,    // inverted-attended default for LFM
            planned_date:   evDateIso || null,
          });
        }
      }

      if (newVenues.length > 0) {
        try { await admin.from('user_venues').insert(newVenues); } catch {}
      }
      if (newConcertRows.length > 0) {
        try {
          await admin.from('user_concerts').insert(newConcertRows);
          totals.new_concerts += newConcertRows.length;
        } catch (e) {
          // If 'attended' column doesn't exist yet on this Supabase,
          // strip it and retry — matches the syncConcert client-side
          // graceful-degradation pattern.
          if (/attended/i.test(e.message || '')) {
            const stripped = newConcertRows.map(r => {
              const { attended, ...rest } = r;
              return rest;
            });
            try {
              await admin.from('user_concerts').insert(stripped);
              totals.new_concerts += stripped.length;
            } catch { totals.errors++; }
          } else {
            totals.errors++;
          }
        }
      }

      totals.users_scanned++;
    } catch {
      totals.errors++;
    }

    // Pace between users so we don't fire 80 LFM scrapes in 5s.
    await new Promise(r => setTimeout(r, PACING_PER_USER));
  }

  totals.elapsed_ms = Date.now() - startTs;
  return NextResponse.json(totals);
}
