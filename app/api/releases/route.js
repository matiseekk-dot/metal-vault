export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';

function authHeader() {
  const key = process.env.DISCOGS_KEY;
  const secret = process.env.DISCOGS_SECRET;
  const token = process.env.DISCOGS_TOKEN;
  if (key && secret) return 'Discogs key=' + key + ', secret=' + secret;
  if (token) return 'Discogs token=' + token;
  return null;
}

const METAL_STYLES = ['Heavy Metal','Death Metal','Black Metal','Thrash Metal','Doom Metal','Progressive Metal','Power Metal','Metalcore'];

const MOCK = [
  {id:'m1',artist:'Opeth',album:'The Last Will and Testament',cover:null,releaseDate:'2024-11-01',genre:'Progressive Metal',spotifyUrl:''},
  {id:'m2',artist:'Knocked Loose',album:"You Won't Go Before You're Supposed To",cover:null,releaseDate:'2024-05-10',genre:'Metalcore',spotifyUrl:''},
  {id:'m3',artist:'Darkthrone',album:'It Beckons Us All',cover:null,releaseDate:'2024-03-22',genre:'Black Metal',spotifyUrl:''},
  {id:'m4',artist:'Ghost',album:'Skeleta',cover:null,releaseDate:'2025-03-07',genre:'Heavy Metal',spotifyUrl:''},
  {id:'m5',artist:'Mastodon',album:'The Toilet of Venus',cover:null,releaseDate:'2025-01-10',genre:'Progressive Metal',spotifyUrl:''},
  {id:'m6',artist:'Gojira',album:'Fortitude',cover:null,releaseDate:'2021-04-30',genre:'Death Metal',spotifyUrl:''},
  {id:'m7',artist:'Behemoth',album:'I Loved You at Your Darkest',cover:null,releaseDate:'2018-10-05',genre:'Black Metal',spotifyUrl:''},
  {id:'m8',artist:'Rammstein',album:'Zeit',cover:null,releaseDate:'2022-04-29',genre:'Industrial Metal',spotifyUrl:''},
  {id:'m9',artist:'Cannibal Corpse',album:'Chaos Horrific',cover:null,releaseDate:'2023-09-22',genre:'Death Metal',spotifyUrl:''},
  {id:'m10',artist:'Kreator',album:'Hate Ueber Alles',cover:null,releaseDate:'2022-06-03',genre:'Thrash Metal',spotifyUrl:''},
];

export async function GET() {
  const auth = authHeader();
  if (!auth) return NextResponse.json({ releases: MOCK, source: 'mock', notice: 'DISCOGS_TOKEN not configured' });
  try {
    const headers = { Authorization: auth, 'User-Agent': 'MetalVault/1.0' };
    const styles = METAL_STYLES.slice(0, 4);
    const fetches = styles.map(style =>
      fetch('https://api.discogs.com/database/search?type=release&format=Vinyl&style=' + encodeURIComponent(style) + '&sort=year&sort_order=desc&per_page=20&page=1',
        { headers, cache: 'no-store' })
      .then(r => r.ok ? r.json() : {results:[]}).catch(() => ({results:[]}))
    );
    const responses = await Promise.all(fetches);
    const seen = new Set();
    const results = [];
    for (let i = 0; i < responses.length; i++) {
      for (const item of (responses[i].results || [])) {
        const parts = (item.title||'').split(' - ');
        const artist = parts[0]?.trim()||'Unknown';
        const album = parts.slice(1).join(' - ').replace(/\s*\(\d{4}\)$/,'').trim()||item.title||'';
        const key = artist+'::'+album;
        if (seen.has(key)||!artist||!album) continue;
        seen.add(key);
        results.push({
          id:String(item.id), artist, album,
          cover:item.cover_image&&!item.cover_image.includes('spacer')?item.cover_image:null,
          releaseDate:item.year?item.year+'-01-01':'',
          genre:item.style?.[0]||styles[i], spotifyUrl:'',
          discogsUrl:'https://www.discogs.com'+(item.uri||''),
          format:item.format?.join(', ')||'Vinyl',
        });
      }
    }
    if (!results.length) throw new Error('No results from Discogs');
    results.sort((a,b)=>b.releaseDate.localeCompare(a.releaseDate));
    return NextResponse.json({ releases:results.slice(0,80), source:'discogs', count:results.length });
  } catch(e) {
    return NextResponse.json({ releases:MOCK, source:'mock', notice:e.message });
  }
      }
