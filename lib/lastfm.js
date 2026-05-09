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

// Pull recent tracks for a user. `from` is unix seconds; Last.fm
// returns plays *after* that timestamp inclusive. Limit 200 max.
export async function lastfmRecentTracks({ user, fromSec, limit = 200 }) {
  const k = key();
  if (!k) throw new Error('Last.fm not configured');
  const params = {
    method:  'user.getRecentTracks',
    user,
    api_key: k,
    limit:   String(Math.min(limit, 200)),
    format:  'json',
    extended: '0',
  };
  if (fromSec) params.from = String(fromSec);
  const r = await fetch(LF_BASE + '?' + new URLSearchParams(params).toString());
  if (!r.ok) throw new Error('Last.fm recenttracks ' + r.status);
  const d = await r.json();
  if (d.error) throw new Error('Last.fm error ' + d.error + ': ' + d.message);
  // recenttracks.track is sometimes a single object instead of an
  // array when there's only one result — normalise.
  const raw = d.recenttracks?.track || [];
  const arr = Array.isArray(raw) ? raw : [raw];
  // Filter out "now playing" tracks (no @attr.nowplaying date) — those
  // don't have a `date` field and would re-import on every sync.
  return arr.filter(t => t.date && t.date.uts);
}

export function isLastfmConfigured() {
  return !!key();
}
