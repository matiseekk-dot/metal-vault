// ── Diagnostic endpoint for Spotify image lookup ─────────────
//
// GET /api/artists/image/debug?name=Opeth
//
// Goes step-by-step through the Spotify auth + search flow, surfacing
// exact status codes and body excerpts at each stage. This reveals
// failures that the production helpers swallow (try/catch → null) and
// keeps the operator from having to grep Vercel function logs.
//
// Intentionally NOT cached.

import { NextResponse } from 'next/server';
import { isSpotifyConfigured } from '@/lib/spotify';
import { isLastfmConfigured } from '@/lib/lastfm';
import { findArtistImage as findFromDeezer } from '@/lib/deezer';

export const dynamic = 'force-dynamic';

const NO_CACHE = { 'Cache-Control': 'no-store' };

export async function GET(req) {
  const name = (new URL(req.url).searchParams.get('name') || 'Opeth').trim();

  const out = {
    query:                     name,
    spotify_configured:        isSpotifyConfigured(),
    lastfm_configured:         isLastfmConfigured(),
    musicbrainz_contact:       !!process.env.MUSICBRAINZ_CONTACT,
    spotify_client_id_present: !!process.env.SPOTIFY_CLIENT_ID,
    spotify_secret_present:    !!process.env.SPOTIFY_CLIENT_SECRET,
    lastfm_key_present:        !!process.env.LASTFM_API_KEY,
    // Trim env so we can verify they're not zero-length without exposing values
    spotify_client_id_len:     (process.env.SPOTIFY_CLIENT_ID || '').length,
    spotify_secret_len:        (process.env.SPOTIFY_CLIENT_SECRET || '').length,
  };

  if (!out.spotify_configured) {
    out.error = 'SPOTIFY_CLIENT_ID and/or SPOTIFY_CLIENT_SECRET are not set';
    out.fix   = 'Vercel → Project → Settings → Environment Variables → add both → Deployments → ⋯ → Redeploy';
    return NextResponse.json(out, { headers: NO_CACHE });
  }

  // ── Step 1: token request ─────────────────────────────────
  const t0 = Date.now();
  let token = null;
  try {
    const id     = (process.env.SPOTIFY_CLIENT_ID     || '').trim();
    const secret = (process.env.SPOTIFY_CLIENT_SECRET || '').trim();
    const r = await fetch('https://accounts.spotify.com/api/token', {
      method:  'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization:  'Basic ' + Buffer.from(id + ':' + secret).toString('base64'),
      },
      body: 'grant_type=client_credentials',
    });
    out.token_status = r.status;
    out.token_ms     = Date.now() - t0;
    const text = await r.text();
    if (!r.ok) {
      // Common errors: 400 invalid_client (wrong id/secret), 401 invalid_client_secret
      out.token_error_body = text.slice(0, 400);
      out.diagnosis = (
        r.status === 400 ? 'invalid_client — Spotify rejected the credentials. Likely a copy-paste issue (extra space, wrong field swapped). Verify SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET in Vercel → Settings → Environment Variables match exactly the values from developer.spotify.com → your app.'
      : r.status === 401 ? 'invalid_client_secret — the secret is wrong. Regenerate at developer.spotify.com → your app → Settings → View client secret → copy → paste in Vercel → Redeploy.'
      : 'Token request failed; see token_error_body for the raw Spotify error message.'
      );
      return NextResponse.json(out, { headers: NO_CACHE });
    }
    let json; try { json = JSON.parse(text); } catch { json = {}; }
    token = json.access_token || null;
    out.token_received    = !!token;
    out.token_expires_in  = json.expires_in || null;
    if (!token) {
      out.diagnosis = 'Spotify returned 200 but no access_token in body. Unusual — paste body to anthropic for help.';
      out.token_body_excerpt = text.slice(0, 200);
      return NextResponse.json(out, { headers: NO_CACHE });
    }
  } catch (e) {
    out.token_error = e.message || String(e);
    out.diagnosis = 'Token request threw — likely network or runtime error. Check Vercel function logs.';
    return NextResponse.json(out, { headers: NO_CACHE });
  }

  // ── Step 2: search request ────────────────────────────────
  const t1 = Date.now();
  try {
    const url = 'https://api.spotify.com/v1/search?type=artist&limit=5&q=' + encodeURIComponent(name);
    const r = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
    out.search_status = r.status;
    out.search_ms     = Date.now() - t1;
    const text = await r.text();
    if (!r.ok) {
      out.search_error_body = text.slice(0, 400);
      // Detect Spotify's late-2024 "Premium required for app owner" policy.
      // Body looks like: {"error":{"status":403,"message":"Active premium
      // subscription required for the owner of the app..."}}
      const isPremiumRequired = r.status === 403 && /premium subscription required/i.test(text);
      if (isPremiumRequired) {
        out.spotify_premium_required = true;
        out.diagnosis = 'Spotify changed their policy in late 2024 — the OWNER of the developer app (i.e. the Spotify account that created it at developer.spotify.com) must hold an active Premium subscription, even for client_credentials server-to-server flow. Without it, all /search calls return 403 with this body. NOT YOUR FAULT — this is Spotify\'s gatekeeping. Workaround: the app now falls back to Deezer (free, no auth) — it should still serve artist photos. Test below.';
      } else {
        out.diagnosis = (
          r.status === 401 ? 'Search rejected with 401 — token expired or scope issue.'
        : r.status === 403 ? 'Search rejected with 403 (not premium-required). Try Extended Quota Mode in developer.spotify.com.'
        : r.status === 429 ? 'Rate-limited. Wait 30s and retry.'
        : 'Search returned ' + r.status + '. See search_error_body.'
        );
      }

      // ── Always try Deezer as fallback so the operator can confirm
      //    the user-facing experience will work
      try {
        const dz = await findFromDeezer(name);
        out.deezer = {
          tried:        true,
          image_found:  !!dz?.image,
          image_url:    dz?.image || null,
          deezer_url:   dz?.deezerUrl || null,
        };
        if (dz?.image) {
          out.diagnosis += ' ✅ Deezer fallback successfully returned an image — the live UI will use this.';
        } else {
          out.diagnosis += ' ❌ Deezer also returned nothing for this artist — try /api/artists/image/debug?name=Metallica to see if Deezer works at all.';
        }
      } catch (e) {
        out.deezer = { tried: true, error: e.message };
      }
      return NextResponse.json(out, { headers: NO_CACHE });
    }
    let json; try { json = JSON.parse(text); } catch { json = {}; }
    const items = json.artists?.items || [];
    out.search_total_hits = items.length;
    out.search_top_artists = items.slice(0, 3).map(a => ({
      name:       a.name,
      popularity: a.popularity,
      images:     (a.images || []).map(i => ({ url: i.url, w: i.width, h: i.height })),
    }));
    if (items.length === 0) {
      out.diagnosis = 'Spotify returned 0 results for this query. Try /api/artists/image/debug?name=Metallica — if THAT works, the original query just had no match.';
    } else if (!items[0].images?.length) {
      out.diagnosis = 'Spotify found the artist but has no profile image for them. This is the case for some indie / small artists. Try a more popular query.';
    } else {
      out.diagnosis = '✅ All good — Spotify returned an image for the top hit. If the app UI still shows letter circles, it\'s probably the edge cache from before the fix landed; v=2 cache-buster in the latest deploy should solve it.';
      out.image_url = items[0].images[0].url;
    }
  } catch (e) {
    out.search_error = e.message || String(e);
    out.diagnosis = 'Search threw — likely network. Check Vercel function logs.';
  }

  return NextResponse.json(out, { headers: NO_CACHE });
}
