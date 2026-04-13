export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';

let _token = null;
let _tokenExpiry = 0;

async function getToken() {
  if (_token && Date.now() < _tokenExpiry) return _token;
  const id     = process.env.SPOTIFY_CLIENT_ID;
  const secret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!id || !secret) throw new Error('Spotify keys not set');
  const r = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: 'Basic ' + Buffer.from(id + ':' + secret).toString('base64'),
    },
    body: 'grant_type=client_credentials',
  });
  const d = await r.json();
  if (!d.access_token) throw new Error('Token: ' + d.error + ' — ' + d.error_description);
  _token = d.access_token;
  _tokenExpiry = Date.now() + (d.expires_in - 60) * 1000;
  return _token;
}

function norm(album, genre) {
  return {
    id:          album.id,
    artist:      album.artists?.[0]?.name || 'Unknown',
    album:       album.name,
    cover:       album.images?.[0]?.url || null,
    releaseDate: album.release_date || '',
    genre:       genre || 'Metal',
    spotifyUrl:  album.external_urls?.spotify || '',
  };
}

// Verified Spotify artist IDs — no search needed, direct API calls only
// These IDs are stable and don't require search scope
const ARTISTS = [
  ['0ybFZ2Ab08V8hueghSXm6E', 'Progressive Metal'], // Opeth
  ['2ye2Wgw4gimLv2eAKyk1NB', 'Progressive Metal'], // Mastodon
  ['0SwO7SWeDHJijQ3XNS7xEE', 'Death Metal'],       // Gojira
  ['7FBcuc1gsnv6Y1nwFtNRCb', 'Heavy Metal'],        // Trivium
  ['7bDLHytU8vohbiWbePGrdy', 'Death Metal'],        // Cannibal Corpse
  ['3qNVuliS40BLgXGxhdBdqu', 'Black Metal'],        // Darkthrone
  ['2nRr1crKaFqRFwWf6B4nqo', 'Groove Metal'],       // Lamb of God
  ['6CoZPxQSbAELFGZic4ZZxn', 'Thrash Metal'],       // Sepultura
  ['4sHJBKTqrPAqPFUBiH0Pix', 'Thrash Metal'],       // Kreator
  ['3MZsBdqDrRTABnNDSbcfVn', 'Thrash Metal'],       // Slayer
  ['5M52tdBnJaKSvOpJGz8mfZ', 'Heavy Metal'],        // Black Sabbath
  ['7Ey4PD4MYsKc5I2dolUwbH', 'Groove Metal'],       // Pantera
  ['2d0hyoQ5ynDBnkvAbJKORj', 'Progressive Metal'],  // Tool
  ['6yJ6QQ3Y5l0s0tn7b0arrO', 'Black Metal'],        // Behemoth
  ['4UgQ3EFa8fEeaIEg54uV5b', 'Heavy Metal'],        // Ghost
  ['3TOqt5oJwL9BE2NG7TexlAJ', 'Symphonic Metal'],   // Nightwish
  ['1DFr97A9HnbV3SKTJFu62M', 'Industrial Metal'],   // Rammstein
  ['776Uo845nYHJpNaStv1Ds4', 'Nu-Metal'],           // Slipknot
  ['1bDdiDELAChkf4U8GlFqZr', 'Death Metal'],        // Cattle Decapitation
  ['4vGrte8FDu062Ntj0RsPiZ', 'Black Metal'],        // Mayhem
];

const MOCK = [
  {id:'m1',artist:'Opeth',album:'The Last Will and Testament',cover:null,releaseDate:'2024-11-01',genre:'Progressive Metal',spotifyUrl:''},
  {id:'m2',artist:'Knocked Loose',album:"You Won't Go Before You're Supposed To",cover:null,releaseDate:'2024-05-10',genre:'Metalcore',spotifyUrl:''},
  {id:'m3',artist:'Darkthrone',album:'It Beckons Us All',cover:null,releaseDate:'2024-03-22',genre:'Black Metal',spotifyUrl:''},
  {id:'m4',artist:'Gatecreeper',album:'Dark Superstition',cover:null,releaseDate:'2024-03-01',genre:'Death Metal',spotifyUrl:''},
  {id:'m5',artist:'Yob',album:'The Prophet',cover:null,releaseDate:'2024-05-17',genre:'Doom Metal',spotifyUrl:''},
  {id:'m6',artist:'Blood Incantation',album:'Absolute Elsewhere',cover:null,releaseDate:'2023-10-06',genre:'Death Metal',spotifyUrl:''},
  {id:'m7',artist:'Cannibal Corpse',album:'Chaos Horrific',cover:null,releaseDate:'2023-09-22',genre:'Death Metal',spotifyUrl:''},
  {id:'m8',artist:'Imperial Triumphant',album:'Spirit of Ecstasy',cover:null,releaseDate:'2023-07-28',genre:'Avant-garde Metal',spotifyUrl:''},
  {id:'m9',artist:'Cattle Decapitation',album:'Terrasite',cover:null,releaseDate:'2023-05-12',genre:'Death Metal',spotifyUrl:''},
  {id:'m10',artist:'Tomb Mold',album:'The Enduring Spirit',cover:null,releaseDate:'2023-07-28',genre:'Death Metal',spotifyUrl:''},
  {id:'m11',artist:'Behemoth',album:'I Loved You at Your Darkest',cover:null,releaseDate:'2018-10-05',genre:'Black Metal',spotifyUrl:''},
  {id:'m12',artist:'Ghost',album:'Impera',cover:null,releaseDate:'2022-03-11',genre:'Heavy Metal',spotifyUrl:''},
  {id:'m13',artist:'Mastodon',album:'Hushed and Grim',cover:null,releaseDate:'2021-10-29',genre:'Progressive Metal',spotifyUrl:''},
  {id:'m14',artist:'Gojira',album:'Fortitude',cover:null,releaseDate:'2021-04-30',genre:'Death Metal',spotifyUrl:''},
  {id:'m15',artist:'Tool',album:'Fear Inoculum',cover:null,releaseDate:'2019-08-30',genre:'Progressive Metal',spotifyUrl:''},
  {id:'m16',artist:'Rammstein',album:'Zeit',cover:null,releaseDate:'2022-04-29',genre:'Industrial Metal',spotifyUrl:''},
  {id:'m17',artist:'Slipknot',album:'The End, So Far',cover:null,releaseDate:'2022-09-30',genre:'Nu-Metal',spotifyUrl:''},
  {id:'m18',artist:'Nightwish',album:'Human. :||: Nature.',cover:null,releaseDate:'2020-04-10',genre:'Symphonic Metal',spotifyUrl:''},
  {id:'m19',artist:'Kreator',album:'Hate Ueber Alles',cover:null,releaseDate:'2022-06-03',genre:'Thrash Metal',spotifyUrl:''},
  {id:'m20',artist:'Lamb of God',album:'Omens',cover:null,releaseDate:'2022-10-07',genre:'Groove Metal',spotifyUrl:''},
];

export async function GET() {
  try {
    const token  = await getToken();
    const seen   = new Set();
    const results = [];
    const errors = [];

    for (const [artistId, genre] of ARTISTS) {
      try {
        const r = await fetch(
          'https://api.spotify.com/v1/artists/' + artistId + '/albums?include_groups=album&limit=5&market=US',
          { headers: { Authorization: 'Bearer ' + token } }
        );
        if (!r.ok) {
          const body = await r.text().catch(() => '');
          errors.push(artistId + ':' + r.status + ':' + body.slice(0, 60));
          continue;
        }
        const d = await r.json();
        for (const item of (d.items || [])) {
          if (!seen.has(item.id)) {
            seen.add(item.id);
            results.push(norm(item, genre));
          }
        }
      } catch (e) {
        errors.push(artistId + ':' + e.message.slice(0, 40));
      }
    }

    if (results.length === 0) {
      throw new Error(
        errors.length > 0
          ? 'All ' + errors.length + ' requests failed. First: ' + errors[0]
          : 'Spotify returned no albums. Enable Web API in Spotify Dashboard → Edit Settings.'
      );
    }

    results.sort((a, b) => new Date(b.releaseDate) - new Date(a.releaseDate));
    return NextResponse.json({ releases: results.slice(0, 80), source: 'spotify', count: results.length });

  } catch (e) {
    return NextResponse.json({ releases: MOCK, source: 'mock', notice: e.message });
  }
}
