// ── Diagnostic endpoint for Spotify image lookup ─────────────
//
// GET /api/artists/image/debug?name=Opeth
//
// Returns a structured breakdown of what happened during the lookup
// so an operator can see whether the env vars are loaded, the token
// request succeeded, and Spotify returned anything for the query.
//
// Intentionally NOT cached. Returns 200 even on errors — the body
// describes the failure mode so curl shows it cleanly.

import { NextResponse } from 'next/server';
import { isSpotifyConfigured, findArtistImage } from '@/lib/spotify';
import { isLastfmConfigured } from '@/lib/lastfm';

export const dynamic = 'force-dynamic';

export async function GET(req) {
  const name = (new URL(req.url).searchParams.get('name') || 'Opeth').trim();
  const t0 = Date.now();

  const out = {
    query:                 name,
    spotify_configured:    isSpotifyConfigured(),
    lastfm_configured:     isLastfmConfigured(),
    musicbrainz_contact:   !!process.env.MUSICBRAINZ_CONTACT,
    spotify_client_id_present: !!process.env.SPOTIFY_CLIENT_ID,
    spotify_secret_present:    !!process.env.SPOTIFY_CLIENT_SECRET,
    lastfm_key_present:        !!process.env.LASTFM_API_KEY,
  };

  if (!out.spotify_configured) {
    out.error = 'SPOTIFY_CLIENT_ID and/or SPOTIFY_CLIENT_SECRET are not set in this environment';
    out.fix   = 'Add both to Vercel → Project → Settings → Environment Variables, then trigger a Redeploy (env changes need a redeploy to take effect).';
    return NextResponse.json(out, { headers: { 'Cache-Control': 'no-store' } });
  }

  // Try the actual lookup. If anything throws or returns null we
  // capture the timing — useful for spotting slow cold starts.
  try {
    const meta = await findArtistImage(name);
    out.lookup_ms = Date.now() - t0;
    out.image_found = !!meta?.image;
    out.image_url   = meta?.image || null;
    out.thumb_url   = meta?.thumb || null;
    out.popularity  = meta?.popularity ?? null;
    if (!meta?.image) {
      out.note = 'Spotify is configured but returned no image for this query. Either the artist name has no match (try a different one like "Opeth") or the token request silently failed.';
    }
  } catch (e) {
    out.lookup_ms = Date.now() - t0;
    out.error = e.message || String(e);
  }

  return NextResponse.json(out, { headers: { 'Cache-Control': 'no-store' } });
}
