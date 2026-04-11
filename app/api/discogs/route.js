export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabase-server';

// ── Helpers ───────────────────────────────────────────────────
function wordOverlap(a, b) {
  const sa = new Set(a.toLowerCase().split(/\W+/).filter(w => w.length > 2));
  const sb = new Set(b.toLowerCase().split(/\W+/).filter(w => w.length > 2));
  let count = 0;
  for (const w of sa) if (sb.has(w)) count++;
  return count;
}

function scoreResult(result, artist, album) {
  const raw = result.title || '';
  const [rArtist = '', rAlbum = ''] = raw.split(' - ');
  return wordOverlap(rArtist, artist) * 3
       + wordOverlap(rAlbum,  album)  * 3
       + wordOverlap(raw, `${artist} ${album}`)
       + (result.year ? 1 : 0);
}

function extractVinylInfo(result) {
  const formats  = result.formats || [];
  const combined = [
    ...formats.flatMap(f => f.descriptions || []),
    ...formats.map(f => f.text || ''),
  ].join(' ').toLowerCase();

  const COLOR_WORDS = ['black','red','blue','green','clear','white','yellow','orange',
    'purple','pink','violet','grey','gray','brown','gold','silver',
    'splatter','marbled','swirl','colored','colour'];

  const copyMatch = combined.match(/(\d{2,5})\s*(copies|copy|pressed|pressing)/);

  return {
    isLimited:    combined.includes('limited') || combined.includes('numbered'),
    color:        COLOR_WORDS.find(c => combined.includes(c)) || null,
    limitedCount: copyMatch ? parseInt(copyMatch[1]) : null,
  };
}

function buildResponse(results, artist, album) {
  const scored = results
    .map(r => ({ ...r, _score: scoreResult(r, artist, album), ...extractVinylInfo(r) }))
    .sort((a, b) => b._score - a._score);

  const variants = scored.map(r => ({
    id:           r.id,
    title:        r.title,
    thumb:        r.thumb || null,
    year:         r.year,
    label:        r.label?.[0] || null,
    format:       r.format?.join(' · ') || 'Vinyl',
    country:      r.country || null,
    isLimited:    r.isLimited,
    color:        r.color,
    limitedCount: r.limitedCount,
    lowestPrice:  r.lowest_price || null,
    numForSale:   r.num_for_sale || 0,
    discogsUrl:   `https://www.discogs.com/release/${r.id}`,
    score:        r._score,
  }));

  return {
    variants,
    count:      variants.length,
    hasVinyl:   variants.length > 0,
    hasLimited: variants.some(v => v.isLimited),
    bestMatch:  variants[0] || null,
    cached:     false,
  };
}

// ── Cache helpers ─────────────────────────────────────────────
async function cacheGet(key) {
  try {
    const sb = getAdminClient();
    const { data } = await sb
      .from('discogs_cache')
      .select('data, expires_at')
      .eq('cache_key', key)
      .single();

    if (!data) return null;
    if (new Date(data.expires_at) < new Date()) {
      // Expired — delete and return null
      await sb.from('discogs_cache').delete().eq('cache_key', key);
      return null;
    }
    return data.data;
  } catch {
    return null; // cache miss on any error
  }
}

async function cacheSet(key, value) {
  try {
    const sb = getAdminClient();
    await sb.from('discogs_cache').upsert(
      {
        cache_key:  key,
        data:       value,
        created_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      },
      { onConflict: 'cache_key' }
    );
  } catch {
    // Cache write failure is non-fatal — continue without caching
  }
}

// ── Main handler ──────────────────────────────────────────────
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const artist = (searchParams.get('artist') || '').trim();
  const album  = (searchParams.get('album')  || '').trim();
  const rawQ   = (searchParams.get('q')      || '').trim();

  if (!artist && !album && !rawQ) {
    return NextResponse.json({ error: 'Provide artist, album, or q' }, { status: 400 });
  }

  // Support both DISCOGS_KEY+SECRET and legacy DISCOGS_TOKEN
  const key    = process.env.DISCOGS_KEY;
  const secret = process.env.DISCOGS_SECRET;
  const token  = process.env.DISCOGS_TOKEN;

  if (!key && !token) {
    return NextResponse.json(
      { error: 'Configure DISCOGS_KEY + DISCOGS_SECRET (or DISCOGS_TOKEN) in Vercel → Environment Variables' },
      { status: 503 }
    );
  }

  const authHeader = key && secret
    ? `Discogs key=${key}, secret=${secret}`
    : `Discogs token=${token}`;

  const cacheKey = rawQ
    ? `search::${rawQ.toLowerCase()}`
    : `${artist.toLowerCase()}::${album.toLowerCase()}`;

  // ── 1. Try cache first ────────────────────────────────────
  const cached = await cacheGet(cacheKey);
  if (cached) {
    return NextResponse.json({ ...cached, cached: true });
  }

  // ── 2. Fetch from Discogs ─────────────────────────────────
  try {
    const query = rawQ || `${artist} ${album}`.trim();
    const res = await fetch(
      `https://api.discogs.com/database/search?q=${encodeURIComponent(query)}&type=release&format=vinyl&per_page=15`,
      {
        headers: {
          Authorization: authHeader,
          'User-Agent': 'MetalVault/1.0 +https://metal-vault.app',
        },
      }
    );

    if (!res.ok) {
      const text = await res.text();
      // On rate limit — return cached stale data if available, else error
      if (res.status === 429) {
        return NextResponse.json(
          { error: 'Discogs rate limit hit. Try again in a minute.', status: 429 },
          { status: 429 }
        );
      }
      return NextResponse.json({ error: `Discogs ${res.status}: ${text}` }, { status: res.status });
    }

    const data    = await res.json();
    const results = (data.results || []).slice(0, 12);
    const payload = buildResponse(results, artist, album);

    // ── 3. Store in cache ───────────────────────────────────
    await cacheSet(cacheKey, payload);

    return NextResponse.json(payload);
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
