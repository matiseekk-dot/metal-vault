// ── /api/concerts/debug-lineup — diagnostic for /lineup walker ──
//
// Bypasses caching, dedup, and any of the heuristics that the import
// path uses. Hit this with a Last.fm event/festival URL and it returns
// EXACTLY what the walker sees:
//   { url, normalisedBase, pageCounts: [{page, fresh, status}], total, names }
//
// Goal: when user reports "Brutal Assault still 9 bands", drop a curl
// against this endpoint with the URL from their journal and the result
// tells us in one shot:
//   • pages 1..N all return 0 → regex broken / page format changed
//   • page 1 returns 9, page 2 timed out → rate-limit or slow page
//   • walker returns 100+ but importer kept 9 → insert path bug
//   • totally different lineup than user expects → wrong event URL
//
// Auth required (so we don't serve random scraping to the world). No
// admin powers needed — just authenticated user.

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { lastfmEventFullLineup } from '@/lib/lastfm';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(request.url).searchParams.get('url') || '';
  if (!url) {
    return NextResponse.json({
      error: 'pass ?url=https://www.last.fm/festival/.../lineup',
    }, { status: 400 });
  }

  // Time the walk so the user knows whether it timed out vs returned
  // few-but-quickly (the latter points at parser; the former at
  // network/throttle).
  // Also probe the URL with the canonical "+ instead of space" form so we
  // know whether the caller passed a raw "festival/N Name" (which Node
  // fetch will %20-encode) vs the "festival/N+Name" form Last.fm itself
  // uses. The walker normalises spaces to + internally, but seeing the
  // raw URL the caller sent is useful diag.
  const urlSpacesNormalised = url.replace(/\s+/g, '+');
  const hadSpaces = url !== urlSpacesNormalised;

  const t0 = Date.now();
  const names = await lastfmEventFullLineup(url, {
    timeoutMs: 10000,
    maxPages:  15,
  });
  const elapsedMs = Date.now() - t0;

  // The walker attaches per-page diagnostics as a non-enumerable
  // __debug property: { trace: [{page, url, status, bytes, raw, fresh}],
  // cleanedBase }. Surface it so a single curl reveals exactly why the
  // walk terminated (rate-limit page 2? regex stopped matching? hit
  // duplicate-only page?).
  const dbg = names && names.__debug ? names.__debug : null;

  return NextResponse.json({
    url,
    urlSpacesNormalised,
    hadSpaces,
    cleanedBase: dbg?.cleanedBase || null,
    total:       names.length,
    elapsedMs,
    pageTrace:   dbg?.trace || [],
    sample:      names.slice(0, 30),
    full:        names,
  });
}
