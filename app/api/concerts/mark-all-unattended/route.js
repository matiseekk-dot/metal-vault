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
import { createClient } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';

export async function POST() {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // RLS enforces the user_id scope; .eq below is belt-and-braces.
  // .neq('attended', false) so we only count + touch rows that are
  // currently attended=true (avoids gratuitous writes on a re-click).
  let updated = 0;
  try {
    const { data, error } = await sb
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

  return NextResponse.json({ ok: true, updated });
}
