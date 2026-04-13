export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';

let _token = null;
let _tokenExpiry = 0;

async function getToken() {
  if (_token && Date.now() < _tokenExpiry) return _token;
  const id = process.env.SPOTIFY_CLIENT_ID;
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
  if (!d.access_token) throw new Error('Token failed: ' + d.error + ' ' + d.error_description);
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

const METAL_ARTISTS = [
  // Artist name : known genre
  ['Opeth',             'Progressive Metal'],
  ['Mastodon',          'Progressive Metal'],
  ['Gojira',            'Death Metal'],
  ['Behemoth',          'Black Metal'],
  ['Ghost',             'Heavy Metal'],
  ['Trivium',           'Heavy Metal'],
  ['Lamb of God',       'Groove Metal'],
  ['Slipknot',          'Nu-Metal'],
  ['Tool',              'Progressive Metal'],
  ['Rammstein',         'Industrial Metal'],
  ['Cannibal Corpse',   'Death Metal'],
  ['Darkthrone',        'Black Metal'],
  ['Kreator',           'Thrash Metal'],
  ['Sepultura',         'Thrash Metal'],
  ['Nightwish',         'Symphonic Metal'],
  ['Cattle Decapitation','Death Metal'],
  ['Power Trip',        'Thrash Metal'],
  ['Frozen Soul',       'Death Metal'],
  ['Tomb Mold',         'Death Metal'],
  ['Imperial Triumphant','Avant-garde Metal'],
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
    const token = await getToken();
    const seen = new Set();
    const results = [];
    const errors = [];

    for (const [artistName, genre] of METAL_ARTISTS) {
      try {
        // Step 1: search for artist
        const searchRes = await fetch(
          'https://api.spotify.com/v1/search?q=' + encodeURIComponent('artist:' + artistName) + '&type=artist&limit=1',
          { headers: { Authorization: 'Bearer ' + token } }
        );
        if (!searchRes.ok) { errors.push(artistName + ':search:' + searchRes.status); continue; }
        const searchData = await searchRes.json();
        const artist = searchData.artists?.items?.[0];
        if (!artist) { errors.push(artistName + ':not_found'); continue; }

        // Step 2: get their albums
        const albumsRes = await fetch(
          'https://api.spotify.com/v1/artists/' + artist.id + '/albums?include_groups=album&limit=5&market=US',
          { headers: { Authorization: 'Bearer ' + token } }
        );
        if (!albumsRes.ok) { errors.push(artistName + ':albums:' + albumsRes.status); continue; }
        const albumsData = await albumsRes.json();

        for (const album of (albumsData.items || [])) {
          if (!seen.has(album.id)) {
            seen.add(album.id);
            results.push(norm(album, genre));
          }
        }
      } catch (e) {
        errors.push(artistName + ':' + e.message);
      }
    }

    if (results.length === 0) {
      throw new Error('No results. Errors: ' + errors.slice(0, 3).join(', '));
    }

    results.sort((a, b) => new Date(b.releaseDate) - new Date(a.releaseDate));
    return NextResponse.json({
      releases: results.slice(0, 80),
      source: 'spotify',
      count: results.length,
      errors: errors.length,
    });
  } catch (e) {
    console.error('Spotify failed:', e.message);
    return NextResponse.json({ releases: MOCK, source: 'mock', notice: e.message });
  }
}
