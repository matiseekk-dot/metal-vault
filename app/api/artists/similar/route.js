export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';

let _token = null;
let _expiry = 0;

async function getToken() {
  if (_token && Date.now() < _expiry) return _token;
  const r = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: 'Basic ' + Buffer.from(
        process.env.SPOTIFY_CLIENT_ID + ':' + process.env.SPOTIFY_CLIENT_SECRET
      ).toString('base64'),
    },
    body: 'grant_type=client_credentials',
  });
  const d = await r.json();
  _token = d.access_token;
  _expiry = Date.now() + (d.expires_in - 60) * 1000;
  return _token;
}

export async function GET(request) {
  const artistName = new URL(request.url).searchParams.get('artist');
  if (!artistName) return NextResponse.json({ error: 'Provide artist' }, { status: 400 });
  if (!process.env.SPOTIFY_CLIENT_ID) return NextResponse.json({ artists: [] });

  try {
    const token = await getToken();

    // Find artist ID
    const searchRes = await fetch(
      'https://api.spotify.com/v1/search?q=' + encodeURIComponent(artistName) + '&type=artist&limit=1',
      { headers: { Authorization: 'Bearer ' + token } }
    );
    const searchData = await searchRes.json();
    const artistId = searchData.artists?.items?.[0]?.id;
    if (!artistId) return NextResponse.json({ artists: [] });

    // Get related artists
    const relatedRes = await fetch(
      'https://api.spotify.com/v1/artists/' + artistId + '/related-artists',
      { headers: { Authorization: 'Bearer ' + token } }
    );
    if (!relatedRes.ok) return NextResponse.json({ artists: [] });
    const relatedData = await relatedRes.json();

    const artists = (relatedData.artists || []).slice(0, 6).map(a => ({
      id:       a.id,
      name:     a.name,
      image:    a.images?.[0]?.url || null,
      genres:   a.genres?.slice(0, 2) || [],
      popularity: a.popularity,
      spotifyUrl: a.external_urls?.spotify || '',
    }));

    return NextResponse.json({ artists, sourceArtist: artistName });
  } catch (e) {
    return NextResponse.json({ artists: [], error: e.message });
  }
}
