// ── /api/concerts/debug-events — what does LFM actually return? ──
//
// When the user reports "import gives 0 events", we need to see EXACTLY
// what Last.fm responds with on their archive pages. The full importer
// does too much (Supabase queries, dedup, density, downgrade passes,
// festival lineup walks) and tends to 504 on Vercel before producing
// any visible output.
//
// This endpoint does the bare minimum:
//   1. read the user's lastfm_tokens.username
//   2. fetch a SINGLE user-events page (year passed as ?year=YYYY,
//      defaults to current year)
//   3. run parseLastfmHtmlEvents on it
//   4. return the count, sample events, and the diagnostic htmlProbe
//
// No DB writes. No festival walking. No timeouts. Fast.
// Auth required (don't expose scraping endpoint to the world).

import { NextResponse } from 'next/server';
import { createClient, getAdminClient } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const LFM_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36';

export async function GET(request) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = getAdminClient();
  const { data: lfmTok } = await admin
    .from('lastfm_tokens')
    .select('username')
    .eq('user_id', user.id)
    .maybeSingle();
  const username = lfmTok?.username;
  if (!username) {
    return NextResponse.json({ error: 'Last.fm not connected' }, { status: 400 });
  }

  const year = new URL(request.url).searchParams.get('year') || String(new Date().getFullYear());

  const url = 'https://www.last.fm/user/' + encodeURIComponent(username) + '/events'
    + (year === 'upcoming' ? '' : '/' + year);

  const t0 = Date.now();
  let res, fetchErr = null;
  try {
    res = await fetch(url, {
      headers: { 'User-Agent': LFM_UA, 'Accept': 'text/html' },
      signal:  AbortSignal.timeout(8000),
    });
  } catch (e) {
    fetchErr = (e && e.message) || String(e);
  }
  const elapsedMs = Date.now() - t0;

  if (fetchErr) {
    return NextResponse.json({ url, elapsedMs, fetchErr });
  }

  const html = await res.text().catch(() => '');

  // Same probe shape as the in-import diag — confirms whether the
  // page has the markers we expect.
  const probe = {
    status:        res.status,
    contentType:   res.headers.get('content-type'),
    bytes:         html.length,
    hasListItem:   /events-list-item/.test(html),
    hasTrWrapper:  /<tr[^>]*class="[^"]*\bevents-list-item\b/i.test(html),
    hasDivWrapper: /<div[^>]*class="[^"]*\bevents-list-item\b/i.test(html),
    hasTimeTag:    /<time[^>]+datetime="/i.test(html),
    hasJsonLd:     /application\/ld\+json/.test(html),
    hasConsentRx:  /consent|gdpr|sign in|sign up|enable javascript/i.test(html),
    titleSnippet:  (html.match(/<title>([^<]+)<\/title>/i) || [, ''])[1].slice(0, 200),
    itemSnippet:   (() => {
      const m = html.match(/events-list-item[\s\S]{0,500}/);
      return m ? m[0] : null;
    })(),
  };

  // Best-effort parse using the live parser. If this returns 0 but
  // probe.hasListItem is true, the parser broke.
  let parsedCount = 0;
  let parsedSample = [];
  try {
    const mod = await import('@/lib/lastfm');
    if (typeof mod.parseLastfmHtmlEvents === 'function') {
      const events = mod.parseLastfmHtmlEvents(html, '');
      parsedCount = events.length;
      parsedSample = events.slice(0, 3).map(e => ({
        datetime: e.datetime, title: e.title, venue: e.venue,
        lineup: (e.lineup || []).slice(0, 5),
      }));
    } else {
      parsedSample = ['parseLastfmHtmlEvents not exported'];
    }
  } catch (e) {
    parsedSample = ['parser threw: ' + (e?.message || String(e))];
  }

  return NextResponse.json({
    url, year, elapsedMs, probe, parsedCount, parsedSample,
  });
}
