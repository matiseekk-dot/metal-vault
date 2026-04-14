export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';

export async function GET() {
  const id = process.env.SPOTIFY_CLIENT_ID;
  const secret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!id || !secret) return NextResponse.json({ error: 'Keys not set' });

  const tokenRes = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: 'Basic ' + Buffer.from(id + ':' + secret).toString('base64'),
    },
    body: 'grant_type=client_credentials',
    cache: 'no-store',
  });
  const tokenData = await tokenRes.json();
  if (!tokenData.access_token) return NextResponse.json({ step: 'token_failed', data: tokenData });

  const [artistRes, albumsRes] = await Promise.all([
    fetch('https://api.spotify.com/v1/artists/0ybFZ2Ab08V8hueghSXm6E', { headers: { Authorization: 'Bearer ' + tokenData.access_token } }),
    fetch('https://api.spotify.com/v1/artists/0ybFZ2Ab08V8hueghSXm6E/albums?limit=3', { headers: { Authorization: 'Bearer ' + tokenData.access_token } }),
  ]);
  const [artist, albums] = await Promise.all([artistRes.json(), albumsRes.json()]);

  return NextResponse.json({
    token: 'ok',
    artist_status: artistRes.status,
    artist: artist.name || artist.error,
    albums_status: albumsRes.status,
    albums: albums.items?.map(a=>a.name) || albums.error,
  });
}
