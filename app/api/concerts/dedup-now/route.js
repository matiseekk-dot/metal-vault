// ── /api/concerts/dedup-now — manual merge-duplicates pass ──
//
// User-facing button: "Scal duplikaty". Runs the same pre-dedup +
// post-dedup logic the importer applies, but standalone — no LFM
// scraping, no Vercel timeout pressure. Lets the user clean up dupes
// left over from earlier broken imports (e.g. "Bölzer" appearing
// twice because LFM delivered NFC + NFD unicode forms across
// different pages) without running 📻 Last.fm again.
//
// Merge rule: keep the OLDEST row of each (band_normalised, year,
// venue_normalised) group; delete the rest. The "attended" flag
// is OR-ed across the group so if ANY copy was marked attended=true
// the survivor keeps that — protects user marks from being lost in
// the merge.

import { NextResponse } from 'next/server';
import { createClient, getAdminClient } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

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

export async function POST() {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = getAdminClient();

  // Load all LFM-imported rows + venue names for normalisation.
  const [{ data: rows }, { data: venues }] = await Promise.all([
    admin.from('user_concerts')
      .select('client_id, band, year, venue_id, planned_date, attended, created_at')
      .eq('user_id', user.id)
      .eq('note', 'Imported from Last.fm')
      .order('created_at', { ascending: true }),
    admin.from('user_venues')
      .select('client_id, name')
      .eq('user_id', user.id),
  ]);

  const venueNormById = new Map();
  for (const v of (venues || [])) {
    venueNormById.set(v.client_id, normaliseVenueName(v.name));
  }

  // Group by (band_norm, year, venue_norm). The first encountered row
  // (created_at ascending → oldest) becomes the SURVIVOR; later rows
  // get added to the delete list. attended is OR-ed across the group
  // so a user-marked-attended row never gets demoted to attended=false
  // just because the merge survivor happened to be the older un-marked
  // row.
  const survivors = new Map();   // key → { id, attended }
  const toDelete  = [];
  const toUpdate  = new Map();   // survivor_id → { attended } if it needs OR-merge

  for (const r of (rows || [])) {
    const k = normaliseBandName(r.band) + '::' +
              (r.year || '') + '::' +
              (venueNormById.get(r.venue_id) || '');
    const existing = survivors.get(k);
    if (!existing) {
      survivors.set(k, { id: r.client_id, attended: r.attended !== false });
      continue;
    }
    toDelete.push(r.client_id);
    // OR-merge attended into the survivor.
    if (r.attended !== false && !existing.attended) {
      existing.attended = true;
      toUpdate.set(existing.id, { attended: true });
    }
  }

  let deleted = 0;
  for (const cid of toDelete) {
    try {
      const { error } = await admin.from('user_concerts')
        .delete()
        .eq('user_id', user.id)
        .eq('client_id', cid);
      if (!error) deleted++;
    } catch {}
  }

  let updated = 0;
  for (const [cid, patch] of toUpdate) {
    try {
      const { error } = await admin.from('user_concerts')
        .update(patch)
        .eq('user_id', user.id)
        .eq('client_id', cid);
      if (!error) updated++;
    } catch {}
  }

  return NextResponse.json({
    ok:           true,
    scanned:      rows?.length || 0,
    survivors:    survivors.size,
    deleted,
    updated_attended: updated,
  });
}
