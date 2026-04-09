import { NextResponse } from 'next/server';

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
  // Discogs titles are "Artist - Album"
  const [rArtist = '', rAlbum = ''] = raw.split(' - ');

  const artistScore  = wordOverlap(rArtist, artist) * 3;
  const albumScore   = wordOverlap(rAlbum,  album)  * 3;
  const fullScore    = wordOverlap(raw, `${artist} ${album}`);
  const yearScore    = result.year ? 1 : 0;
  return artistScore + albumScore + fullScore + yearScore;
}

function extractVinylInfo(result) {
  const formats = result.formats || [];
  const allDesc = formats.flatMap(f => f.descriptions || []).map(d => d.toLowerCase());
  const allText = formats.map(f => (f.text || '').toLowerCase());
  const combined = [...allDesc, ...allText].join(' ');

  const isLimited = combined.includes('limited') || combined.includes('numbered') || combined.includes('promo');

  const COLOR_WORDS = ['black','red','blue','green','clear','white','yellow','orange',
                       'purple','pink','violet','grey','gray','brown','gold','silver',
                       'splatter','marbled','swirl','colored','colour'];
  const colorMatch = COLOR_WORDS.find(c => combined.includes(c));

  // Try to extract copy count from text like "500 copies"
  const copyMatch = combined.match(/(\d{2,5})\s*(copies|copy|pressed|pressing)/);
  const limitedCount = copyMatch ? parseInt(copyMatch[1]) : null;

  return { isLimited, color: colorMatch || null, limitedCount };
}

// ── Main handler ──────────────────────────────────────────────
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const artist = (searchParams.get('artist') || '').trim();
  const album  = (searchParams.get('album')  || '').trim();

  if (!artist && !album) {
    return NextResponse.json({ error: 'Provide artist and/or album' }, { status: 400 });
  }

  const key    = process.env.DISCOGS_KEY;
  const secret = process.env.DISCOGS_SECRET;

  if (!key || !secret) {
    return NextResponse.json(
      { error: 'DISCOGS_KEY / DISCOGS_SECRET not configured in environment variables' },
      { status: 503 }
    );
  }

  const query = `${artist} ${album}`.trim();

  try {
    const res = await fetch(
      `https://api.discogs.com/database/search?q=${encodeURIComponent(query)}&type=release&format=vinyl&per_page=15`,
      {
        headers: {
          Authorization: `Discogs key=${key}, secret=${secret}`,
          'User-Agent': 'MetalVault/1.0 +https://metal-vault.app',
        },
      }
    );

    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json({ error: `Discogs ${res.status}: ${text}` }, { status: res.status });
    }

    const data = await res.json();
    const results = (data.results || []).slice(0, 12);

    // Score and sort
    const scored = results
      .map(r => ({ ...r, _score: scoreResult(r, artist, album), ...extractVinylInfo(r) }))
      .sort((a, b) => b._score - a._score);

    // Build variant summaries
    const variants = scored.map(r => ({
      id: r.id,
      title: r.title,
      thumb: r.thumb || null,
      year: r.year,
      label: r.label?.[0] || null,
      format: r.format?.join(' · ') || 'Vinyl',
      country: r.country || null,
      isLimited: r.isLimited,
      color: r.color,
      limitedCount: r.limitedCount,
      lowestPrice: r.lowest_price || null,
      numForSale: r.num_for_sale || 0,
      community: r.community || null,
      discogsUrl: `https://www.discogs.com/release/${r.id}`,
      score: r._score,
    }));

    const hasLimited = variants.some(v => v.isLimited);
    const hasVinyl   = variants.length > 0;

    return NextResponse.json({
      variants,
      count: variants.length,
      hasVinyl,
      hasLimited,
      bestMatch: variants[0] || null,
    });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
