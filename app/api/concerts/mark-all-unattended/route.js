// ── /api/concerts/mark-all-unattended — opt-in inverted attended logic ──
//
// The default attended-flag flow inverted (per user feedback): for
// large festivals it's less work to MARK the ones you saw than to
// UN-MARK the ones you didn't.
//
// Going forward, LFM imports stamp attended=false on insert (the
// importer route does this directly). But the user's EXISTING 700+
// rows already have attended=true (the migration 040 default + the
// pre-inversion importer behaviour). This endpoint flips them in
// one shot: every LFM-imported row → attended=false, every manual
// row stays untouched.
//
// Manual rows stay attended=true because typing a band name into the
// "+ Dodaj koncert" form is a deliberate "I went to this" action —
// nothing to opt into.
//
// One-tap opt-in via a "Odznacz wszystko" button next to 🧹 Scal.

import { NextResponse } from 'next/server';
import { createClient, getAdminClient } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';

export async function POST() {
  // Auth check first via the user-scoped client.
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Bulk UPDATE through the admin client — RLS UPDATE policy on
  // user_concerts can be picky (some projects ship without an
  // explicit WITH CHECK clause; the UPDATE then silently affects
  // 0 rows even though USING matches). We've already authenticated
  // the caller above; .eq('user_id', user.id) keeps the operation
  // scoped to their own rows. Same pattern the importer uses for
  // its dedup passes.
  const admin = getAdminClient();
  let updated = 0;
  let total_lfm_rows = 0;
  let already_unmarked = 0;
  try {
    // Pre-count for a clearer toast — distinguishes the three
    // failure modes the user might hit:
    //   0 LFM rows           → nothing to flip (no import yet)
    //   N LFM, all unmarked  → already done; nudge to import or
    //                          to mark ✓ via the per-band toggle
    //   N LFM, M attended    → typical case; flip M to false
    const { count: lfmTotal } = await admin
      .from('user_concerts')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('note', 'Imported from Last.fm');
    total_lfm_rows = lfmTotal || 0;

    const { count: alreadyOff } = await admin
      .from('user_concerts')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('note', 'Imported from Last.fm')
      .eq('attended', false);
    already_unmarked = alreadyOff || 0;

    const { data, error } = await admin
      .from('user_concerts')
      .update({ attended: false })
      .eq('user_id', user.id)
      .eq('note', 'Imported from Last.fm')
      .neq('attended', false)
      .select('client_id');
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    updated = (data || []).length;
  } catch (e) {
    return NextResponse.json({ error: e.message || 'Update failed' }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    updated,
    total_lfm_rows,
    already_unmarked,
  });
}
