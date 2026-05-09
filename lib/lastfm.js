// ── Last.fm API client ────────────────────────────────────────
// Free API key from https://www.last.fm/api/account/create
// Set LASTFM_API_KEY in env. If unset, all functions degrade to null
// (callers should treat absence gracefully — never crash).
//
// Rate limit: 5 req/sec per key. We don't throttle here; expected use
// is one or two calls per artist page, not bulk.

const LF_BASE = 'https://ws.audioscrobbler.com/2.0/';

function key() {
  return process.env.LASTFM_API_KEY || null;
}

async function lfm(method, params = {}) {
  const k = key();
  if (!k) return null;  // graceful degradation when key missing
  const qs = new URLSearchParams({
    method,
    api_key: k,
    format:  'json',
    ...params,
  });
  try {
    const res = await fetch(`${LF_BASE}?${qs}`);
    if (!res.ok) return null;
    const d = await res.json();
    if (d.error) return null;     // Last.fm returns 200 OK with `{ error, message }`
    return d;
  } catch {
    return null;
  }
}

// ── Sanitize Last.fm bio ───────────────────────────────────────
// They append "<a href="...">Read more on Last.fm</a>" — we strip the link
// markup but keep readable text up to the marker.
function cleanBio(raw) {
  if (!raw) return '';
  // Strip the "User-contributed text is available under..." footer
  const cleaned = raw
    .replace(/<a [^>]+>Read more on Last\.fm<\/a>\s*\.?/gi, '')
    .replace(/User-contributed text is available[\s\S]*$/i, '')
    .replace(/<a [^>]+>([^<]+)<\/a>/g, '$1')           // unwrap remaining <a>
    .replace(/\n{3,}/g, '\n\n')                        // collapse blank lines
    .trim();
  return cleaned;
}

// ── Artist info ───────────────────────────────────────────────
// Returns bio, top tags, listeners, similar artists. autocorrect=1 fixes
// common misspellings ("opeth" → "Opeth").
export async function getArtistInfo(name, lang = 'en') {
  if (!name?.trim()) return null;
  const d = await lfm('artist.getInfo', {
    artist:      name,
    autocorrect: '1',
    lang,                                              // 'en', 'pl', 'de'
  });
  if (!d?.artist) return null;
  const a = d.artist;

  return {
    name:      a.name,
    mbid:      a.mbid || null,
    url:       a.url,
    listeners: parseInt(a.stats?.listeners || '0', 10),
    playcount: parseInt(a.stats?.playcount || '0', 10),
    tags:      (a.tags?.tag || []).map(t => t.name).slice(0, 8),
    bioSummary: cleanBio(a.bio?.summary),
    bioFull:    cleanBio(a.bio?.content),
    similar:   (a.similar?.artist || []).slice(0, 8).map(s => ({
      name: s.name,
      url:  s.url,
      // Last.fm dropped image URLs in 2019 — they all return the same
      // grey star placeholder now. We deliberately ignore s.image.
    })),
  };
}

// ── Similar artists ───────────────────────────────────────────
// Often the same artists appear in `getArtistInfo.similar` but this endpoint
// gives more (up to 100) and a numeric `match` score (0-1).
export async function getSimilarArtists(name, limit = 12) {
  if (!name?.trim()) return [];
  const d = await lfm('artist.getSimilar', {
    artist:      name,
    autocorrect: '1',
    limit:       String(limit),
  });
  if (!d?.similarartists?.artist) return [];
  return d.similarartists.artist.map(a => ({
    name:  a.name,
    url:   a.url,
    match: parseFloat(a.match) || 0,
    mbid:  a.mbid || null,
  }));
}

// ── Top tags for an artist ────────────────────────────────────
// Useful when bio is too short — tags often capture genre well.
export async function getArtistTopTags(name) {
  if (!name?.trim()) return [];
  const d = await lfm('artist.getTopTags', {
    artist:      name,
    autocorrect: '1',
  });
  if (!d?.toptags?.tag) return [];
  return d.toptags.tag
    .filter(t => parseInt(t.count, 10) > 5)            // drop one-off tags
    .slice(0, 8)
    .map(t => ({ name: t.name, count: parseInt(t.count, 10) }));
}

// ── Has key configured? ───────────────────────────────────────
// UI uses this to gate "Powered by Last.fm" attribution and to skip the
// bio/similar sections entirely if the operator hasn't set a key.
// ── User-context auth (web-auth flow) ─────────────────────────
// Last.fm web auth is dead simple compared to Spotify:
//   1. Send user to last.fm/api/auth?api_key=KEY&cb=CALLBACK
//   2. Last.fm bounces back with ?token=...
//   3. Server-side: auth.getSession(token, sig) → session_key (never expires)
//   4. All future user-context calls go with sk=<session_key>
//
// Why session_key never expires: Last.fm's design choice; great for
// us because we don't need refresh logic. Trade-off: leaked sk gives
// the leaker access until the user explicitly revokes from
// last.fm/settings/applications. We never expose sk to the client —
// stays server-side via spotify_tokens-style table.

import crypto from 'node:crypto';

function lfmSecret() { return process.env.LASTFM_SECRET || null; }

// Last.fm signs every authenticated method call with an md5 of the
// alphabetically-sorted params concatenated, then api_secret appended.
// `format=json` is intentionally NOT included in the signature
// (Last.fm's spec excludes it). Same for `callback`.
function sign(params) {
  const secret = lfmSecret();
  if (!secret) throw new Error('LASTFM_SECRET not configured');
  const sorted = Object.keys(params).sort()
    .filter(k => k !== 'format' && k !== 'callback')
    .map(k => k + params[k])
    .join('');
  return crypto.createHash('md5').update(sorted + secret, 'utf8').digest('hex');
}

export function lastfmAuthorizeUrl({ callbackUrl }) {
  const k = key();
  if (!k) return null;
  return 'https://www.last.fm/api/auth/?api_key=' + k +
    '&cb=' + encodeURIComponent(callbackUrl);
}

// Exchange the one-shot ?token=... for a permanent session_key.
// Returns { session_key, name } on success; throws on failure.
export async function lastfmGetSession(token) {
  const k = key();
  if (!k) throw new Error('Last.fm not configured');
  const params = { api_key: k, method: 'auth.getSession', token };
  const api_sig = sign(params);
  const qs = new URLSearchParams({ ...params, api_sig, format: 'json' });
  const r = await fetch(LF_BASE + '?' + qs.toString());
  if (!r.ok) throw new Error('Last.fm auth.getSession ' + r.status);
  const d = await r.json();
  if (d.error) throw new Error('Last.fm error ' + d.error + ': ' + d.message);
  if (!d.session?.key) throw new Error('Missing session.key');
  return { session_key: d.session.key, name: d.session.name || null };
}

// Pull a single page of recent tracks. Used by both the incremental
// sync (one page since last_synced_at) and the first-time backfill
// (paginate from page 1 onwards). Returns:
//   { tracks: filtered_array, totalPages: int, page: int }
export async function lastfmRecentTracksPage({ user, fromSec, page = 1, limit = 200 }) {
  const k = key();
  if (!k) throw new Error('Last.fm not configured');
  const params = {
    method:  'user.getRecentTracks',
    user,
    api_key: k,
    limit:   String(Math.min(limit, 200)),
    page:    String(Math.max(1, page)),
    format:  'json',
    extended: '0',
  };
  if (fromSec) params.from = String(fromSec);
  const r = await fetch(LF_BASE + '?' + new URLSearchParams(params).toString());
  if (!r.ok) throw new Error('Last.fm recenttracks ' + r.status);
  const d = await r.json();
  if (d.error) throw new Error('Last.fm error ' + d.error + ': ' + d.message);
  const raw = d.recenttracks?.track || [];
  const arr = Array.isArray(raw) ? raw : [raw];
  // "Now playing" entries lack a `date` — would re-import every sync. Drop.
  const tracks     = arr.filter(t => t.date && t.date.uts);
  const totalPages = Number(d.recenttracks?.['@attr']?.totalPages) || 1;
  return { tracks, totalPages, page: Number(d.recenttracks?.['@attr']?.page) || page };
}

// Convenience wrapper for the incremental case (one page, limit 200).
// Kept as a separate export so existing callsites don't change.
export async function lastfmRecentTracks({ user, fromSec, limit = 200 }) {
  const { tracks } = await lastfmRecentTracksPage({ user, fromSec, page: 1, limit });
  return tracks;
}

// ── Pre-aggregated top albums (preferred for Discovery) ──────
//
// Last.fm aggregates server-side and returns the top N albums for
// the user in a given period with playcounts attached. ONE request
// covers what `recenttracks` would need 60+ paginated calls to
// approximate, and the data is structurally what we need for
// Discovery: (artist, album, playcount). Period accepts:
//   '7day', '1month', '3month', '6month', '12month', 'overall'
//
// Returns an array of { artist, album, playcount, mbid?, image? }.
// Empty array on error — we degrade gracefully rather than crash
// the sync route.
export async function lastfmTopAlbums({ user, period = '3month', limit = 200 }) {
  const k = key();
  if (!k) throw new Error('Last.fm not configured');
  const params = {
    method:  'user.getTopAlbums',
    user,
    api_key: k,
    period,
    limit:   String(Math.min(limit, 1000)),
    format:  'json',
  };
  const r = await fetch(LF_BASE + '?' + new URLSearchParams(params).toString());
  if (!r.ok) throw new Error('Last.fm getTopAlbums ' + r.status);
  const d = await r.json();
  if (d.error) throw new Error('Last.fm error ' + d.error + ': ' + d.message);
  const raw = d.topalbums?.album || [];
  const arr = Array.isArray(raw) ? raw : [raw];
  return arr.map(a => ({
    artist:    a.artist?.name || a.artist?.['#text'] || '',
    album:     a.name || '',
    playcount: Number(a.playcount) || 0,
    mbid:      a.mbid || null,
  })).filter(a => a.artist && a.album && a.playcount > 0);
}

// Paginate ALL the way back (or as far as the page cap allows). Used
// only on first connect — subsequent syncs use the cheap one-page
// helper above gated by `from=last_synced_at`.
//
// Pagination order matters: Last.fm returns NEWEST first on page 1,
// progressively older pages 2..N. So an early-stop on `oldestAllowedSec`
// lets us bail once we hit data we don't need (e.g. older than the
// 90-day discovery window for a 50k-scrobble account).
//
// Caps:
//   • maxPages    — hard ceiling so we always fit in Vercel's 5min
//                   function timeout. 60 pages × 200 = 12k tracks.
//   • pacingMs    — 220ms between pages = ~4.5 req/sec, under Last.fm's
//                   informal 5/sec rate limit.
//
// onProgress(tracksSoFar, page, totalPages) — optional callback so a
// future progress UI can read the streaming counter.
export async function lastfmRecentTracksAll({ user, fromSec, maxPages = 60, pacingMs = 220, oldestAllowedSec, onProgress }) {
  const out = [];
  let page  = 1;
  let total = 1;
  while (page <= total && page <= maxPages) {
    const { tracks, totalPages } = await lastfmRecentTracksPage({ user, fromSec, page, limit: 200 });
    if (totalPages > total) total = totalPages;

    if (tracks.length === 0) break;
    out.push(...tracks);
    if (onProgress) {
      try { onProgress(out.length, page, total); } catch {}
    }

    // Early exit — if the OLDEST track on this page is already beyond
    // our retention window, the next pages are all older. Stop.
    if (oldestAllowedSec) {
      const oldestOnPage = Number(tracks[tracks.length - 1]?.date?.uts) || 0;
      if (oldestOnPage > 0 && oldestOnPage < oldestAllowedSec) break;
    }

    page++;
    if (page <= total && page <= maxPages) {
      await new Promise(r => setTimeout(r, pacingMs));
    }
  }
  return out;
}

export function isLastfmConfigured() {
  return !!key();
}
