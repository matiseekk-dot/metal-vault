// ── /api/concerts/schema-check — surface unapplied migrations ──
//
// The recent feature drops (attended flag, bought_at_concert_id link)
// added new columns via migrations 040 + 041. Users who haven't yet
// run those SQL statements on their Supabase get silent failures:
// the per-band ✓ toggle hits a PATCH that errors out (column missing),
// the "Odznacz wszystko" UPDATE returns 500, and the vinyl × concert
// link save silently drops the field via the existing sync fallback.
//
// This endpoint probes the two new columns with a no-op SELECT and
// reports which ones exist. Frontend renders a yellow banner with
// the exact SQL to copy-paste into the Supabase SQL editor when
// anything's missing — cheaper than a wall-of-confused-toast UX.
//
// No auth on the read — the response is just two booleans, leaks
// nothing personal. (We use the service-role client so RLS doesn't
// interfere with the column probe even when no user is signed in.)

import { NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';

async function columnExists(admin, table, column) {
  try {
    // Cheap probe — limit 0 returns no rows but forces the planner to
    // resolve the column. Postgres errors out with "column does not
    // exist" if the column is missing; success means it's there.
    const { error } = await admin.from(table).select(column).limit(0);
    if (!error) return true;
    // Match the specific column-not-found error pattern. Other errors
    // (auth, network) also mean we can't trust the result — return
    // null so the caller can present a "unknown" state rather than
    // a false "missing".
    if (/column|does not exist|undefined column|nie\s*istnieje/i.test(error.message || '')) {
      return false;
    }
    return null;
  } catch {
    return null;
  }
}

export async function GET() {
  const admin = getAdminClient();
  const attended            = await columnExists(admin, 'user_concerts',        'attended');
  const isHeadliner         = await columnExists(admin, 'user_concerts',        'is_headliner');
  const boughtAtConcertId   = await columnExists(admin, 'collection',           'bought_at_concert_id');
  const isPreordered        = await columnExists(admin, 'collection',           'is_preordered');
  const concertExcludes     = await columnExists(admin, 'user_concert_excludes', 'exclude_key');

  return NextResponse.json({
    columns: {
      'user_concerts.attended':                  attended,
      'user_concerts.is_headliner':              isHeadliner,
      'collection.bought_at_concert_id':         boughtAtConcertId,
      'collection.is_preordered':                isPreordered,
      'user_concert_excludes.exclude_key':       concertExcludes,
    },
    // Convenience aggregate: any missing column means the UI should
    // surface the migration banner.
    needs_migration: attended === false
                  || isHeadliner === false
                  || boughtAtConcertId === false
                  || isPreordered === false
                  || concertExcludes === false,
  });
}
