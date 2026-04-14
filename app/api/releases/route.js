export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';

const LASTFM = 'https://ws.audioscrobbler.com/2.0/';
const KEY = process.env.LASTFM_API_KEY;

const METAL_TAGS = ['heavy metal','death metal','black metal','thrash metal','doom metal','progressive metal','power metal','metalcore'];

const METAL_ARTISTS = [
  'Opeth','Mastodon','Gojira','Behemoth','Ghost','Trivium','Lamb of God',
  'Slipknot','Rammstein','Kreator','Cannibal Corpse','Darkthrone','Nightwish',
  'Tool','Cattle Decapitation','Tomb Mold','Imperial Triumphant','Frozen Soul',
  'Knocked Loose','Gatecreeper','Power Trip','Enforced','Zeal & Ardor',
  'Haunter','Blood Incantation','Wolves in the Throne Room',
];

function parseLastfmDate(str) {
  if (!str) return '';
  // Last.fm format: "01 Jan 2024, 00:00" or just "2024"
  const full = str.match(/(\d{1,2})\s+(\w{3})\s+(\d{4})/);
  if (full) {
    const months = {Jan:'01',Feb:'02',Mar:'03',Apr:'04',May:'05',Jun:'06',Jul:'07',Aug:'08',Sep:'09',Oct:'10',Nov:'11',Dec:'12'};
    return full[3] + '-' + (months[full[2]] || '01') + '-' + full[1].padStart(2,'0');
  }
  const year = str.match(/\d{4}/);
  return year ? year[0] + '-01-01' : '';
}

const MOCK = [
  {id:'m1',artist:'Opeth',album:'The Last Will and Testament',cover:null,releaseDate:'2024-11-01',genre:'Progressive Metal',spotifyUrl:''},
  {id:'m2',artist:'Knocked Loose',album:"You Won't Go Before You're Supposed To",cover:null,releaseDate:'2024-05-10',genre:'Metalcore',spotifyUrl:''},
  {id:'m3',artist:'Ghost',album:'Skeleta',cover:null,releaseDate:'2025-03-07',genre:'Heavy Metal',spotifyUrl:''},
  {id:'m4',artist:'Mastodon',album:'The Toilet of Venus',cover:null,releaseDate:'2025-01-10',genre:'Progressive Metal',spotifyUrl:''},
  {id:'m5',artist:'Darkthrone',album:'It Beckons Us All',cover:null,releaseDate:'2024-03-22',genre:'Black Metal',spotifyUrl:''},
  {id:'m6',artist:'Gojira',album:'Fortitude',cover:null,releaseDate:'2021-04-30',genre:'Death Metal',spotifyUrl:''},
  {id:'m7',artist:'Behemoth',album:'I Loved You at Your Darkest',cover:null,releaseDate:'2018-10-05',genre:'Black Metal',spotifyUrl:''},
  {id:'m8',artist:'Rammstein',album:'Zeit',cover:null,releaseDate:'2022-04-29',genre:'Industrial Metal',spotifyUrl:''},
];

export async function GET() {
  if (!KEY) return NextResponse.json({ releases: MOCK, source: 'mock', notice: 'LASTFM_API_KEY not set' });

  try {
    const seen = new Set();
    const results = [];

    // Fetch top albums for each artist from Last.fm
    await Promise.all(
      METAL_ARTISTS.slice(0, 12).map(async (artist) => {
        try {
          const r = await fetch(
            LASTFM + '?method=artist.gettopalbums&artist=' + encodeURIComponent(artist) +
            '&api_key=' + KEY + '&format=json&limit=3',
            { cache: 'no-store' }
          );
          if (!r.ok) return;
          const d = await r.json();
          for (const album of (d.topalbums?.album || [])) {
            if (!album.name || album.name === '(null)') continue;
            const key = artist + '::' + album.name;
            if (seen.has(key)) continue;
            seen.add(key);

            // Get full album info for release date
            let releaseDate = '';
            let cover = album.image?.find(i => i.size === 'extralarge')?.['#text'] || null;
            if (cover?.includes('2a96cbd8b46e442fc41c2b86b821562f')) cover = null;

            try {
              const infoR = await fetch(
                LASTFM + '?method=album.getinfo&artist=' + encodeURIComponent(artist) +
                '&album=' + encodeURIComponent(album.name) +
                '&api_key=' + KEY + '&format=json',
                { cache: 'no-store' }
              );
              if (infoR.ok) {
                const info = await infoR.json();
                releaseDate = parseLastfmDate(info.album?.wiki?.published);
                if (!cover && info.album?.image) {
                  const xl = info.album.image.find(i => i.size === 'extralarge');
                  if (xl?.['#text'] && !xl['#text'].includes('2a96cbd8')) cover = xl['#text'];
                }
              }
            } catch {}

            results.push({
              id: String(album.mbid || artist + '_' + album.name),
              artist,
              album: album.name,
              cover,
              releaseDate,
              genre: 'Metal',
              spotifyUrl: '',
              lastfmUrl: album.url || '',
              playcount: Number(album.playcount) || 0,
            });
          }
        } catch {}
      })
    );

    if (!results.length) throw new Error('No results from Last.fm');

    // Sort by release date, newest first (empty dates go to end)
    results.sort((a, b) => {
      if (!a.releaseDate) return 1;
      if (!b.releaseDate) return -1;
      return b.releaseDate.localeCompare(a.releaseDate);
    });

    return NextResponse.json({ releases: results, source: 'lastfm', count: results.length });

  } catch (e) {
    return NextResponse.json({ releases: MOCK, source: 'mock', notice: e.message });
  }
}
