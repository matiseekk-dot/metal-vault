import { NextResponse } from 'next/server';
import { getArtistDiscography as mbDiscography } from '@/lib/musicbrainz';


export const dynamic = 'force-dynamic';

const UA = { 'User-Agent': 'MetalVault/1.0 +https://metal-vault-six.vercel.app' };

function discogsAuth() {
  const k = process.env.DISCOGS_KEY, s = process.env.DISCOGS_SECRET, t = process.env.DISCOGS_TOKEN;
  if (k && s) return 'Discogs key=' + k + ', secret=' + s;
  if (t)      return 'Discogs token=' + t;
  return null;
}

// Normalize artist/album name for matching
function norm(str) {
  return String(str || '')
    .toLowerCase()
    .replace(/\s*\(\d+\)$/, '')       // remove "(2)" disambiguation
    .replace(/[^a-z0-9\s]/g, ' ')     // remove punctuation
    .replace(/\s+/g, ' ')
    .trim();
}

// Module-level cache (lives for duration of serverless warm instance)
const CACHE = new Map();
const TTL   = 2 * 60 * 60 * 1000; // 2 hours

// ── MusicBrainz fallback ──────────────────────────────────────
// When Discogs rate-limits us (or fails entirely) we fall back to MB.
// Slower (1 req/sec throttle) but free and no auth. UI still shows the
// discography; we tag the response with `source: 'musicbrainz'` so the
// frontend can display a small note.
async function fallbackToMusicbrainz(artist, vinylOnly) {
  const result = await mbDiscography(artist);
  if (!result?.albums) return null;

  let albums = result.albums.map(a => ({
    id:         a.id,
    title:      a.title,
    year:       a.year,
    cover:      a.cover,
    format:     a.format,
    discogsUrl: a.discogsUrl,           // actually MB URL — same field name keeps UI compatible
    normTitle:  norm(a.title),
  }));

  // vinylOnly is harmless here — MB doesn't track per-format pressings
  // at the release-group level. We pass everything through.
  if (vinylOnly) {
    // No filtering possible without N more MB calls; return as-is.
  }

  return {
    artist:    result.name || artist,
    artistId:  result.mbid,
    total:     albums.length,
    albums,
    source:   'musicbrainz',
    note:     'Discogs rate-limited — using MusicBrainz catalog',
  };
}

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const artist    = (searchParams.get('artist') || '').trim();
  const forcedId  = searchParams.get('artist_id') || '';
  const vinylOnly = searchParams.get('vinyl') === '1'; // filter to vinyl pressings only

  if (!artist) return NextResponse.json({ error: 'artist param required' }, { status: 400 });

  const cacheKey = norm(artist);
  const hit = CACHE.get(cacheKey);
  if (hit && Date.now() - hit.ts < TTL) return NextResponse.json(hit.data);

  const token = discogsAuth();
  if (!token) return NextResponse.json({ error: 'Discogs not configured' }, { status: 500 });

  const headers = { ...UA, Authorization: token };

  // Sentinel error class: when Discogs is rate-limited we throw this
  // so the outer catch can swap in MusicBrainz instead of bubbling 500
  // to the client.
  class RateLimited extends Error { constructor(msg) { super(msg); this.code = 'RATE_LIMITED'; } }

  try {
    // ── Step 1: find Discogs artist ID ──────────────────────────
    let artistId = forcedId;
    let artistName = artist;

    if (!artistId) {
      // Retry up to 2 times with backoff for rate limiting
      let sr, attempts = 0;
      while (attempts < 3) {
        sr = await fetch(
          `https://api.discogs.com/database/search?q=${encodeURIComponent(artist)}&type=artist&per_page=8`,
          { headers, cache: 'no-store' }
        );
        if (sr.status === 429) {
          attempts++;
          if (attempts < 3) await new Promise(r => setTimeout(r, 1200 * attempts));
          else throw new RateLimited('Discogs rate limited');
        } else break;
      }
      if (!sr.ok) throw new Error('Discogs search failed: ' + sr.status);
      const sd = await sr.json();

      // Prefer exact match, fall back to first result
      const normArtist = norm(artist);
      const exact = sd.results?.find(r => norm(r.title) === normArtist);
      const match = exact || sd.results?.[0];
      if (!match) return NextResponse.json({ artist, albums: [], notFound: true });
      artistId   = match.id;
      artistName = match.title || artist;
    }

    // ── Step 2: fetch artist releases (all pages up to 100) ─────
    let relResp, relAttempts = 0;
    while (relAttempts < 3) {
      relResp = await fetch(
        `https://api.discogs.com/artists/${artistId}/releases?sort=year&sort_order=asc&per_page=100&page=1`,
        { headers, cache: 'no-store' }
      );
      if (relResp.status === 429) {
        relAttempts++;
        if (relAttempts < 3) await new Promise(r => setTimeout(r, 1200 * relAttempts));
        else throw new RateLimited('Discogs rate limited');
      } else break;
    }
    if (!relResp.ok) throw new Error('Releases fetch failed: ' + relResp.status);
    const relData = await relResp.json();

    // ── Step 3: filter to main studio/live albums ───────────────
    // type=master + role=Main = the band's own releases (not appearances)
    // Exclude: singles (format contains "Single"), EPs sometimes
    // Formats we WANT: Album, Live (studio + live albums only)
    // Formats we SKIP: Single, EP, Compilation, Video, Unofficial, DJ-mix, etc.
    const WANTED_FORMATS  = ['album', 'live'];
    const BLOCKED_FORMATS = ['single', 'ep', 'compilation', 'video', 'unofficial',
                             'dj-mix', 'mixtape', 'interview', 'soundtrack', 'box set'];

    // Title patterns that indicate singles/EPs even when format is missing
    const BLOCKED_TITLE_PATTERNS = [
      /\bsingle\b/i, /\bep\b/i, /\b7"\b/, /\b7inch\b/i,
      /\bpromo\b/i, /\bflexidisc\b/i, /\bpicture disc single\b/i,
    ];

    const albums = (relData.releases || [])
      .filter(r => {
        if (r.type !== 'master') return false;
        if (r.role !== 'Main')   return false;
        const fmt   = (r.format || '').toLowerCase();
        const title = (r.title  || '').toLowerCase();

        // Block by format
        const isBlocked = BLOCKED_FORMATS.some(f => fmt.includes(f));
        if (isBlocked) return false;

        // Block by title pattern (catches singles with empty format)
        if (BLOCKED_TITLE_PATTERNS.some(p => p.test(title))) return false;

        // Must match a wanted format OR format is empty/unknown (assume album)
        const isWanted = !fmt || WANTED_FORMATS.some(f => fmt.includes(f));
        return isWanted;
      })
      .map(r => ({
        id:         String(r.id),                      // master release ID
        title:      r.title || '',
        year:       r.year  || '',
        cover:      r.thumb && !r.thumb.includes('spacer') ? r.thumb : null,
        format:     r.format || 'Album',
        discogsUrl: `https://www.discogs.com/master/${r.id}`,
        normTitle:  norm(r.title),
      }));

    // vinyl=1 param: only include releases that likely have vinyl
    // We can't know for sure without fetching each release, so filter by format hint
    const filteredAlbums = vinylOnly
      ? albums.filter(a => {
          const f = (a.format || '').toLowerCase();
          // Include if format mentions vinyl, or format is empty/Album (assume vinyl exists)
          // Exclude if format explicitly says CD/DVD/digital/cassette only
          const isDigitalOnly = ['cd', 'dvd', 'digital', 'cassette', 'mp3', 'flac'].some(x => f.includes(x));
          return !isDigitalOnly;
        })
      : albums;

    const result = {
      artist:   artistName,
      artistId: String(artistId),
      total:    filteredAlbums.length,
      albums:   filteredAlbums,
    };

    CACHE.set(cacheKey, { ts: Date.now(), data: result });
    return NextResponse.json(result);

  } catch (e) {
    // Rate-limited? Try MusicBrainz instead — slower (1 req/sec hard
    // throttle on their side) but free, no auth, and covers the metal
    // catalog very well. Other Discogs errors bubble up so the user
    // sees the actual problem rather than a misleading "MB result".
    if (e.code === 'RATE_LIMITED') {
      const mb = await fallbackToMusicbrainz(artist, vinylOnly);
      if (mb) {
        // Cache the MB result with a shorter TTL so we go back to
        // Discogs sooner once the rate window resets.
        CACHE.set(cacheKey, { ts: Date.now() - (TTL - 15 * 60 * 1000), data: mb });
        return NextResponse.json(mb);
      }
      return NextResponse.json({
        error: 'Discogs rate-limited and MusicBrainz returned nothing.',
        artist, albums: [],
      }, { status: 503 });
    }
    return NextResponse.json({ error: e.message, artist, albums: [] }, { status: 500 });
  }
}
