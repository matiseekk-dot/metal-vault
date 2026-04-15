export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';

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

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const artist   = (searchParams.get('artist') || '').trim();
  const forcedId = searchParams.get('artist_id') || '';

  if (!artist) return NextResponse.json({ error: 'artist param required' }, { status: 400 });

  const cacheKey = norm(artist);
  const hit = CACHE.get(cacheKey);
  if (hit && Date.now() - hit.ts < TTL) return NextResponse.json(hit.data);

  const token = discogsAuth();
  if (!token) return NextResponse.json({ error: 'Discogs not configured' }, { status: 500 });

  const headers = { ...UA, Authorization: token };

  try {
    // ── Step 1: find Discogs artist ID ──────────────────────────
    let artistId = forcedId;
    let artistName = artist;

    if (!artistId) {
      const sr = await fetch(
        `https://api.discogs.com/database/search?q=${encodeURIComponent(artist)}&type=artist&per_page=8`,
        { headers, cache: 'no-store' }
      );
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
    const relResp = await fetch(
      `https://api.discogs.com/artists/${artistId}/releases?sort=year&sort_order=asc&per_page=100&page=1`,
      { headers, cache: 'no-store' }
    );
    if (!relResp.ok) throw new Error('Releases fetch failed: ' + relResp.status);
    const relData = await relResp.json();

    // ── Step 3: filter to main studio/live albums ───────────────
    // type=master + role=Main = the band's own releases (not appearances)
    // Exclude: singles (format contains "Single"), EPs sometimes
    const albums = (relData.releases || [])
      .filter(r =>
        r.type === 'master' &&
        r.role === 'Main' &&
        !['single','ep'].some(x => (r.format || '').toLowerCase().includes(x))
      )
      .map(r => ({
        id:         String(r.id),                      // master release ID
        title:      r.title || '',
        year:       r.year  || '',
        cover:      r.thumb && !r.thumb.includes('spacer') ? r.thumb : null,
        format:     r.format || 'Album',
        discogsUrl: `https://www.discogs.com/master/${r.id}`,
        normTitle:  norm(r.title),
      }));

    const result = {
      artist:   artistName,
      artistId: String(artistId),
      total:    albums.length,
      albums,
    };

    CACHE.set(cacheKey, { ts: Date.now(), data: result });
    return NextResponse.json(result);

  } catch (e) {
    return NextResponse.json({ error: e.message, artist, albums: [] }, { status: 500 });
  }
}
