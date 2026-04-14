export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';

function authHeader() {
  const key   = process.env.DISCOGS_KEY;
  const secret= process.env.DISCOGS_SECRET;
  const token = process.env.DISCOGS_TOKEN;
  if (key && secret) return 'Discogs key=' + key + ', secret=' + secret;
  if (token)         return 'Discogs token=' + token;
  return null;
}

const METAL_STYLES = [
  'Heavy Metal','Death Metal','Black Metal','Thrash Metal',
  'Doom Metal','Progressive Metal','Power Metal','Metalcore',
  'Groove Metal','Nu Metal','Symphonic Metal','Sludge Metal',
];

const MOCK = [
  {id:'m1', artist:'Opeth',         album:'The Last Will and Testament',cover:null,releaseDate:'2024-11-01',genre:'Progressive Metal',spotifyUrl:''},
  {id:'m2', artist:'Knocked Loose', album:"You Won't Go Before You're Supposed To",cover:null,releaseDate:'2024-05-10',genre:'Metalcore',spotifyUrl:''},
  {id:'m3', artist:'Darkthrone',    album:'It Beckons Us All',cover:null,releaseDate:'2024-03-22',genre:'Black Metal',spotifyUrl:''},
  {id:'m4', artist:'Ghost',         album:'Skeleta',cover:null,releaseDate:'2025-03-07',genre:'Heavy Metal',spotifyUrl:''},
  {id:'m5', artist:'Mastodon',      album:'The Toilet of Venus',cover:null,releaseDate:'2025-01-10',genre:'Progressive Metal',spotifyUrl:''},
  {id:'m6', artist:'Cannibal Corpse',album:'Chaos Horrific',cover:null,releaseDate:'2023-09-22',genre:'Death Metal',spotifyUrl:''},
  {id:'m7', artist:'Behemoth',      album:'I Loved You at Your Darkest',cover:null,releaseDate:'2018-10-05',genre:'Black Metal',spotifyUrl:''},
  {id:'m8', artist:'Rammstein',     album:'Zeit',cover:null,releaseDate:'2022-04-29',genre:'Industrial Metal',spotifyUrl:''},
  {id:'m9', artist:'Gojira',        album:'Fortitude',cover:null,releaseDate:'2021-04-30',genre:'Death Metal',spotifyUrl:''},
  {id:'m10',artist:'Kreator',       album:'Hate Ueber Alles',cover:null,releaseDate:'2022-06-03',genre:'Thrash Metal',spotifyUrl:''},
  {id:'m11',artist:'Trivium',       album:'In The Court of the Dragon',cover:null,releaseDate:'2021-10-08',genre:'Heavy Metal',spotifyUrl:''},
  {id:'m12',artist:'Nightwish',     album:'Yesterwynde',cover:null,releaseDate:'2024-09-20',genre:'Symphonic Metal',spotifyUrl:''},
  {id:'m13',artist:'Cattle Decap.', album:'Terrasite',cover:null,releaseDate:'2023-05-12',genre:'Death Metal',spotifyUrl:''},
  {id:'m14',artist:'Lamb of God',   album:'Omens',cover:null,releaseDate:'2022-10-07',genre:'Groove Metal',spotifyUrl:''},
  {id:'m15',artist:'Tool',          album:'Fear Inoculum',cover:null,releaseDate:'2019-08-30',genre:'Progressive Metal',spotifyUrl:''},
];

export async function GET() {
  const auth = authHeader();
  if (!auth) {
    return NextResponse.json({ releases: MOCK, source: 'mock', notice: 'DISCOGS_TOKEN not configured' });
  }
  try {
    const headers = {
      Authorization: auth,
      'User-Agent': 'MetalVault/1.0 +https://metal-vault-six.vercel.app',
    };
    const style = METAL_STYLES[Math.floor(Math.random() * 4)];
    const url = 'https://api.discogs.com/database/search'
      + '?type=release&format=Vinyl'
      + '&style=' + encodeURIComponent(style)
      + '&sort=year&sort_order=desc&per_page=50&page=1';
    const res = await fetch(url, { headers, cache: 'no-store' });
    if (!res.ok) throw new Error('Discogs search ' + res.status);
    const data = await res.json();
    const seen = new Set();
    const results = [];
    for (const item of (data.results || [])) {
      const titleParts = (item.title || '').split(' - ');
      const artist = titleParts[0]?.trim() || 'Unknown';
      const album  = titleParts.slice(1).join(' - ').replace(/\s*\(\d{4}\)$/, '').trim() || item.title || '';
      const key = artist + '::' + album;
      if (seen.has(key) || !artist || !album) continue;
      seen.add(key);
      const year = item.year || '';
      results.push({
        id: String(item.id), artist, album,
        cover: item.cover_image && !item.cover_image.includes('spacer') ? item.cover_image : null,
        releaseDate: year ? year + '-01-01' : '',
        genre: item.style?.[0] || item.genre?.[0] || 'Metal',
        spotifyUrl: '',
        discogsUrl: 'https://www.discogs.com' + (item.uri || ''),
        format: item.format?.join(', ') || 'Vinyl',
        country: item.country || '',
        label: item.label?.[0] || '',
      });
    }
    if (results.length === 0) throw new Error('No results from Discogs');
    return NextResponse.json({ releases: results, source: 'discogs', count: results.length });
  } catch (e) {
    return NextResponse.json({ releases: MOCK, source: 'mock', notice: e.message });
  }
   }
