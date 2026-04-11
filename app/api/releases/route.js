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
  { id:'m1',  artist:'Opeth',              album:'The Last Will and Testament',            cover:null, releaseDate:'2024-11-01', genre:'Progressive Metal', spotifyUrl:'' },
  { id:'m2',  artist:'Knocked Loose',      album:"You Won't Go Before You're Supposed To", cover:null, releaseDate:'2024-05-10', genre:'Metalcore',         spotifyUrl:'' },
  { id:'m3',  artist:'Darkthrone',         album:'It Beckons Us All',                     cover:null, releaseDate:'2024-03-22', genre:'Black Metal',        spotifyUrl:'' },
  { id:'m4',  artist:'Gatecreeper',        album:'Dark Superstition',                     cover:null, releaseDate:'2024-03-01', genre:'Death Metal',        spotifyUrl:'' },
  { id:'m5',  artist:'Yob',               album:'The Prophet',                           cover:null, releaseDate:'2024-05-17', genre:'Doom Metal',         spotifyUrl:'' },
  { id:'m6',  artist:'Blood Incantation',  album:'Absolute Elsewhere',                    cover:null, releaseDate:'2023-10-06', genre:'Death Metal',        spotifyUrl:'' },
  { id:'m7',  artist:'Cannibal Corpse',    album:'Chaos Horrific',                        cover:null, releaseDate:'2023-09-22', genre:'Death Metal',        spotifyUrl:'' },
  { id:'m8',  artist:'Imperial Triumphant',album:'Spirit of Ecstasy',                     cover:null, releaseDate:'2023-07-28', genre:'Avant-garde Metal',  spotifyUrl:'' },
  { id:'m9',  artist:'Cattle Decapitation',album:'Terrasite',                             cover:null, releaseDate:'2023-05-12', genre:'Death Metal',        spotifyUrl:'' },
  { id:'m10', artist:'Tomb Mold',          album:'The Enduring Spirit',                   cover:null, releaseDate:'2023-07-28', genre:'Death Metal',        spotifyUrl:'' },
  { id:'m11', artist:'Enforced',           album:'War Remains',                           cover:null, releaseDate:'2023-03-24', genre:'Thrash Metal',       spotifyUrl:'' },
  { id:'m12', artist:'Frozen Soul',        album:'Glacial Domination',                    cover:null, releaseDate:'2023-02-24', genre:'Death Metal',        spotifyUrl:'' },
  { id:'m13', artist:'Mastodon',           album:'Hushed and Grim',                       cover:null, releaseDate:'2021-10-29', genre:'Progressive Metal',  spotifyUrl:'' },
  { id:'m14', artist:'Gojira',             album:'Fortitude',                             cover:null, releaseDate:'2021-04-30', genre:'Death Metal',        spotifyUrl:'' },
  { id:'m15', artist:'Trivium',            album:'In The Court Of The Dragon',            cover:null, releaseDate:'2021-10-08', genre:'Heavy Metal',        spotifyUrl:'' },
  { id:'m16', artist:'Lamb of God',        album:'Omens',                                 cover:null, releaseDate:'2022-10-07', genre:'Groove Metal',       spotifyUrl:'' },
  { id:'m17', artist:'Sepultura',          album:'Quadra',                                cover:null, releaseDate:'2020-02-07', genre:'Thrash Metal',       spotifyUrl:'' },
  { id:'m18', artist:'Kreator',            album:'Hate Über Alles',                       cover:null, releaseDate:'2022-06-03', genre:'Thrash Metal',       spotifyUrl:'' },
  { id:'m19', artist:'Primitive Man',      album:'Insurmountable',                        cover:null, releaseDate:'2022-09-23', genre:'Doom Metal',         spotifyUrl:'' },
  { id:'m20', artist:'Inter Arma',         album:'New Heaven',                            cover:null, releaseDate:'2023-06-23', genre:'Doom Metal',         spotifyUrl:'' },
];

// Metal artist IDs on Spotify — stable, bypass search restrictions
const METAL_ARTIST_IDS = [
  '0ybFZ2Ab08V8hueghSXm6E', // Opeth
  '7bDLHytU8vohbiWbePGrdy', // Cannibal Corpse
  '3qNVuliS40BLgXGxhdBdqu', // Darkthrone
  '7lOWkBjOUYnqUoMJcZVFwA', // Blood Incantation
  '2ye2Wgw4gimLv2eAKyk1NB', // Mastodon
  '0SwO7SWeDHJijQ3XNS7xEE', // Gojira
  '7FBcuc1gsnv6Y1nwFtNRCb', // Trivium
  '2nRr1crKaFqRFwWf6B4nqo', // Lamb of God
  '6CoZPxQSbAELFGZic4ZZxn', // Sepultura
  '4sHJBKTqrPAqPFUBiH0Pix', // Kreator
  '2ye2Wgw4gimLv2eAKyk1NB', // Gatecreeper
  '1bDdiDELAChkf4U8GlFqZr', // Cattle Decapitation
  '7jVv8c5Fj3E9VhNjxT4snq', // Enforced
];

export async function GET() {
  try {
    const token = await getSpotifyToken();
    const seen    = new Set();
    const results = [];

    // Strategy 1: New releases endpoint — most reliable, designed for discovery
    try {
      const r = await fetch(
        'https://api.spotify.com/v1/browse/new-releases?limit=50&country=US',
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (r.ok) {
        const d = await r.json();
        for (const item of (d.albums?.items || [])) {
          if (!seen.has(item.id)) {
            seen.add(item.id);
            results.push(normalise(item));
          }
        }
      }
    } catch {}

    // Strategy 2: Get albums for specific metal artists
    for (const artistId of METAL_ARTIST_IDS.slice(0, 8)) {
      try {
        const r = await fetch(
          `https://api.spotify.com/v1/artists/${artistId}/albums?include_groups=album&limit=3&market=US`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        if (!r.ok) continue;
        const d = await r.json();
        for (const item of (d.items || [])) {
          if (!seen.has(item.id)) {
            seen.add(item.id);
            results.push(normalise(item));
          }
        }
      } catch {}
    }

    if (results.length === 0) throw new Error('Spotify returned no results — check app permissions in Spotify Dashboard');

    results.sort((a, b) => new Date(b.releaseDate) - new Date(a.releaseDate));
    return NextResponse.json({ releases: results.slice(0, 60), source: 'spotify' });

  } catch (e) {
    return NextResponse.json({ releases: MOCK, source: 'mock', notice: e.message });
  }
}
