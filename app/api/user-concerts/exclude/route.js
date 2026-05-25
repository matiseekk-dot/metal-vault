// ── /api/user-concerts/exclude ──────────────────────────────────────
// Tombstone insert for the user_concert_excludes table (migration 039).
// When the user clicks "Nie idę" / "🚫 Dismiss" on an upcoming concert
// (or deletes one of the bands from a LFM-imported festival lineup),
// we drop a row here so the next nightly cron / manual import doesn't
// helpfully re-add the entry.
//
// POST { exclude_key, band, year, venue_norm }
// DELETE → reserved for future "restore" UI (clear-lastfm already
//          wipes the whole table in /api/concerts/clear-lastfm).

export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';

export async function POST(request) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const excludeKey = String(body?.exclude_key || '').trim().slice(0, 400);
  if (!excludeKey) {
    return NextResponse.json({ error: 'exclude_key required' }, { status: 400 });
  }

  const { error } = await sb
    .from('user_concert_excludes')
    .upsert({
      user_id:     user.id,
      exclude_key: excludeKey,
      band:        body?.band       ? String(body.band).slice(0, 200)       : null,
      year:        body?.year       ? String(body.year).slice(0, 8)         : null,
      venue_norm:  body?.venue_norm ? String(body.venue_norm).slice(0, 200) : null,
    }, { onConflict: 'user_id,exclude_key' });

  if (error) {
    // Migration 039 not applied yet → table missing. Don't fail the
    // user flow over a tombstone; the row already flipped to
    // is_planned=false locally and on user_concerts, so the visible
    // effect (gone from upcoming) holds.
    if (/relation .* does not exist|user_concert_excludes/i.test(error.message || '')) {
      return NextResponse.json({ ok: true, warn: 'excludes table missing — install migration 039' });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
