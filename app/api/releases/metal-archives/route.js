// ────────────────────────────────────────────────────────────────
// Upcoming releases via MusicBrainz (open, no API key, allows cloud IPs).
// Replaces Metal Archives (Cloudflare-blocked Vercel).
// Route is still /api/releases/metal-archives for backward compat.
//
// TWO QUERY MODES (results are unioned + de-duped by mbid):
//
//   1. Tag-based discovery (always runs):
//      (tag:metal OR tag:black-metal OR ...) AND firstreleasedate:[today TO +9mo]
//      AND (primarytype:Album OR primarytype:EP)
//      Catches anything the crowd has tagged with a metal subgenre.
//
//   2. Per-artist lookup (when ?artists=Anthrax,Mayhem,... is provided):
//      For each followed artist, fire:
//        artist:"NAME" AND firstreleasedate:[today TO +9mo]
//        AND (primarytype:Album OR primarytype:EP)
//      Does NOT depend on tags — catches fresh announcements that
//      haven't been tagged yet (root cause of the "Anthrax August LP
//      missing from feed" bug: MB had the release-group but with no
//      metal tag yet, so tag-mode missed it).
//
// Covers via Cover Art Archive
//   (https://coverartarchive.org/release-group/<mbid>/front-250)
//
// Cache:
//   Shortened from 6h → 30min. Fresh metal announcements are time-
//   sensitive (we want them visible same-day), and MB's own infra
//   already caches at the edge, so we're not hammering them.
// ────────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server';


export const dynamic = 'force-dynamic';

const UA = 'MetalVault/1.0 (https://metal-vault-six.vercel.app)'; // MB requires identifiable UA
const METAL_TAGS = [
  'metal', 'black-metal', 'death-metal', 'thrash-metal', 'doom-metal',
  'heavy-metal', 'power-metal', 'progressive-metal', 'grindcore', 'sludge',
  'stoner-metal', 'folk-metal', 'melodic-death-metal', 'technical-death-metal',
];

const MB_CACHE_SECONDS = 30 * 60;       // 30min — was 6h
// Window: 30 days back, +3 years forward. "Effectively unlimited" forward —
// no real vinyl is announced more than 2 years out. The wide forward window
// catches Q3/Q4 LPs announced in Q1 (Anthrax case) and lets users see
// far-out preorders for whales like Tool or Wintersun.
const WINDOW_BACK_DAYS    = 30;
const WINDOW_FORWARD_YEARS = 3;
const PER_ARTIST_LIMIT = 25;            // bumped — artists like Anthrax have lots of comps/re-issues, real LP can hide
const TAG_QUERY_LIMIT  = 100;
const MAX_ARTISTS      = 100;           // cap parallel artist queries — MB tolerates this fine
                                        // (no auth, edge-cached, our 30min cache absorbs repeats)

function toISO(d) { return d.toISOString().split('T')[0]; }

// MB Lucene escape — quote the value and escape any embedded quotes/backslashes
function escArtist(name) {
  return '"' + String(name).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}

// One MB release-group fetch returning the raw groups array (or []).
async function mbFetchGroups(query, limit) {
  const url = 'https://musicbrainz.org/ws/2/release-group/'
    + '?query=' + encodeURIComponent(query)
    + '&limit=' + limit
    + '&offset=0&fmt=json';
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': UA, 'Accept': 'application/json' },
      next: { revalidate: MB_CACHE_SECONDS },
    });
    if (!r.ok) return { ok: false, status: r.status, groups: [] };
    const data = await r.json();
    return { ok: true, groups: data['release-groups'] || [], totalFound: data.count };
  } catch (e) {
    return { ok: false, status: 0, groups: [], error: e.message };
  }
}

function reshapeGroup(g, today) {
  const mbid       = g.id;
  const artists    = (g['artist-credit'] || []).map(a => a.name || a.artist?.name).filter(Boolean);
  const artistName = artists.join(', ') || 'Unknown';
  const releaseDate = g['first-release-date'] || null;
  const tagNames   = (g.tags || []).map(t => t.name);
  const primaryTag = tagNames.find(t => METAL_TAGS.includes(t)) || tagNames[0] || 'metal';
  const cover      = 'https://coverartarchive.org/release-group/' + mbid + '/front-250';

  return {
    id:             'mb_' + mbid,
    mbid,
    source:         'musicbrainz',
    artist:         artistName,
    album:          g.title || '',
    cover,
    releaseDate,
    releaseDateRaw: releaseDate,
    genre:          primaryTag.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
    preorder:       releaseDate ? new Date(releaseDate) > today : true,
    limited:        false,
    type:           g['primary-type'] || 'Album',
    discogs_url:    'https://musicbrainz.org/release-group/' + mbid,
  };
}

export async function GET(request) {
  try {
    // ── Window: today - 30d  →  today + 3 years ──────────────────
    const today = new Date();
    const past = new Date(today.getTime() - WINDOW_BACK_DAYS * 24 * 60 * 60 * 1000);
    const future = new Date();
    future.setFullYear(future.getFullYear() + WINDOW_FORWARD_YEARS);
    const dateFilter = 'firstreleasedate:[' + toISO(past) + ' TO ' + toISO(future) + ']';
    const typeFilter = '(primarytype:Album OR primarytype:EP)';

    // ── Parse ?artists= param ─────────────────────────────────────
    const artistParam = new URL(request.url).searchParams.get('artists') || '';
    const followedArtists = artistParam
      ? artistParam.split(',').map(a => a.trim()).filter(Boolean).slice(0, MAX_ARTISTS)
      : [];

    // ── Fire all queries in parallel ──────────────────────────────
    // Tag-based always fires; per-artist only if param present.
    const tagQuery = '(' + METAL_TAGS.map(t => 'tag:' + t).join(' OR ') + ')'
      + ' AND ' + dateFilter + ' AND ' + typeFilter;

    const queries = [
      { kind: 'tag', label: 'tag', exec: () => mbFetchGroups(tagQuery, TAG_QUERY_LIMIT) },
      ...followedArtists.map(a => ({
        kind:  'artist',
        label: a,
        exec:  () => mbFetchGroups(
          'artist:' + escArtist(a) + ' AND ' + dateFilter + ' AND ' + typeFilter,
          PER_ARTIST_LIMIT,
        ),
      })),
    ];

    const results = await Promise.all(queries.map(q =>
      q.exec().then(r => ({ ...r, kind: q.kind, label: q.label }))
    ));

    // ── Union + dedup by mbid ─────────────────────────────────────
    const seenMbid = new Set();
    const items = [];
    const debug = { tag: 0, artist: 0, errors: [] };

    for (const r of results) {
      if (!r.ok) {
        debug.errors.push({ kind: r.kind, label: r.label, status: r.status, err: r.error });
        continue;
      }
      for (const g of r.groups) {
        if (!g?.id || seenMbid.has(g.id)) continue;
        seenMbid.add(g.id);
        const item = reshapeGroup(g, today);
        if (!item.artist || !item.album || !item.releaseDate) continue;
        // Only keep items inside the window (30d back → 3y forward)
        const rd = new Date(item.releaseDate);
        if (rd < past || rd > future) continue;
        items.push(item);
        if (r.kind === 'tag') debug.tag++; else debug.artist++;
      }
    }

    // Sort by release date ascending (soonest first)
    items.sort((a, b) => new Date(a.releaseDate) - new Date(b.releaseDate));

    return NextResponse.json({
      items,
      count:  items.length,
      source: 'musicbrainz',
      debug: {
        tagMatches:      debug.tag,
        perArtistMatches: debug.artist,
        artistsQueried:   followedArtists.length,
        queryWindow:      toISO(past) + ' → ' + toISO(future),
        errors:           debug.errors,
      },
    });
  } catch (e) {
    console.error('[MB] error:', e);
    return NextResponse.json({ items: [], error: e.message, count: 0 }, { status: 500 });
  }
}
