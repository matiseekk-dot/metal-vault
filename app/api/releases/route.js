export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';

let _token = null;
let _tokenExpiry = 0;

async function getSpotifyToken() {
  if (_token && Date.now() < _tokenExpiry) return _token;
  const id     = process.env.SPOTIFY_CLIENT_ID;
  const secret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!id || !secret) throw new Error('Spotify keys not set');
  const r = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64'),
    },
    body: 'grant_type=client_credentials',
  });
  const d = await r.json();
  if (!d.access_token) throw new Error('Spotify auth failed: ' + JSON.stringify(d));
  _token = d.access_token;
  _tokenExpiry = Date.now() + (d.expires_in - 120) * 1000;
  return _token;
}

function normalise(album) {
  return {
    id:          album.id,
    artist:      album.artists?.[0]?.name || 'Unknown',
    album:       album.name,
    cover:       album.images?.[0]?.url || null,
    releaseDate: album.release_date || '',
    genre:       'Metal',
    spotifyUrl:  album.external_urls?.spotify || '',
  };
}

const MOCK = [
  { id:'m1',  artist:'Opeth',              album:'The Last Will and Testament',          cover:null, releaseDate:'2024-11-01', genre:'Progressive Metal', spotifyUrl:'' },
  { id:'m2',  artist:'Knocked Loose',       album:"You Won't Go Before You're Supposed To", cover:null, releaseDate:'2024-05-10', genre:'Metalcore',         spotifyUrl:'' },
  { id:'m3',  artist:'Darkthrone',          album:'It Beckons Us All',                   cover:null, releaseDate:'2024-03-22', genre:'Black Metal',        spotifyUrl:'' },
  { id:'m4',  artist:'Gatecreeper',         album:'Dark Superstition',                   cover:null, releaseDate:'2024-03-01', genre:'Death Metal',        spotifyUrl:'' },
  { id:'m5',  artist:'Yob',                album:'The Prophet',                         cover:null, releaseDate:'2024-05-17', genre:'Doom Metal',         spotifyUrl:'' },
  { id:'m6',  artist:'Blood Incantation',   album:'Absolute Elsewhere',                  cover:null, releaseDate:'2023-10-06', genre:'Death Metal',        spotifyUrl:'' },
  { id:'m7',  artist:'Cannibal Corpse',     album:'Chaos Horrific',                      cover:null, releaseDate:'2023-09-22', genre:'Death Metal',        spotifyUrl:'' },
  { id:'m8',  artist:'Imperial Triumphant', album:'Spirit of Ecstasy',                   cover:null, releaseDate:'2023-07-28', genre:'Avant-garde Metal',  spotifyUrl:'' },
  { id:'m9',  artist:'Cattle Decapitation', album:'Terrasite',                           cover:null, releaseDate:'2023-05-12', genre:'Death Metal',        spotifyUrl:'' },
  { id:'m10', artist:'Tomb Mold',           album:'The Enduring Spirit',                 cover:null, releaseDate:'2023-07-28', genre:'Death Metal',        spotifyUrl:'' },
  { id:'m11', artist:'Enforced',            album:'War Remains',                         cover:null, releaseDate:'2023-03-24', genre:'Thrash Metal',       spotifyUrl:'' },
  { id:'m12', artist:'Frozen Soul',         album:'Glacial Domination',                  cover:null, releaseDate:'2023-02-24', genre:'Death Metal',        spotifyUrl:'' },
  { id:'m13', artist:'Mastodon',            album:'Hushed and Grim',                     cover:null, releaseDate:'2021-10-29', genre:'Progressive Metal',  spotifyUrl:'' },
  { id:'m14', artist:'Power Trip',          album:'Nightmare Logic',                     cover:null, releaseDate:'2017-02-24', genre:'Thrash Metal',       spotifyUrl:'' },
  { id:'m15', artist:'Gojira',              album:'Fortitude',                           cover:null, releaseDate:'2021-04-30', genre:'Death Metal',        spotifyUrl:'' },
  { id:'m16', artist:'Inter Arma',          album:'Sulphur English',                     cover:null, releaseDate:'2019-03-29', genre:'Doom Metal',         spotifyUrl:'' },
  { id:'m17', artist:'Full of Hell',        album:'Garden of Burning Apparitions',        cover:null, releaseDate:'2021-10-22', genre:'Grindcore',          spotifyUrl:'' },
  { id:'m18', artist:'Ulthar',              album:'Anthronomicon',                       cover:null, releaseDate:'2022-09-09', genre:'Death Metal',        spotifyUrl:'' },
  { id:'m19', artist:'Primitive Man',       album:'Insurmountable',                      cover:null, releaseDate:'2022-09-23', genre:'Doom Metal',         spotifyUrl:'' },
  { id:'m20', artist:'Witch Vomit',         album:'Abject Futility',                     cover:null, releaseDate:'2022-08-26', genre:'Death Metal',        spotifyUrl:'' },
];

export async function GET() {
  try {
    const token = await getSpotifyToken();

    // Simple keyword searches — most reliable across all Spotify markets
    const queries = [
      'metal album 2024',
      'death metal 2024',
      'black metal 2024',
      'doom metal 2024',
      'heavy metal 2023',
    ];

    const seen    = new Set();
    const results = [];

    for (const q of queries) {
      try {
        const url = `https://api.spotify.com/v1/search?q=${encodeURIComponent(q)}&type=album&limit=20&market=US`;
        const r   = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });

        if (!r.ok) continue;
        const d = await r.json();

        for (const item of (d.albums?.items || [])) {
          if (!seen.has(item.id) && item.id) {
            seen.add(item.id);
            results.push(normalise(item));
          }
        }
      } catch {}
    }

    if (results.length === 0) throw new Error('No Spotify results returned');

    results.sort((a, b) => new Date(b.releaseDate) - new Date(a.releaseDate));
    return NextResponse.json({ releases: results.slice(0, 60), source: 'spotify' });

  } catch (e) {
    return NextResponse.json({ releases: MOCK, source: 'mock', notice: e.message });
  }
}
