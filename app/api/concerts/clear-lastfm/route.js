// ── /api/concerts/clear-lastfm — wipe LFM-imported user_concerts rows ──
//
// Why this exists: the LFM importer is idempotent (dedup by band+year+
// venue_norm) but earlier broken runs created incomplete rows — e.g. a
// festival with only the 8 featured bands instead of the full 100+
// after the paginated /lineup walker was wired in. Once those 8 rows
// exist, the next import's dedup happily skips them, leaving the user
// stuck with the truncated lineup.
//
// This endpoint nukes EVERY row whose `note` field marks it as
// LFM-origin. After that, the user re-clicks 📻 Last.fm and the
// importer runs against a clean slate, picking up the full lineup
// for every festival.
//
// User-tagged rows (note ≠ "Imported from Last.fm") are preserved.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';

export async function POST() {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Count first so the toast can report what we deleted.
  let count_before = 0;
  try {
    const { count } = await sb.from('user_concerts')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('note', 'Imported from Last.fm');
    count_before = count || 0;
  } catch {}

  // DELETE pass. RLS guards the user_id scope; the .eq below is
  // belt-and-braces against any future RLS regression.
  const { error } = await sb.from('user_concerts')
    .delete()
    .eq('user_id', user.id)
    .eq('note', 'Imported from Last.fm');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, deleted: count_before });
}
