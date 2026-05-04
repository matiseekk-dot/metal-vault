// ── Unified search API ────────────────────────────────────────
//
// GET /api/search?q=<query>&type=auto|albums|artists|members
//
// Aggregates two sources at search time:
//   • Discogs (authenticated) — albums with covers, year, format
//   • MusicBrainz — artists, plus people whose name matches
//
// Heavy follow-ups (member-of-band relations, Last.fm bio, Cover Art
// Archive cover fallback) are intentionally NOT done here — they multiply
// latency by 3-5×. The frontend resolves them lazily per-card:
//   • Member card expand → /api/artists/related (gets full bands list)
//   • Album row missing cover → /api/cover-fallback (CAA lookup)
// This keeps the search response under ~1.5s typical (Discogs is ~200ms,
// one MB throttled call is ~1s).
//
// Caching: 1h Vercel edge cache for hot queries (Cache-Control header).
// Per-user rate-limited to 30 req/min via lib/rate-limit.

import { NextResponse } from 'next/server';
import { rateLimit } from '@/lib/rate-limit';
import { searchArtist as mbSearchArtist } from '@/lib/musicbrainz';

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

// ── MusicBrainz artist + member search (single call) ──────────
// Both "artist" results (bands) and "member" results (persons) come from
// the same MB endpoint — we just split by `type`. Doing this in ONE MB
// call instead of two halves the worst-case search latency. Threshold
// lowered to 30 (was 50/60) so partial / misspelled queries still match.
async function searchArtistsAndMembers(query) {
  const all = mbFuzzyHelper(query);
  const artists = await mbSearchArtist(all, 12);

  const groups  = artists.filter(a => a.type !== 'Person' && a.score >= 30);
  const persons = artists.filter(a => a.type === 'Person' && a.score >= 30);

  return {
    artists: groups.slice(0, 6).map(a => ({
      kind:           'artist',
      mbid:           a.mbid,
      name:           a.name,
      type:           a.type || 'Group',
      country:        a.country,
      disambiguation: a.disambiguation,
      tags:           a.tags.slice(0, 5),
      lifeSpan:       a.lifeSpan,
      score:          a.score,
      source:         'musicbrainz',
    })),
    // Members: just metadata. The full band list is fetched lazily by
    // MemberCard when the user expands it. This cuts ~1s off the first
    // search response since we no longer eagerly fetch relations.
    members: persons.slice(0, 4).map(p => ({
      kind:           'member',
      mbid:           p.mbid,
      name:           p.name,
      disambiguation: p.disambiguation,
      country:        p.country,
      bandCount:      null,                       // resolved on expand
      previewBands:   [],
      score:          p.score,
      source:         'musicbrainz',
    })),
  };
}

// ── Build a fuzzy-ish MB query ────────────────────────────────
// MB uses Lucene query syntax. Bare names are case-sensitive token
// matches — bad UX. Wrapping each token with `~` enables fuzzy matching
// (~1 edit distance per token), which gracefully handles diacritics,
// transliterations, and typos ("akerfeldt" → "Åkerfeldt").
function mbFuzzyHelper(q) {
  const trimmed = q.trim();
  if (!trimmed) return trimmed;
  // For very short queries (<= 2 chars) skip fuzzy — the noise floor is
  // too high and MB returns junk.
  if (trimmed.length <= 2) return trimmed;
  const tokens = trimmed.split(/\s+/).filter(Boolean);
  // Don't fuzz quoted phrases or already-Lucene-style queries.
  if (trimmed.includes('"') || /[:~^*]/.test(trimmed)) return trimmed;
  return tokens.map(t => t.length >= 4 ? t + '~' : t).join(' ');
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

  // Run Discogs + MB in parallel. The MB call returns both artists
  // (bands) and members (persons) from a single request, halving MB
  // request budget vs. the old two-call approach.
  const wantAlbums    = (type === 'auto' || type === 'albums');
  const wantArtistsMb = (type === 'auto' || type === 'artists' || type === 'members');

  const [albumsRes, mbRes] = await Promise.all([
    wantAlbums    ? searchAlbumsDiscogs(q)         : Promise.resolve({ items: [] }),
    wantArtistsMb ? searchArtistsAndMembers(q)     : Promise.resolve({ artists: [], members: [] }),
  ]);

  const merged = {
    albums:  albumsRes.items || [],
    artists: type === 'members' ? [] : (mbRes.artists || []),
    members: type === 'artists' ? [] : (mbRes.members || []),
  };

  // CAA cover fallback removed from this endpoint — used to add up to 3s
  // of latency. Frontend now lazy-loads CAA per-card via /api/cover-fallback
  // when the Discogs cover errors / is missing.

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
