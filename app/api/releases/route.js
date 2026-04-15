export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';

const UA = { 'User-Agent': 'MetalVault/1.0 +https://metal-vault-six.vercel.app' };

function auth() {
  const k = process.env.DISCOGS_KEY, s = process.env.DISCOGS_SECRET, t = process.env.DISCOGS_TOKEN;
  if (k && s) return 'Discogs key=' + k + ', secret=' + s;
  if (t)      return 'Discogs token=' + t;
  return null;
}

function parseDate(str) {
  if (!str) return '';
  const s = String(str).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (/^\d{4}-\d{2}$/.test(s))        return s + '-01';
  if (/^\d{4}$/.test(s))              return '';  // year-only → not reliable for preorder
  // "15 Apr 2026" or "Apr 2026"
  const d = new Date(s);
  if (!isNaN(d)) return d.toISOString().split('T')[0];
  return '';
}

async function getDetail(id, token) {
  try {
    const r = await fetch('https://api.discogs.com/releases/' + id,
      { headers: { ...UA, Authorization: token }, cache: 'no-store' });
    return r.ok ? r.json() : null;
  } catch { return null; }
}

const MOCK = [
  {id:'m1',artist:'Opeth',album:'The Last Will and Testament',cover:null,releaseDate:'2024-11-01',genre:'Progressive Metal',preorder:false,limited:false},
  {id:'m2',artist:'Knocked Loose',album:"You Won't Go Before You're Supposed To",cover:null,releaseDate:'2024-05-10',genre:'Metalcore',preorder:false,limited:false},
  {id:'m3',artist:'Ghost',album:'Skeleta',cover:null,releaseDate:'2025-03-07',genre:'Heavy Metal',preorder:false,limited:false},
  {id:'m4',artist:'Mastodon',album:'The Toilet of Venus',cover:null,releaseDate:'2025-01-10',genre:'Progressive Metal',preorder:false,limited:false},
  {id:'m5',artist:'Darkthrone',album:'It Beckons Us All',cover:null,releaseDate:'2024-03-22',genre:'Black Metal',preorder:false,limited:false},
  {id:'m6',artist:'Gojira',album:'Fortitude',cover:null,releaseDate:'2021-04-30',genre:'Death Metal',preorder:false,limited:false},
];

const METAL_STYLES = [
  'Heavy Metal','Death Metal','Black Metal','Thrash Metal',
  'Doom Metal','Progressive Metal','Power Metal','Metalcore',
];

export async function GET() {
  const token = auth();
  if (!token) return NextResponse.json({ releases: MOCK, source: 'mock' });

  const headers  = { ...UA, Authorization: token };
  const todayStr = new Date().toISOString().split('T')[0];
  const today    = new Date(todayStr);
  const curYear  = today.getFullYear();
  // 45-day window: items added to Discogs after this date are "very recent"
  const recentCutoff = new Date(today.getTime() - 45*24*60*60*1000).toISOString().split('T')[0];

  try {
    // ── Search queries ──────────────────────────────────────────
    // A: current year, sorted by date_added → catches recently announced / pre-orders
    // B: current year, sorted by year desc → standard new releases
    // C: last year, date_added → still-relevant 2025 releases
    const fetches = [
      ...METAL_STYLES.slice(0,6).map(style =>
        `https://api.discogs.com/database/search?type=release&format=Vinyl&style=${encodeURIComponent(style)}&year=${curYear}&sort=date_added&sort_order=desc&per_page=15&page=1`
      ),
      ...METAL_STYLES.slice(0,4).map(style =>
        `https://api.discogs.com/database/search?type=release&format=Vinyl&style=${encodeURIComponent(style)}&year=${curYear}&sort=year&sort_order=desc&per_page=10&page=1`
      ),
      ...METAL_STYLES.slice(0,3).map(style =>
        `https://api.discogs.com/database/search?type=release&format=Vinyl&style=${encodeURIComponent(style)}&year=${curYear-1}&sort=date_added&sort_order=desc&per_page=8&page=1`
      ),
    ];

    const pages = await Promise.all(
      fetches.map(u => fetch(u, { headers, cache: 'no-store' })
        .then(r => r.ok ? r.json() : { results: [] })
        .catch(() => ({ results: [] })))
    );

    // ── Deduplicate ─────────────────────────────────────────────
    const seen = new Set();
    const candidates = [];
    for (const page of pages) {
      for (const item of (page.results || [])) {
        const parts  = (item.title || '').split(' - ');
        const artist = parts[0]?.trim();
        const album  = parts.slice(1).join(' - ').replace(/\s*\(\d{4}\)$/, '').trim();
        if (!artist || !album) continue;
        const key = artist + '::' + album;
        if (seen.has(key)) continue;
        seen.add(key);
        candidates.push({ id: String(item.id), artist, album, item });
      }
    }

    // ── Fetch release details for top 60 ───────────────────────
    const detailed = await Promise.all(
      candidates.slice(0, 60).map(async ({ id, artist, album, item }) => {
        const full = await getDetail(id, token);

        // Date resolution:
        // 1. Use full release `released` field (most accurate)
        // 2. Fall back to search result `year`
        const rawReleased = full?.released || '';
        const releaseDate = parseDate(rawReleased) ||
          (item.year ? String(item.year) + '-06-01' : '');

        // Pre-order detection:
        // - Definitive: full date from release detail is in the future
        // - Likely: item was added to Discogs recently (last 45d) AND year = this year
        //   (bands announce upcoming releases to Discogs before they drop)
        const releaseTs = releaseDate && releaseDate.length === 10 ? new Date(releaseDate) : null;
        const hasFutureDate = releaseTs && releaseTs > today;
        const isRecentAddition = item.date_added && item.date_added.slice(0,10) >= recentCutoff;
        const isCurrentYear = Number(item.year) === curYear;
        const isPreorder = hasFutureDate || (isRecentAddition && isCurrentYear);

        // Limited edition
        const fmts = [
          ...(full?.formats || []),
          ...(item.format || []).map(f => ({ descriptions: [f] })),
        ];
        const allDesc = fmts.flatMap(f => f.descriptions || []).join(' ').toLowerCase();
        const isLimited = allDesc.includes('limited') || allDesc.includes('numbered');

        // Cover image
        const cover = [full?.images?.[0]?.uri, item.cover_image]
          .find(u => u && !u.includes('spacer') && !u.includes('noimage')) || null;

        // Clean artist name
        const cleanArtist = (full?.artists?.[0]?.name || artist).replace(/\s*\(\d+\)$/, '');

        return {
          id,
          artist:       cleanArtist,
          album:        full?.title || album,
          cover,
          releaseDate,
          genre:        full?.styles?.[0] || full?.genres?.[0] || item.style?.[0] || 'Metal',
          preorder:     isPreorder,
          limited:      isLimited,
          label:        full?.labels?.[0]?.name || item.label?.[0] || '',
          country:      full?.country || item.country || '',
          discogsUrl:   'https://www.discogs.com/release/' + id,
          lowest_price: Number(full?.lowest_price) || 0,
          median_price: 0,
          spotifyUrl:   '',
          // debug
          _dateAdded:   item.date_added?.slice(0,10) || '',
          _rawReleased: rawReleased,
        };
      })
    );

    const valid = detailed.filter(r => r.artist && r.album);
    if (!valid.length) throw new Error('No results');

    // ── Sort: preorders first, then newest ─────────────────────
    valid.sort((a, b) => {
      if (a.preorder !== b.preorder) return a.preorder ? -1 : 1;
      if (!a.releaseDate && b.releaseDate) return 1;
      if (a.releaseDate && !b.releaseDate) return -1;
      return b.releaseDate.localeCompare(a.releaseDate);
    });

    return NextResponse.json({
      releases:  valid,
      source:    'discogs',
      count:     valid.length,
      preorders: valid.filter(r => r.preorder).length,
      today:     todayStr,
      recentCutoff,
    });

  } catch (e) {
    return NextResponse.json({ releases: MOCK, source: 'mock', notice: e.message });
  }
}
