// ── Unified search API ────────────────────────────────────────
//
// GET /api/search?q=<query>&type=auto|albums|artists|members
//
// Aggregates three sources:
//   • Discogs (authenticated) — albums with covers, year, format
//   • MusicBrainz — artists, plus member-of-band relations
//   • Last.fm (optional) — bio/similar/tags when `type=artists`
//
// Why a single endpoint instead of three? UI shows mixed results in one
// scrollable list, and clients shouldn't fan out to three providers
// themselves (CORS, rate limits, auth).
//
// Caching: 1h Vercel edge cache for hot queries (Cache-Control header).
// Per-user rate-limited to 30 req/min via lib/rate-limit.

import { NextResponse } from 'next/server';
import { rateLimit } from '@/lib/rate-limit';
import { searchArtist as mbSearchArtist, getArtistRelations } from '@/lib/musicbrainz';
import { findCoverByArtistAlbum } from '@/lib/coverart';

export const dynamic = 'force-dynamic';

// ── Discogs auth header ───────────────────────────────────────
function discogsAuth() {
  const key    = process.env.DISCOGS_KEY;
  const secret = process.env.DISCOGS_SECRET;
  const token  = process.env.DISCOGS_TOKEN;
  if (key && secret) return `Discogs key=${key}, secret=${secret}`;
  if (token)         return `Discogs token=${token}`;
  return null;
}

const DISCOGS_UA = 'MetalVault/1.0 +https://metal-vault-six.vercel.app';

// ── Discogs album search ──────────────────────────────────────
// Returns album results with cover URLs. We use `cover_image` (full-size)
// when available, falling back to `thumb` (150x150) — anonymous users only
// get the thumb, but with auth Discogs returns both.
async function searchAlbumsDiscogs(query) {
  const auth = discogsAuth();
  if (!auth) return { items: [], error: 'Discogs not configured' };
  try {
    const url = `https://api.discogs.com/database/search?q=${encodeURIComponent(query)}&type=release&format=vinyl&per_page=15`;
    const res = await fetch(url, {
      headers: { Authorization: auth, 'User-Agent': DISCOGS_UA },
      // 1h shared cache — Discogs results don't change often for a given query
      next: { revalidate: 3600 },
    });
    if (!res.ok) return { items: [], error: `Discogs ${res.status}` };
    const d = await res.json();
    const items = (d.results || []).slice(0, 12).map(r => {
      const parts = (r.title || '').split(' - ');
      return {
        kind:   'album',
        id:     r.id,
        artist: parts[0]?.trim() || r.title,
        album:  parts.slice(1).join(' - ').trim() || '',
        cover:  r.cover_image || r.thumb || null,
        year:   r.year || null,
        format: (r.format || []).join(', '),
        country: r.country || null,
        source: 'discogs',
      };
    });
    return { items };
  } catch (e) {
    return { items: [], error: e.message };
  }
}

// ── MusicBrainz artist search ─────────────────────────────────
// Returns artists. For each artist with a non-trivial result (score > 70),
// we leave member resolution for the dedicated `/related` endpoint —
// fetching relations for every search result would explode the MB request
// budget (1 req/sec hard limit).
async function searchArtistsMb(query) {
  const artists = await mbSearchArtist(query, 6);
  return artists
    .filter(a => a.score >= 50)            // skip junk matches
    .map(a => ({
      kind:           'artist',
      mbid:           a.mbid,
      name:           a.name,
      type:           a.type || 'Group',   // 'Group' or 'Person'
      country:        a.country,
      disambiguation: a.disambiguation,
      tags:           a.tags.slice(0, 5),
      lifeSpan:       a.lifeSpan,
      score:          a.score,
      source:         'musicbrainz',
    }));
}

// ── Member search ─────────────────────────────────────────────
// User typed "Mikael Åkerfeldt" → find them as a Person, then pull bands.
// For the search list view we only need the Person + a count of bands;
// the full list comes from /api/artists/[name]/related.
async function searchMembers(query) {
  const artists = await mbSearchArtist(query, 4);
  // Only keep `Person` type results — for member search we don't care about
  // bands matching by name, just people whose name matches.
  const persons = artists.filter(a => a.type === 'Person' && a.score >= 60);
  if (persons.length === 0) return [];

  // For the top match, eagerly resolve their bands (single MB call).
  // Subsequent matches show without bands until clicked.
  const top = persons[0];
  const rels = await getArtistRelations(top.mbid);
  const bandsList = rels?.bands || [];

  return [
    {
      kind:           'member',
      mbid:           top.mbid,
      name:           top.name,
      disambiguation: top.disambiguation,
      country:        top.country,
      bandCount:      bandsList.length,
      // First 4 bands inline; rest via /related endpoint when expanded
      previewBands:   bandsList.slice(0, 4).map(b => ({
        mbid:    b.mbid,
        name:    b.name,
        roles:   b.roles,
        active:  b.active,
        begin:   b.begin,
        end:     b.end,
      })),
      source: 'musicbrainz',
    },
    // Keep up to 2 alternate persons (e.g. same name, different person)
    ...persons.slice(1, 3).map(p => ({
      kind:           'member',
      mbid:           p.mbid,
      name:           p.name,
      disambiguation: p.disambiguation,
      country:        p.country,
      bandCount:      null,                 // unknown without follow-up call
      previewBands:   [],
      source:         'musicbrainz',
    })),
  ];
}

// ── Cover Art Archive fallback for albums without covers ──────
// Runs in parallel for up to 3 albums missing covers. We cap to limit MB
// request budget — anything more than 3 makes search slow.
async function fillMissingCovers(albums) {
  const missing = albums.filter(a => !a.cover).slice(0, 3);
  if (missing.length === 0) return albums;
  const fills = await Promise.all(
    missing.map(async a => {
      const url = await findCoverByArtistAlbum(a.artist, a.album, 250);
      return [a.id, url];
    })
  );
  const fillMap = new Map(fills);
  return albums.map(a => fillMap.has(a.id) ? { ...a, cover: fillMap.get(a.id) || a.cover, coverFallback: 'caa' } : a);
}

// ── Main handler ──────────────────────────────────────────────
export async function GET(req) {
  // Per-user rate limit: 30 req/min. Member search hits MB which is 1 req/sec
  // global — without a limit one user could starve everyone else.
  const rl = rateLimit(req, { max: 30, windowMs: 60_000 });
  if (!rl.ok) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }

  const { searchParams } = new URL(req.url);
  const q    = (searchParams.get('q') || '').trim();
  const type = (searchParams.get('type') || 'auto').toLowerCase();

  if (q.length < 2) {
    return NextResponse.json({ q, albums: [], artists: [], members: [] });
  }

  // Run providers in parallel where possible.
  const tasks = [];
  if (type === 'auto' || type === 'albums')  tasks.push(searchAlbumsDiscogs(q).then(r => ({ albums: r.items, albumsError: r.error })));
  if (type === 'auto' || type === 'artists') tasks.push(searchArtistsMb(q).then(items => ({ artists: items })));
  if (type === 'auto' || type === 'members') tasks.push(searchMembers(q).then(items => ({ members: items })));

  const results = await Promise.all(tasks);
  const merged = Object.assign({ albums: [], artists: [], members: [] }, ...results);

  // Cover Art Archive fallback only when albums asked AND we have at least
  // one album without a cover. Keeps response fast for queries with full
  // Discogs coverage.
  if ((type === 'auto' || type === 'albums') && merged.albums.length > 0) {
    merged.albums = await fillMissingCovers(merged.albums);
  }

  return NextResponse.json(
    { q, ...merged },
    {
      headers: {
        // Edge cache for 1 hour, stale-while-revalidate for 1 day. This is
        // safe — we'd rather serve a slightly stale cover than burn the MB
        // request budget for every refresh.
        'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
      },
    }
  );
}
