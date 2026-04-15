export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';

function discogsAuth() {
  const key = process.env.DISCOGS_KEY;
  const secret = process.env.DISCOGS_SECRET;
  const token = process.env.DISCOGS_TOKEN;
  if (key && secret) return 'Discogs key=' + key + ', secret=' + secret;
  if (token) return 'Discogs token=' + token;
  return null;
}

const HEADERS = { 'User-Agent': 'MetalVault/1.0 +https://metal-vault-six.vercel.app' };

const MOCK = [
  {id:'m1',artist:'Opeth',album:'The Last Will and Testament',cover:null,releaseDate:'2024-11-01',genre:'Progressive Metal',preorder:false},
  {id:'m2',artist:'Knocked Loose',album:"You Won't Go Before You're Supposed To",cover:null,releaseDate:'2024-05-10',genre:'Metalcore',preorder:false},
  {id:'m3',artist:'Ghost',album:'Skeleta',cover:null,releaseDate:'2025-03-07',genre:'Heavy Metal',preorder:false},
  {id:'m4',artist:'Mastodon',album:'The Toilet of Venus',cover:null,releaseDate:'2025-01-10',genre:'Progressive Metal',preorder:false},
  {id:'m5',artist:'Darkthrone',album:'It Beckons Us All',cover:null,releaseDate:'2024-03-22',genre:'Black Metal',preorder:false},
  {id:'m6',artist:'Gojira',album:'Fortitude',cover:null,releaseDate:'2021-04-30',genre:'Death Metal',preorder:false},
  {id:'m7',artist:'Rammstein',album:'Zeit',cover:null,releaseDate:'2022-04-29',genre:'Industrial Metal',preorder:false},
  {id:'m8',artist:'Cannibal Corpse',album:'Chaos Horrific',cover:null,releaseDate:'2023-09-22',genre:'Death Metal',preorder:false},
];

// Fetch full release details to get proper date
async function getReleaseFull(id, auth) {
  try {
    const r = await fetch('https://api.discogs.com/releases/' + id, {
      headers: { ...HEADERS, Authorization: auth },
      cache: 'no-store',
    });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

export async function GET() {
  const auth = discogsAuth();
  if (!auth) return NextResponse.json({ releases: MOCK, source: 'mock', notice: 'DISCOGS_TOKEN not configured' });

  try {
    const today = new Date();
    const currentYear = today.getFullYear();
    const lastYear = currentYear - 1;

    // Search for new metal vinyl releases from this year and last
    const fetches = [
      // This year
      fetch(`https://api.discogs.com/database/search?type=release&format=Vinyl&style=Heavy+Metal&year=${currentYear}&sort=date_added&sort_order=desc&per_page=25&page=1`,
        { headers: { ...HEADERS, Authorization: auth }, cache: 'no-store' }),
      fetch(`https://api.discogs.com/database/search?type=release&format=Vinyl&style=Death+Metal&year=${currentYear}&sort=date_added&sort_order=desc&per_page=25&page=1`,
        { headers: { ...HEADERS, Authorization: auth }, cache: 'no-store' }),
      fetch(`https://api.discogs.com/database/search?type=release&format=Vinyl&style=Black+Metal&year=${currentYear}&sort=date_added&sort_order=desc&per_page=25&page=1`,
        { headers: { ...HEADERS, Authorization: auth }, cache: 'no-store' }),
      // Last year
      fetch(`https://api.discogs.com/database/search?type=release&format=Vinyl&style=Thrash+Metal&year=${lastYear}&sort=date_added&sort_order=desc&per_page=15&page=1`,
        { headers: { ...HEADERS, Authorization: auth }, cache: 'no-store' }),
      fetch(`https://api.discogs.com/database/search?type=release&format=Vinyl&style=Progressive+Metal&year=${lastYear}&sort=date_added&sort_order=desc&per_page=15&page=1`,
        { headers: { ...HEADERS, Authorization: auth }, cache: 'no-store' }),
    ];

    const responses = await Promise.all(fetches);
    const seen = new Set();
    const rawItems = [];

    for (const resp of responses) {
      if (!resp.ok) continue;
      const data = await resp.json();
      for (const item of (data.results || [])) {
        const parts = (item.title || '').split(' - ');
        const artist = parts[0]?.trim();
        const album = parts.slice(1).join(' - ').replace(/\s*\(\d{4}\)$/, '').trim();
        if (!artist || !album) continue;
        const key = artist + '::' + album;
        if (seen.has(key)) continue;
        seen.add(key);
        rawItems.push({ id: String(item.id), artist, album, item });
      }
    }

    // Fetch full details for top 40 to get proper dates (parallel, rate limit friendly)
    const top40 = rawItems.slice(0, 40);
    const detailed = await Promise.all(
      top40.map(async ({ id, artist, album, item }) => {
        const full = await getReleaseFull(id, auth);
        const released = full?.released || full?.released_formatted || '';
        // Parse various formats: "2026-03-15", "15 Mar 2026", "2026"
        let releaseDate = '';
        if (released.match(/^\d{4}-\d{2}-\d{2}$/)) {
          releaseDate = released;
        } else if (released.match(/^\d{4}-\d{2}$/)) {
          releaseDate = released + '-01';
        } else if (released.match(/^\d{4}$/)) {
          releaseDate = released + '-01-01';
        } else if (released.match(/\d{1,2}\s+\w+\s+\d{4}/)) {
          const d = new Date(released);
          if (!isNaN(d)) releaseDate = d.toISOString().split('T')[0];
        }

        const isPreorder = releaseDate ? new Date(releaseDate) > new Date() : false;
        const cover = item.cover_image && !item.cover_image.includes('spacer') ? item.cover_image : null;
        const genre = full?.styles?.[0] || full?.genres?.[0] || item.style?.[0] || item.genre?.[0] || 'Metal';
        const isLimited = (full?.formats || item.format || []).some(f =>
          typeof f === 'string' ? f.includes('Limited') : (f.descriptions || []).some(d => d.includes('Limited'))
        );

        return {
          id,
          artist: full?.artists?.[0]?.name?.replace(/\s*\(\d+\)$/, '') || artist,
          album: full?.title || album,
          cover,
          releaseDate,
          genre,
          preorder: isPreorder,
          limited: isLimited,
          label: full?.labels?.[0]?.name || item.label?.[0] || '',
          country: full?.country || item.country || '',
          discogsUrl: 'https://www.discogs.com/release/' + id,
          spotifyUrl: '',
        };
      })
    );

    const results = detailed.filter(r => r.artist && r.album);
    if (!results.length) throw new Error('No results from Discogs');

    // Sort: preorders first, then by date desc
    results.sort((a, b) => {
      if (a.preorder && !b.preorder) return -1;
      if (!a.preorder && b.preorder) return 1;
      if (!a.releaseDate) return 1;
      if (!b.releaseDate) return -1;
      return b.releaseDate.localeCompare(a.releaseDate);
    });

    return NextResponse.json({ releases: results, source: 'discogs', count: results.length });

  } catch (e) {
    return NextResponse.json({ releases: MOCK, source: 'mock', notice: e.message });
  }
}
