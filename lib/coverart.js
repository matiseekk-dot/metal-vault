// ── Cover Art Archive client ──────────────────────────────────
// CAA is a free CC0 image archive run by MetaBrainz, indexed by
// MusicBrainz release-group / release MBIDs.
//
// Docs: https://wiki.musicbrainz.org/Cover_Art_Archive/API
//
// Strategy: when Discogs returns a release without `cover_image`, we
// resolve its MBID via MusicBrainz then ask CAA. We only return the URL
// — CAA's redirect chain is handled by the browser.
//
// No key, no rate-limit on CAA itself, but we still respect MB's 1/sec
// when chasing MBIDs through musicbrainz.js.

import { findReleaseGroupMbid } from '@/lib/musicbrainz';

const CAA_BASE = 'https://coverartarchive.org';

// ── Get cover URL by release-group MBID ───────────────────────
// CAA endpoint returns 307 redirect to archive.org image. The "front" cover
// is the canonical front-of-jacket. We use the "small" variant (250px) for
// search thumbs — much faster than full-size.
export function coverUrlFromMbid(mbid, size = 250) {
  if (!mbid) return null;
  // CAA URL convention: /release-group/{mbid}/front-{size} where size is
  // 250|500|1200. The endpoint redirects to the actual archive.org file.
  // 250 is enough for search rows, 500 for modal, 1200 for full-screen.
  const allowedSizes = new Set([250, 500, 1200]);
  const s = allowedSizes.has(size) ? size : 250;
  return `${CAA_BASE}/release-group/${mbid}/front-${s}`;
}

// ── Resolve cover by artist + album ───────────────────────────
// Two-step lookup: MusicBrainz to find release-group, then CAA URL.
// Returns null silently if either step fails — caller falls back to
// album-art placeholder.
//
// Note: this is a HEAVY operation (~1-2s due to MB throttle). Only use it
// as a fallback when the primary source (Discogs) didn't return a cover.
export async function findCoverByArtistAlbum(artist, album, size = 250) {
  const mbid = await findReleaseGroupMbid(artist, album);
  if (!mbid) return null;
  return coverUrlFromMbid(mbid, size);
}

// ── Verify cover exists at CAA ────────────────────────────────
// CAA returns 404 when there's no cover for an MBID. A HEAD request is
// cheap and lets us confirm before handing the URL to the browser. We
// skip this check by default — it's only useful when caching the URL.
export async function coverExistsForMbid(mbid) {
  if (!mbid) return false;
  try {
    const res = await fetch(`${CAA_BASE}/release-group/${mbid}`, {
      method: 'HEAD',
    });
    return res.ok;
  } catch {
    return false;
  }
}
