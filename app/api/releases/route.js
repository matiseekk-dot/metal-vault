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
  if (/^\d{4}$/.test(s))              return s;
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

// Best metal genre from Discogs styles/genres arrays
function pickGenre(full, item) {
  const METAL = [
    'Death Metal','Black Metal','Thrash Metal','Doom Metal','Progressive Metal',
    'Power Metal','Heavy Metal','Metalcore','Groove Metal','Sludge Metal',
    'Symphonic Metal','Folk Metal','Industrial Metal','Post-Metal','Grindcore',
    'Nu-Metal','Speed Metal','Stoner Metal','Viking Metal','Melodic Death Metal',
  ];
  const all = [
    ...(full?.styles || []),
    ...(full?.genres || []),
    ...(item.style   || []),
    ...(item.genre   || []),
  ];
  return (
    all.find(g => METAL.some(m => g?.toLowerCase().includes(m.toLowerCase()))) ||
    all[0] ||
    'Metal'
  );
}

// Mock for when Discogs is not configured
const MOCK = [
  {id:'m1',artist:'Power Trip',     album:'Nightmare Logic',         cover:null,releaseDate:'2026-05-15',genre:'Thrash Metal',    preorder:true, limited:false},
  {id:'m2',artist:'Tomb Mold',      album:'Planetary Clairvoyance',  cover:null,releaseDate:'2026-05-22',genre:'Death Metal',     preorder:true, limited:false},
  {id:'m3',artist:'Wallowing',      album:'Beholden to the Sword',   cover:null,releaseDate:'2026-06-06',genre:'Doom Metal',      preorder:true, limited:true},
  {id:'m4',artist:'Spectral Wound', album:'Songs of Blood and Mire', cover:null,releaseDate:'2026-06-20',genre:'Black Metal',     preorder:true, limited:false},
  {id:'m5',artist:'Frozen Soul',    album:'Glacial Domination',      cover:null,releaseDate:'2026-04-25',genre:'Death Metal',     preorder:false,limited:false},
  {id:'m6',artist:'Enforcer',       album:'Nostalgia',               cover:null,releaseDate:'2026-04-18',genre:'Heavy Metal',     preorder:false,limited:true},
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
  const nextYear = curYear + 1;

  // "Recent" window: 60 days back — so we show what just came out too
  const recentFrom = new Date(today.getTime() - 60 * 24 * 60 * 60 * 1000)
    .toISOString().split('T')[0];

  try {
    // ── Strategy: search for UPCOMING and RECENT releases ──────
    // Primary: current year + next year, sorted by date_added desc
    // (Labels add pre-orders to Discogs as they announce them)
    // Secondary: current year sorted by year desc (standard new releases)
    const fetches = [
      // Next year — pure pre-orders/announcements
      ...METAL_STYLES.slice(0, 6).map(style =>
        `https://api.discogs.com/database/search?type=release&format=Vinyl&style=${encodeURIComponent(style)}&year=${nextYear}&sort=date_added&sort_order=desc&per_page=20&page=1`
      ),
      // Current year, recently added — catches new announcements + recent releases
      ...METAL_STYLES.slice(0, 8).map(style =>
        `https://api.discogs.com/database/search?type=release&format=Vinyl&style=${encodeURIComponent(style)}&year=${curYear}&sort=date_added&sort_order=desc&per_page=20&page=1`
      ),
      // Current year page 2 — more coverage
      ...METAL_STYLES.slice(0, 4).map(style =>
        `https://api.discogs.com/database/search?type=release&format=Vinyl&style=${encodeURIComponent(style)}&year=${curYear}&sort=date_added&sort_order=desc&per_page=20&page=2`
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

    // ── Fetch release details ───────────────────────────────────
    const detailed = await Promise.all(
      candidates.slice(0, 120).map(async ({ id, artist, album, item }) => {
        const full = await getDetail(id, token);

        // ── Date: prefer full.released when it's specific and current/future ──
        // item.year = year of THIS pressing (always current/next year since we searched that)
        // full.released = can be original album date for represses
        const rawReleased = full?.released || '';
        const parsedFull  = parseDate(rawReleased);
        const pressYear   = item.year ? String(item.year) : '';

        // Use full.released only when it's a specific date in current/future year
        // (not an old repress date like 1994)
        const useFullDate = parsedFull && parsedFull >= String(curYear) + '-01-01';
        const releaseDate = useFullDate ? parsedFull : pressYear || parsedFull || '';

        // ── Determine if this is upcoming (future) or recently released ──
        const relTs     = releaseDate?.length === 10 ? new Date(releaseDate) : null;
        const isUpcoming = relTs ? relTs > today :
                          (releaseDate?.length === 4 && Number(releaseDate) > curYear);
        const isRecent  = relTs ? relTs >= new Date(recentFrom) && relTs <= today : false;

        // Skip if release date is before our recent window AND it's a past year item
        // (these are old represses we don't want)
        if (!isUpcoming && !isRecent && pressYear && Number(pressYear) < curYear) return null;
        if (!isUpcoming && !isRecent && relTs && relTs < new Date(recentFrom)) return null;

        // ── Limited edition detection ──
        const fmts = [
          ...(full?.formats || []),
          ...(item.format || []).map(f => ({ descriptions: [f] })),
        ];
        const allDesc = fmts.flatMap(f => f.descriptions || []).join(' ').toLowerCase();
        const isLimited = allDesc.includes('limited') || allDesc.includes('numbered') ||
                         allDesc.includes('colored')  || allDesc.includes('colour');

        // ── Cover ──
        const cover = [full?.images?.[0]?.uri, item.cover_image]
          .find(u => u && !u.includes('spacer') && !u.includes('noimage')) || null;

        const cleanArtist = (full?.artists?.[0]?.name || artist).replace(/\s*\(\d+\)$/, '');

        return {
          id,
          artist:      cleanArtist,
          album:       full?.title || album,
          cover,
          releaseDate,
          genre:       pickGenre(full, item),
          preorder:    isUpcoming,
          limited:     isLimited,
          label:       full?.labels?.[0]?.name || item.label?.[0] || '',
          country:     full?.country || item.country || '',
          discogsUrl:  'https://www.discogs.com/release/' + id,
          lowest_price: Number(full?.lowest_price) || 0,
          spotifyUrl:  '',
        };
      })
    );

    // ── Filter: only upcoming + recently released (last 60 days) ──
    const valid = detailed.filter(r => r && r.artist && r.album);

    if (!valid.length) throw new Error('No upcoming results — falling back to mock');

    // ── Sort: upcoming by soonest first, then recent by newest first ──
    valid.sort((a, b) => {
      const aUp = a.preorder, bUp = b.preorder;
      // Both upcoming: soonest release first
      if (aUp && bUp) return (a.releaseDate || '9999').localeCompare(b.releaseDate || '9999');
      // Upcoming before recent
      if (aUp !== bUp) return aUp ? -1 : 1;
      // Both recent: newest first
      return (b.releaseDate || '').localeCompare(a.releaseDate || '');
    });

    return NextResponse.json({
      releases:  valid,
      source:    'discogs',
      count:     valid.length,
      upcoming:  valid.filter(r => r.preorder).length,
      recent:    valid.filter(r => !r.preorder).length,
      today:     todayStr,
    });

  } catch (e) {
    return NextResponse.json({ releases: MOCK, source: 'mock', notice: e.message });
  }
}
