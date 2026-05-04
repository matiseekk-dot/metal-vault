// ── Artist relations endpoint ─────────────────────────────────
//
// GET /api/artists/related?name=<artist>&mbid=<optional>
//
// Returns:
//   { artist, bio, tags, members, exMembers, sideProjects, similar, urls }
//
// Sources:
//   • MusicBrainz — definitive for members / ex-members / collaborations
//   • Last.fm     — bio + similar (only if LASTFM_API_KEY set)
//
// Why a new endpoint instead of extending /api/artists/similar? Similar is
// Spotify-only and intentionally narrow. Related aggregates the deeper
// "bands this person played in / was in" graph that the Search tab and
// BandsTab need together.
//
// Caching: 24h edge cache. Member relations don't change often.

import { NextResponse } from 'next/server';
import { rateLimit } from '@/lib/rate-limit';
import { searchArtist as mbSearchArtist, getArtistRelations } from '@/lib/musicbrainz';
import { getArtistInfo, getSimilarArtists, isLastfmConfigured } from '@/lib/lastfm';
import { findArtistImage } from '@/lib/spotify';

export const dynamic = 'force-dynamic';

export async function GET(req) {
  const rl = rateLimit(req, { max: 30, windowMs: 60_000 });
  if (!rl.ok) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }

  const { searchParams } = new URL(req.url);
  const name = (searchParams.get('name') || searchParams.get('artist') || '').trim();
  let   mbid = (searchParams.get('mbid') || '').trim() || null;
  const lang = (searchParams.get('lang') || 'en').toLowerCase();

  if (!name) {
    return NextResponse.json({ error: 'Provide name' }, { status: 400 });
  }

  // Resolve MBID if not given. We use MB's relevance score to pick the top
  // match — typically score >= 90 for exact-name hits. If no match, we still
  // return a partial response (Last.fm bio works without MBID).
  if (!mbid) {
    const matches = await mbSearchArtist(name, 1);
    mbid = matches[0]?.mbid || null;
  }

  // Run MB + Last.fm + Spotify image in parallel — independent providers.
  // Spotify is the only public source that still serves artist photos
  // (Last.fm dropped them in 2019); it adds ~200ms typical.
  const [rels, lfmInfo, lfmSimilar, spotifyMeta] = await Promise.all([
    mbid ? getArtistRelations(mbid) : Promise.resolve(null),
    getArtistInfo(name, lang),
    getSimilarArtists(name, 12),
    findArtistImage(name),
  ]);

  // Split MB members into current vs ex- for cleaner UI sections.
  const allMembers = rels?.members || [];
  const members    = allMembers.filter(m => m.active);
  const exMembers  = allMembers.filter(m => !m.active);

  // Side projects = bands the artist (if Person) played in beyond their main
  // affiliation, plus collaborations.
  const sideProjects = (rels?.bands || []).slice(0, 12);

  // Merge similar lists from Last.fm. We dedupe by name (case-insensitive)
  // and keep Last.fm's `match` score where present.
  const similarMap = new Map();
  for (const s of (lfmSimilar || [])) {
    similarMap.set(s.name.toLowerCase(), { name: s.name, match: s.match, source: 'lastfm', mbid: s.mbid });
  }
  for (const s of (lfmInfo?.similar || [])) {
    const k = s.name.toLowerCase();
    if (!similarMap.has(k)) similarMap.set(k, { name: s.name, match: null, source: 'lastfm' });
  }
  const similar = [...similarMap.values()].slice(0, 12);

  // Tag union: MB tags + Last.fm tags. MB tags are user-curated (cleaner);
  // Last.fm tags are richer but noisier. We keep MB first, then unique LFM.
  const tagSet = new Set();
  const tags = [];
  for (const t of (rels?.tags || [])) {
    if (!tagSet.has(t.toLowerCase())) { tagSet.add(t.toLowerCase()); tags.push(t); }
  }
  for (const t of (lfmInfo?.tags || [])) {
    if (!tagSet.has(t.toLowerCase())) { tagSet.add(t.toLowerCase()); tags.push(t); }
  }

  return NextResponse.json(
    {
      artist:       rels?.name || lfmInfo?.name || name,
      mbid,
      type:         rels?.type || null,
      country:      rels?.country || null,
      lifeSpan:     rels?.lifeSpan || null,
      tags:         tags.slice(0, 10),
      // Image + Spotify metadata for the artist hero. Genres from Spotify
      // overlap with MB/Last.fm tags but are often more curated.
      image:        spotifyMeta?.image || null,
      thumb:        spotifyMeta?.thumb || null,
      spotifyId:    spotifyMeta?.spotifyId || null,
      spotifyUrl:   spotifyMeta?.spotifyUrl || null,
      popularity:   spotifyMeta?.popularity ?? null,
      bio: {
        summary:  lfmInfo?.bioSummary || '',
        full:     lfmInfo?.bioFull || '',
        source:   lfmInfo ? 'lastfm' : null,
      },
      stats: lfmInfo ? {
        listeners: lfmInfo.listeners,
        playcount: lfmInfo.playcount,
      } : null,
      members,                          // current members of this band (if Group)
      exMembers,                        // past members
      sideProjects,                     // bands this Person played in (if Person)
      similar,
      urls:         rels?.urls || {},
      // Helps the UI show "bio powered by Last.fm" credit, or hide it
      // gracefully when key is unset.
      lastfmConfigured: isLastfmConfigured(),
    },
    {
      headers: {
        'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=604800',
      },
    }
  );
}
