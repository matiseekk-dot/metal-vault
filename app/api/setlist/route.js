// ── Setlist.fm lookup ─────────────────────────────────────────
// Public free API (https://api.setlist.fm/rest/1.0). Free tier: 16 req/sec.
// Requires API key — set SETLISTFM_API_KEY in env.
//
// Query: ?artist=Gojira&year=2024&city=Warsaw
// Returns: { setlists: [{ id, eventDate, venue, city, songs: [...] }] }

export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabase-server';

const SETLIST_FM = 'https://api.setlist.fm/rest/1.0/search/setlists';
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;  // 7 days — setlists don't change

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const artist = (searchParams.get('artist') || '').trim();
  const year   = (searchParams.get('year')   || '').trim();
  const city   = (searchParams.get('city')   || '').trim();

  if (!artist) return NextResponse.json({ error: 'artist required' }, { status: 400 });

  const apiKey = process.env.SETLISTFM_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ setlists: [], skipped: 'not_configured' });
  }

  const cacheKey = 'sl::' + (artist + '::' + year + '::' + city).toLowerCase().replace(/\s+/g, '_');
  const sb = getAdminClient();

  // Try cache
  try {
    const { data: cached } = await sb
      .from('discogs_cache').select('data, created_at').eq('cache_key', cacheKey).single();
    if (cached?.data && cached.created_at) {
      const age = Date.now() - new Date(cached.created_at).getTime();
      if (age < CACHE_TTL_MS) {
        return NextResponse.json({ setlists: cached.data.setlists || [], cached: true });
      }
    }
  } catch {}

  // Live lookup
  let setlists = [];
  try {
    const params = new URLSearchParams({ artistName: artist, p: '1' });
    if (year) params.set('year', year);
    if (city) params.set('cityName', city);

    const r = await fetch(SETLIST_FM + '?' + params.toString(), {
      headers: {
        'x-api-key': apiKey,
        'Accept': 'application/json',
      },
      signal: AbortSignal.timeout(5000),
    });
    if (!r.ok) {
      // Setlist.fm returns 404 when no matches — treat as empty
      if (r.status === 404) return NextResponse.json({ setlists: [] });
      throw new Error('http_' + r.status);
    }

    const d = await r.json();
    setlists = (d.setlist || []).slice(0, 5).map(s => {
      // Flatten sets[set][song] structure to a single song list
      const allSongs = [];
      for (const set of (s.sets?.set || [])) {
        for (const song of (set.song || [])) {
          if (song.name) allSongs.push(song.name);
        }
      }
      return {
        id:        s.id,
        eventDate: s.eventDate,        // DD-MM-YYYY format from setlist.fm
        venue:     s.venue?.name || '',
        city:      s.venue?.city?.name || '',
        country:   s.venue?.city?.country?.name || '',
        tour:      s.tour?.name || null,
        songs:     allSongs,
        url:       s.url,
      };
    }).filter(s => s.songs.length > 0);

    // Cache
    await sb.from('discogs_cache').upsert(
      { cache_key: cacheKey, data: { setlists }, created_at: new Date().toISOString() },
      { onConflict: 'cache_key' }
    );
  } catch (e) {
    console.warn('setlist.fm lookup error:', e.message);
    return NextResponse.json({ setlists: [], error: e.message });
  }

  return NextResponse.json({ setlists });
}
