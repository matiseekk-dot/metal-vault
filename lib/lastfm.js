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

// ── Pre-aggregated top albums — single page ────────────────────
//
// Last.fm aggregates server-side and returns top N albums with
// playcounts. Each page returns up to 1000 albums; account-overall
// for power users can need 5-30 pages. lastfmTopAlbumsAll below
// handles the pagination loop.
//
// period: '7day' | '1month' | '3month' | '6month' | '12month' | 'overall'
// Returns: { albums: [{ artist, album, playcount, mbid }], totalPages }
async function lastfmTopAlbumsPage({ user, period = 'overall', limit = 1000, page = 1 }) {
  const k = key();
  if (!k) throw new Error('Last.fm not configured');
  const params = {
    method:  'user.getTopAlbums',
    user,
    api_key: k,
    period,
    limit:   String(Math.min(limit, 1000)),
    page:    String(Math.max(1, page)),
    format:  'json',
  };
  const r = await fetch(LF_BASE + '?' + new URLSearchParams(params).toString());
  if (!r.ok) throw new Error('Last.fm getTopAlbums ' + r.status);
  const d = await r.json();
  if (d.error) throw new Error('Last.fm error ' + d.error + ': ' + d.message);
  const raw = d.topalbums?.album || [];
  const arr = Array.isArray(raw) ? raw : [raw];
  const albums = arr.map(a => ({
    artist:    a.artist?.name || a.artist?.['#text'] || '',
    album:     a.name || '',
    playcount: Number(a.playcount) || 0,
    mbid:      a.mbid || null,
  })).filter(a => a.artist && a.album && a.playcount > 0);
  return {
    albums,
    totalPages: Number(d.topalbums?.['@attr']?.totalPages) || 1,
  };
}

// Convenience for one page (back-compat).
export async function lastfmTopAlbums({ user, period = 'overall', limit = 1000 }) {
  const { albums } = await lastfmTopAlbumsPage({ user, period, limit, page: 1 });
  return albums;
}

// Paginate ALL top albums for the user. No artificial limit on the
// total — caps only at maxPages × 1000 (default 30k albums) to fit
// inside Vercel's 5-min function ceiling. Realistic users top out
// at 1k-5k unique albums even for 15+ years of scrobbling, so the
// cap is mostly insurance.
export async function lastfmTopAlbumsAll({ user, period = 'overall', maxPages = 30, pacingMs = 250, onProgress }) {
  const out = [];
  let page  = 1;
  let total = 1;
  while (page <= total && page <= maxPages) {
    const { albums, totalPages } = await lastfmTopAlbumsPage({
      user, period, limit: 1000, page,
    });
    if (totalPages > total) total = totalPages;
    if (albums.length === 0) break;
    out.push(...albums);
    if (onProgress) {
      try { onProgress(out.length, page, total); } catch {}
    }
    page++;
    if (page <= total && page <= maxPages) {
      await new Promise(r => setTimeout(r, pacingMs));
    }
  }
  return out;
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
export async function lastfmRecentTracksAll({ user, fromSec, maxPages = 60, pacingMs = 220, oldestAllowedSec, onProgress, deadlineMs }) {
  const out = [];
  let page  = 1;
  let total = 1;
  let consecutiveEmpty = 0;
  let lastTotalPages = 0;
  const startedAt = Date.now();
  while (page <= total && page <= maxPages) {
    // Honour the soft time budget — for power users with 100k+ scrobbles
    // we may run up against Vercel's 300s function ceiling. Bail with
    // partial data rather than crashing the whole sync.
    if (deadlineMs && (Date.now() - startedAt) >= deadlineMs) break;

    const { tracks, totalPages } = await lastfmRecentTracksPage({ user, fromSec, page, limit: 200 });
    if (totalPages > total) total = totalPages;
    lastTotalPages = totalPages;

    if (tracks.length === 0) {
      // Don't bail on the first empty page — Last.fm occasionally
      // returns transient empties mid-pagination (sometimes when a
      // page boundary lines up with a "now playing" we filtered out).
      // Only stop after 3 consecutive empty pages, which is a real
      // signal we've passed the end of the user's history.
      consecutiveEmpty++;
      if (consecutiveEmpty >= 3) break;
    } else {
      consecutiveEmpty = 0;
      out.push(...tracks);
      if (onProgress) {
        try { onProgress(out.length, page, total); } catch {}
      }
    }

    // Early exit — if the OLDEST track on this page is already beyond
    // our retention window, the next pages are all older. Stop.
    if (oldestAllowedSec && tracks.length > 0) {
      const oldestOnPage = Number(tracks[tracks.length - 1]?.date?.uts) || 0;
      if (oldestOnPage > 0 && oldestOnPage < oldestAllowedSec) break;
    }

    page++;
    if (page <= total && page <= maxPages) {
      await new Promise(r => setTimeout(r, pacingMs));
    }
  }
  // Attach diagnostics as a non-enumerable so existing callers using
  // Array methods don't see them, but the sync route can still read.
  Object.defineProperty(out, '__pages',      { value: page - 1,        enumerable: false });
  Object.defineProperty(out, '__totalPages', { value: lastTotalPages,  enumerable: false });
  Object.defineProperty(out, '__elapsedMs',  { value: Date.now() - startedAt, enumerable: false });
  return out;
}

export function isLastfmConfigured() {
  return !!key();
}

// ── Last.fm events scraping ────────────────────────────────────
//
// Last.fm shut down their public events API in 2018, but the events
// PAGES at /music/{artist}/+events still render with structured data
// (schema.org/MusicEvent inside JSON-LD <script> blocks). That's the
// surface meant for Google's Knowledge Graph crawler, so it's
// relatively stable — bigger schema changes would break their own
// SEO. We piggyback on it for our concerts feed.
//
// Rate: be polite, 1 req/sec per artist (sequential in caller). No
// auth header needed; just a friendly User-Agent so Last.fm doesn't
// rate-limit us as anonymous botnet traffic.
//
// Returns: array of events shaped like Ticketmaster events for plug-
// compatibility with /api/concerts.

const LFM_UA = 'MetalVault/1.0 (+https://metal-vault-six.vercel.app) concert-discovery';

// Country code → ISO-2 mapping for the few full-name countries
// Last.fm uses in markup. The Ticketmaster path stored ISO-2 already
// so we normalise here to keep the UI rendering consistent.
const COUNTRY_ISO = {
  'Poland': 'PL', 'Germany': 'DE', 'United Kingdom': 'GB', 'UK': 'GB',
  'United States': 'US', 'USA': 'US', 'Czechia': 'CZ', 'Czech Republic': 'CZ',
  'Netherlands': 'NL', 'Belgium': 'BE', 'Austria': 'AT', 'Switzerland': 'CH',
  'France': 'FR', 'Spain': 'ES', 'Italy': 'IT', 'Sweden': 'SE',
  'Norway': 'NO', 'Denmark': 'DK', 'Finland': 'FI', 'Ireland': 'IE',
  'Hungary': 'HU', 'Slovakia': 'SK', 'Lithuania': 'LT', 'Latvia': 'LV',
  'Estonia': 'EE', 'Portugal': 'PT', 'Greece': 'GR', 'Croatia': 'HR',
  'Slovenia': 'SI', 'Romania': 'RO', 'Bulgaria': 'BG',
};
function toIso2(name) {
  if (!name) return '';
  const n = String(name).trim();
  if (/^[A-Z]{2}$/.test(n)) return n;        // already an ISO code
  return COUNTRY_ISO[n] || n;                // fall back to whatever Last.fm sent
}

// Pull every JSON-LD <script> block from raw HTML. Last.fm embeds one
// or more per page — typically the artist info block + an Event array.
// We return an array of parsed JS objects; malformed blocks are dropped.
function extractJsonLdBlocks(html) {
  if (!html) return [];
  const out = [];
  // Capture between <script type="application/ld+json"> and </script>.
  // Last.fm's attribute order is stable but we allow either dq/sq just
  // in case they ever switch quoting style.
  const rx = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = rx.exec(html)) !== null) {
    const raw = m[1].trim();
    if (!raw) continue;
    try {
      // Last.fm occasionally injects HTML entities in the JSON
      // payload (&quot;, &amp;); normalise the most common ones.
      const decoded = raw
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, '&')
        .replace(/&#39;/g, "'");
      out.push(JSON.parse(decoded));
    } catch {
      // Silently drop a bad block — we want the OTHER blocks parsed.
    }
  }
  return out;
}

// Walk the JSON-LD soup looking for MusicEvent (or generic Event)
// entries. The structure is sometimes flat (top-level array) and
// sometimes a graph with @graph wrapping the events.
function collectMusicEvents(blocks) {
  const events = [];
  const visit = (node) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { for (const n of node) visit(n); return; }
    const t = node['@type'];
    if (t === 'MusicEvent' || t === 'Event' || (Array.isArray(t) && t.includes('MusicEvent'))) {
      events.push(node);
    }
    if (node['@graph']) visit(node['@graph']);
    if (node.event)     visit(node.event);
  };
  for (const b of blocks) visit(b);
  return events;
}

// One JSON-LD MusicEvent → our internal Event shape, matching what
// the Ticketmaster mapper outputs so the UI doesn't care which
// source filled the row.
function mapLastfmEvent(ev, artistName) {
  if (!ev) return null;
  const datetime = ev.startDate || null;
  if (!datetime) return null;     // unscheduled / TBA — skip

  const loc      = ev.location || {};
  const address  = loc.address || {};
  const geo      = loc.geo || {};
  const venue    = loc.name || address.name || 'Unknown venue';
  const city     = address.addressLocality || '';
  const region   = address.addressRegion   || '';
  const country  = toIso2(address.addressCountry || address.country || '');

  // Lat / lng — Last.fm doesn't always supply these. When present they
  // power the radius-km location filter in UpcomingConcertsTab.
  const lat = geo.latitude  != null ? Number(geo.latitude)  : null;
  const lng = geo.longitude != null ? Number(geo.longitude) : null;

  // Lineup — Last.fm puts performers in `performer` (single object OR
  // array). We always coerce to an array and put the queried artist
  // first so the row shows that name even when they're the support act.
  const performersRaw = Array.isArray(ev.performer) ? ev.performer
                       : ev.performer ? [ev.performer] : [];
  const lineup = performersRaw
    .map(p => p?.name)
    .filter(Boolean);
  if (artistName && !lineup.some(n => n.toLowerCase() === artistName.toLowerCase())) {
    lineup.unshift(artistName);
  }

  // Ticket URL — JSON-LD events often have `offers.url`. If absent we
  // fall back to the event's own URL on Last.fm.
  const offersUrl = Array.isArray(ev.offers) ? ev.offers[0]?.url : ev.offers?.url;
  const ticketsUrl = offersUrl || ev.url || null;
  const onSale = Array.isArray(ev.offers)
    ? ev.offers.some(o => /InStock|LimitedAvailability/i.test(o?.availability || ''))
    : /InStock|LimitedAvailability/i.test(ev.offers?.availability || '');

  return {
    // Synthesise a stable ID. JSON-LD events sometimes lack an @id, so
    // we hash venue + datetime + artist for dedupe purposes downstream.
    id:        ev['@id'] || ('lfm:' + (artistName || '') + ':' + datetime + ':' + venue),
    datetime,
    venue,
    city,
    region,
    country,
    lat,
    lng,
    lineup,
    ticketsUrl,
    onSale,
    source:    'lastfm',
  };
}

// ── HTML-based event parser ────────────────────────────────────
//
// Last.fm in 2026 stopped emitting schema.org/MusicEvent JSON-LD on
// events pages (both /music/{artist}/+events and /user/{name}/events)
// — instead they render plain semantic HTML tables. This parser
// pulls events out of that markup using regex on stable structural
// classes that survive their Webpack hash bumps:
//   <tr class="events-list-item ...">
//     <td class="events-list-item-art">
//       <time datetime="2026-10-29T..."> ... </time>
//     </td>
//     <td class="events-list-item-event">
//       <div class="events-list-item-event--title">
//         <a href="/event/XXX">Event Name</a>
//       </div>
//       <div class="events-list-item-event--lineup">Band1, Band2, Band3</div>
//     </td>
//     <td class="events-list-item-venue">
//       <div class="events-list-item-venue--title">Venue</div>
//       <div class="events-list-item-venue--city">City</div>
//       <div class="events-list-item-venue--country">Country</div>
//     </td>
//   </tr>
//
// Two passes:
//   1) Find every <tr class="...events-list-item..."> block
//   2) Extract datetime / title / lineup / venue / city / country
//
// Country names get the existing ISO-2 normaliser applied. Lineup
// names are comma-split + trimmed. Missing fields are tolerated —
// any partial row produces null and gets dropped by the caller.

// Strip HTML tags, decode common entities, collapse whitespace.
function stripHtml(s) {
  if (!s) return '';
  return String(s)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Pull a CSS-class block out of an HTML fragment. Tracks nested
// same-named tags so cells containing inline anchors (e.g. the lineup
// cell — `<div class="lineup"><a>Band1</a>, <a>Band2</a></div>`) get
// captured WHOLE rather than truncated at the first `</a>`.
//
// Old version used `[\s\S]*?</` which non-greedily stopped at the
// FIRST closing tag of any kind. That worked for cells with plain
// text but caused the long-running "lineup cell only shows 1 band"
// bug — Last.fm renders every band as an <a href="/music/X">X</a>,
// the old regex captured `<a href="/music/Band1">Band1` and stopped,
// stripping all subsequent bands. Stripping HTML left just "Band1".
function extractClassBlock(html, cls) {
  if (!html) return '';
  const openRx = new RegExp('<(\\w+)\\b[^>]*class="[^"]*\\b' + cls + '\\b[^"]*"[^>]*>', 'i');
  const open = html.match(openRx);
  if (!open) return '';
  const tag = open[1].toLowerCase();
  const bodyStart = open.index + open[0].length;
  const openPrefix  = '<' + tag;
  const closePrefix = '</' + tag;
  const lower = html.toLowerCase();
  let depth = 1;
  let i = bodyStart;
  // Walk forward, only counting tags that match `tag` (case-insensitive).
  // Each `<tag>` at our level increments depth; each `</tag>` decrements.
  // Return body content when depth returns to 0.
  while (i < html.length && depth > 0) {
    const nextOpen  = lower.indexOf(openPrefix,  i);
    const nextClose = lower.indexOf(closePrefix, i);
    if (nextClose === -1) return html.slice(bodyStart);  // unbalanced — give up
    // Verify the open match isn't a longer prefix collision ("<div" vs "<divider").
    // The character right after the prefix must be one that ends a tag name.
    const validOpen = (nextOpen !== -1) && /[\s/>]/.test(html[nextOpen + openPrefix.length] || '');
    if (validOpen && nextOpen < nextClose) {
      depth++;
      i = nextOpen + openPrefix.length;
    } else {
      depth--;
      if (depth === 0) return html.slice(bodyStart, nextClose);
      i = nextClose + closePrefix.length;
    }
  }
  return '';
}

function parseLastfmHtmlEvents(html, fallbackArtist) {
  if (!html) return [];
  // Last.fm has TWO markup variants for events lists:
  //
  //   • USER page  (/user/X/events, /user/X/events/YYYY)
  //       <div class="events-list-item-event--title"><a>NAME</a></div>
  //       <div class="events-list-item-event--lineup">Band1, Band2, Band3</div>
  //       <div class="events-list-item-venue--city">City</div>
  //       <div class="events-list-item-venue--country">Country</div>
  //
  //   • ARTIST page  (/music/X/+events, /festival/...)
  //       <a class="events-list-item-event-name">NAME</a>
  //       <div class="events-list-item-acts">
  //         <span itemprop="name">Band1</span>, <span itemprop="name">Band2</span>
  //       </div>
  //       <div class="events-list-item-venue--address">City, Country</div>
  //
  // Both share the outer <tr class="events-list-item"> wrapper and the
  // <time datetime="..."> attribute. We probe both class-name variants
  // and pick whichever yielded non-empty content.

  // Two-phase row extraction:
  //
  //   Phase 1 (primary): `<tr class="events-list-item">...</tr>`.
  //     The proven-working case for Last.fm's table-based listings.
  //     Non-greedy `</tr>` is safe because rows don't nest <tr>.
  //
  //   Phase 2 (fallback): nested-aware extraction for div / li /
  //     article wrappers. The previous commit naïvely added these
  //     to the SAME non-greedy regex (`<\/\1>`), which truncated div-
  //     wrapped rows at their FIRST inner cell (every Last.fm cell
  //     is a <div>, so the row body was lost past the title cell).
  //     Phase 2 only fires when phase 1 yields nothing — keeps the
  //     proven path fast and side-effect-free.
  const trRowRx = /<tr[^>]*class="[^"]*\bevents-list-item\b[^"]*"[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowBodies = [];
  let mm;
  while ((mm = trRowRx.exec(html)) !== null) rowBodies.push(mm[1]);

  // Phase 2: extract every `<div|li|article ... class="events-list-item">`
  // block with proper same-tag nesting tracking. Required because
  // Last.fm's modern markup wraps every cell (title, lineup, venue,
  // city, country) in its own <div>, so the row body has 5-7 nested
  // divs and a simple non-greedy match stops at the first cell.
  if (rowBodies.length === 0) {
    const tags = ['div', 'li', 'article'];
    for (const tag of tags) {
      const openRx = new RegExp(
        '<' + tag + '\\b[^>]*class="[^"]*\\bevents-list-item\\b[^"]*"[^>]*>',
        'gi'
      );
      const openPrefix  = '<' + tag;
      const closePrefix = '</' + tag;
      const lower = html.toLowerCase();
      let om;
      while ((om = openRx.exec(html)) !== null) {
        const bodyStart = om.index + om[0].length;
        let depth = 1;
        let i = bodyStart;
        while (i < html.length && depth > 0) {
          const nextOpen  = lower.indexOf(openPrefix,  i);
          const nextClose = lower.indexOf(closePrefix, i);
          if (nextClose === -1) break;
          const validOpen = (nextOpen !== -1)
            && /[\s/>]/.test(html[nextOpen + openPrefix.length] || '');
          if (validOpen && nextOpen < nextClose) {
            depth++;
            i = nextOpen + openPrefix.length;
          } else {
            depth--;
            if (depth === 0) {
              rowBodies.push(html.slice(bodyStart, nextClose));
              i = nextClose + closePrefix.length;
              break;
            }
            i = nextClose + closePrefix.length;
          }
        }
      }
      if (rowBodies.length > 0) break;
    }
  }

  const events = [];
  for (const row of rowBodies) {

    if (/events-list-mobile-ad/.test(row)) continue;

    const dtMatch = row.match(/<time[^>]*datetime="([^"]+)"/i);
    const datetime = dtMatch ? dtMatch[1] : null;
    if (!datetime) continue;

    // Title + URL: try the user-page nested anchor first, fall back
    // to the artist-page direct-anchor-with-class pattern.
    let eventUrl = '';
    let title    = '';
    const userTitleBlock = extractClassBlock(row, 'events-list-item-event--title');
    if (userTitleBlock) {
      const a = userTitleBlock.match(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/i);
      if (a) { eventUrl = a[1]; title = stripHtml(a[2]); }
    }
    if (!title) {
      // Artist-page variant: <a class="...events-list-item-event-name...">
      const a = row.match(/<a[^>]*class="[^"]*events-list-item-event-name[^"]*"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/i);
      if (a) { eventUrl = a[1]; title = stripHtml(a[2]); }
    }

    // Lineup: anchor-first (one <a href="/music/Band">Band</a> per act)
    // is the most reliable on the user-events page. Comma-split is a
    // fallback only — Last.fm sometimes truncates the visible TEXT with
    // "and N more" while still rendering every band as an <a> in the
    // DOM (the surplus anchors are hidden with CSS).
    let lineup = [];
    const userLineupBlock = extractClassBlock(row, 'events-list-item-event--lineup');
    if (userLineupBlock) {
      // Anchor pass — capture every /music/{slug}>Name</a> in the cell.
      const anchorRx = /<a[^>]+href="\/music\/([^"+][^"]*)"[^>]*>([^<]+)<\/a>/gi;
      const fromAnchors = [];
      const seenA = new Set();
      let am;
      while ((am = anchorRx.exec(userLineupBlock)) !== null) {
        const name = stripHtml(am[2]);
        if (!name) continue;
        const k = name.toLowerCase();
        if (seenA.has(k)) continue;
        seenA.add(k);
        fromAnchors.push(name);
      }
      if (fromAnchors.length > 0) {
        lineup = fromAnchors;
      } else {
        const txt = stripHtml(userLineupBlock);
        if (txt) lineup = txt.split(/,\s*/).map(s => s.trim()).filter(Boolean);
      }
    }
    if (lineup.length === 0) {
      const actsBlock = extractClassBlock(row, 'events-list-item-acts');
      if (actsBlock) {
        // Pull each itemprop="name" span; falls back to plain comma-
        // split if the spans aren't there.
        const names = [...actsBlock.matchAll(/<span[^>]*itemprop="name"[^>]*>([\s\S]*?)<\/span>/gi)]
          .map(mm => stripHtml(mm[1])).filter(Boolean);
        if (names.length > 0) lineup = names;
        else {
          const txt = stripHtml(actsBlock);
          if (txt) lineup = txt.split(/,\s*/).map(s => s.trim()).filter(Boolean);
        }
      }
    }
    // Last-ditch: if the lineup is still suspiciously thin (1 band on a
    // row that has a venue + city + datetime), scan the WHOLE row for
    // band anchors. Brutal Assault 2018 in the user-events page is the
    // canonical case: the lineup cell rendered weird and we got 1 band
    // back; the row HTML still contained ~100 /music/{Band} anchors.
    // Filter out the obvious noise slugs (Last.fm pseudo-routes start
    // with `+`).
    if (lineup.length <= 1) {
      const rowAnchorRx = /<a[^>]+href="\/music\/([^"+][^"]*)"[^>]*>([^<]+)<\/a>/gi;
      const rowAnchors = [];
      const seenRow = new Set();
      let ra;
      while ((ra = rowAnchorRx.exec(row)) !== null) {
        const name = stripHtml(ra[2]);
        if (!name || name.length > 80) continue;
        // Reject UI labels that Last.fm renders inside /music/ links —
        // these are localised "Listen", "Play", "Buy tickets" actions.
        if (/^(listen|play|buy tickets|tickets|view|see all)$/i.test(name)) continue;
        const k = name.toLowerCase();
        if (seenRow.has(k)) continue;
        seenRow.add(k);
        rowAnchors.push(name);
      }
      if (rowAnchors.length > lineup.length) lineup = rowAnchors;
    }
    if (fallbackArtist) {
      const ix = lineup.findIndex(n => n.toLowerCase() === fallbackArtist.toLowerCase());
      if (ix > 0) { const [name] = lineup.splice(ix, 1); lineup.unshift(name); }
      else if (ix === -1) lineup.unshift(fallbackArtist);
    }

    // Venue + location: --title is common across both pages, but the
    // user page splits city/country into separate divs while the
    // artist page packs them as "City, Country" in --address.
    const venue   = stripHtml(extractClassBlock(row, 'events-list-item-venue--title'));
    let city      = stripHtml(extractClassBlock(row, 'events-list-item-venue--city'));
    let country   = stripHtml(extractClassBlock(row, 'events-list-item-venue--country'));
    if (!city && !country) {
      // Artist-page variant. Split on the LAST comma so "Bielsko-Biała, Poland"
      // doesn't lose the hyphen-half. If only one segment, treat as city.
      const addr = stripHtml(extractClassBlock(row, 'events-list-item-venue--address'));
      if (addr) {
        const idx = addr.lastIndexOf(',');
        if (idx >= 0) { city = addr.slice(0, idx).trim(); country = addr.slice(idx + 1).trim(); }
        else city = addr;
      }
    }
    const countryIso = toIso2(country);

    const attendBlock = extractClassBlock(row, 'events-list-item-attendees-count');
    const attendText  = stripHtml(attendBlock);

    // Stable id — prefer numeric event/festival id from URL, fall back
    // to a content hash.
    const idFromUrl = eventUrl ? eventUrl.match(/\/(event|festival)\/(\d+)/)?.[2] : null;
    const id = idFromUrl ? 'lfm-event:' + idFromUrl
      : ('lfm:' + (fallbackArtist || '') + ':' + datetime + ':' + venue);

    events.push({
      id,
      datetime,
      venue:   venue || 'Unknown venue',
      city,
      region:  '',
      country: countryIso,
      lat:     null,
      lng:     null,
      lineup,
      ticketsUrl: eventUrl ? (eventUrl.startsWith('http') ? eventUrl : 'https://www.last.fm' + eventUrl) : null,
      onSale:  false,
      source:  'lastfm',
      attendees: attendText || null,
      title:   title || null,
    });
  }
  return events;
}

// Public: fetch + parse a single artist's events from /music/{artist}/+events.
// Tries the NEW HTML parser first (2026 Last.fm). Falls back to the
// legacy JSON-LD path on the off chance it returns. Both paths are
// silent-fail to keep callers from babysitting errors.
export async function lastfmArtistEvents(artistName, { timeoutMs = 5000 } = {}) {
  const name = String(artistName || '').trim();
  if (!name) return [];
  const url = 'https://www.last.fm/music/' + encodeURIComponent(name) + '/+events';
  let res;
  try {
    res = await fetch(url, {
      headers: { 'User-Agent': LFM_UA, 'Accept': 'text/html' },
      signal:  AbortSignal.timeout(timeoutMs),
    });
  } catch { return []; }
  if (!res.ok) return [];           // 404 = no events page, 5xx = transient
  const html = await res.text().catch(() => '');
  if (!html) return [];

  // Primary path (2026+): HTML row parser.
  const htmlEvents = parseLastfmHtmlEvents(html, name);
  if (htmlEvents.length > 0) return htmlEvents;

  // Legacy fallback — JSON-LD blocks (pre-2026 / future re-introduction).
  const blocks = extractJsonLdBlocks(html);
  const raw    = collectMusicEvents(blocks);
  return raw.map(e => mapLastfmEvent(e, name)).filter(Boolean);
}

// ── Event/festival detail → full lineup (paginated) ────────────
//
// Last.fm's UX for big festivals splits the lineup across MULTIPLE
// surfaces:
//
//   • /event/{id}+Name         → only ~8 acts (the "featured" few)
//   • /festival/{id}+Name      → same — first page of the band grid
//   • /festival/{id}+Name/lineup?page=N
//       → THIS is the canonical full-lineup page; ~15-17 acts per
//         page, paginated to ~7 pages for 100+ band festivals like
//         Brutal Assault. Stable schema.org/name markup throughout.
//
// Strategy:
//   1. If URL looks like /festival/...   → walk /lineup?page=1..N
//      until a page returns no NEW band names (last page detection).
//   2. If URL looks like /event/...      → fetch the page once; the
//      ~8-act default is typically all there is for single-club gigs.
//      Fall back to the festival /lineup walk if the event page
//      somehow links to one.
//
// Returns deduplicated names (case-insensitive). Capped at 200 acts
// to prevent runaway loops on a future Last.fm change.

// Minimal-budget retry fetch. Last.fm rate-limits aggressively but
// 429 typically requires a *long* wait (seconds), so retrying inside
// the same request doesn't actually help — it just burns budget. We
// only retry on 503 / 504 / network / timeout (transient hiccups
// that often resolve within a few hundred ms), with a SINGLE quick
// retry. 429 is NOT retried — returned to the caller immediately
// so the walker can bail and let the next user-triggered import
// re-scrape after the rate-limit window resets.
//
// The first attempt of this helper had retries=2 with 800ms × attempt
// backoff, which added 2.4s per rate-limited page. On a deep archive
// walk that pushed the importer past Vercel's 240s maxDuration → 504
// → ZERO inserts. This version caps the worst-case overhead at
// ~300ms per failed page.
async function fetchLfm(url, { timeoutMs = 6000, retries = 1 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': LFM_UA, 'Accept': 'text/html' },
        signal:  AbortSignal.timeout(timeoutMs),
      });
      // Only the transient-server states get a retry. 429 is rate-limit
      // — caller's downstream logic dedups against existing rows so a
      // partial import on this request is fine; the next import picks up.
      if ((res.status === 503 || res.status === 504) && attempt < retries) {
        await new Promise(r => setTimeout(r, 300));
        continue;
      }
      return res;
    } catch (e) {
      lastErr = e;
      // Timeout or network — single quick retry.
      if (attempt < retries) {
        await new Promise(r => setTimeout(r, 300));
        continue;
      }
    }
  }
  if (lastErr) throw lastErr;
  throw new Error('fetchLfm: exhausted retries with no response');
}

function extractBandNames(html) {
  if (!html) return [];
  const names = [];
  const seen  = new Set();
  // Primary: <a href="/music/{name}"> inside the band-grid items.
  // Far more reliable than parsing across newlines for itemprop blocks
  // — Last.fm renders this anchor for EVERY band card on the lineup
  // page regardless of layout dialect.
  const rx = /<a[^>]+href="\/music\/([^"]+)"[^>]*>([^<]+)<\/a>/gi;
  let m;
  while ((m = rx.exec(html)) !== null) {
    // Drop non-band hrefs ("+free-music-downloads", "+noredirect",
    // promotional links from sidebar / footer). Real band slugs use
    // ASCII letters/digits/+/%/_/- only.
    const slug = m[1];
    if (slug.startsWith('+'))                continue;   // pseudo route
    if (slug.length > 80)                    continue;   // way too long
    const name = m[2].replace(/&amp;/g, '&').replace(/&#39;/g, "'").trim();
    if (!name || name.length > 80)           continue;
    const key = name.toLowerCase();
    if (seen.has(key))                       continue;
    seen.add(key);
    names.push(name);
  }
  return names;
}

export async function lastfmEventFullLineup(eventUrl, { timeoutMs = 5000, maxPages = 12 } = {}) {
  if (!eventUrl) return [];
  // Normalise to absolute URL. CRITICAL: spaces → "+" (Last.fm's
  // canonical encoding for URLs). If we let Node fetch encode them
  // as %20, Last.fm 200s page 1 (via redirect) but pagination breaks
  // on subsequent pages — old bug that capped lineups at ~15 acts.
  const baseAbs0 = eventUrl.startsWith('http')
    ? eventUrl
    : 'https://www.last.fm' + (eventUrl.startsWith('/') ? eventUrl : '/' + eventUrl);
  const baseAbs = baseAbs0.replace(/\s+/g, '+');

  // Strip any existing query/fragment + the optional /lineup suffix
  // so we can predictably build /lineup?page=N URLs.
  const cleanedBase = baseAbs.replace(/\/lineup(?:\/.*)?(?:\?.*)?$/, '').replace(/[?#].*$/, '');
  const isFestival  = /\/festival\//i.test(cleanedBase);

  // Per-page diagnostic trace — attached as non-enumerable __debug
  // so the debug endpoint can surface it without changing the public
  // contract (callers still iterate the array of names normally).
  const trace = [];

  // Path 1: festival — walk paginated /lineup?page=N.
  //
  // Stop conditions (priority order):
  //   1. fetch error / HTTP non-2xx  → page doesn't exist or rate-limit
  //   2. 0 fresh bands on this page  → either dup-only or end of lineup
  //   3. hit maxPages or 200-acts hard cap
  //
  // We intentionally do NOT bail on "small page" anymore. Last.fm's
  // /lineup pagination is irregular — a 9-band page can be followed
  // by a 12-band page (festival's "Confirmed" tier vs "Other acts"
  // groups render with different counts). The old `fresh.length<10`
  // heuristic was responsible for the "Brutal Assault stuck at 9
  // bands" bug.
  if (isFestival) {
    const out = [];
    const seen = new Set();
    for (let p = 1; p <= maxPages; p++) {
      const u = cleanedBase + '/lineup' + (p > 1 ? '?page=' + p : '');
      let res;
      let fetchErr = '';
      try {
        // fetchLfm transparently retries 429 / 503 / 504 / timeout with
        // exponential-ish backoff (800ms × attempt). When Last.fm rate-
        // limits mid-walk we now sleep and retry instead of bailing,
        // which fixes the "different bands each import" symptom: the
        // first run used to break after page 1-2 of a multi-page
        // festival, the next run picked up where rate-limits had reset.
        res = await fetchLfm(u, { timeoutMs, retries: 1 });
      } catch (e) {
        fetchErr = (e && e.name) === 'TimeoutError' ? 'timeout' : (e?.message || 'fetch_err').slice(0, 40);
        trace.push({ page: p, url: u, status: 'fetch_err', err: fetchErr });
        break;
      }
      if (!res.ok) {
        trace.push({ page: p, url: u, status: 'http_' + res.status });
        break;
      }
      const html = await res.text().catch(() => '');
      const pageNames = extractBandNames(html);
      const fresh = pageNames.filter(n => !seen.has(n.toLowerCase()));
      trace.push({
        page: p,
        url: u,
        status: 'ok',
        bytes: html.length,
        raw: pageNames.length,
        fresh: fresh.length,
      });
      if (fresh.length === 0) break;
      for (const n of fresh) { seen.add(n.toLowerCase()); out.push(n); }
      if (out.length >= 200) break;
      await new Promise(r => setTimeout(r, 250));
    }
    Object.defineProperty(out, '__debug', { value: { trace, cleanedBase }, enumerable: false });
    return out;
  }

  // Path 2: single event — usually just a few acts on one page.
  let res;
  try {
    res = await fetchLfm(cleanedBase, { timeoutMs, retries: 1 });
  } catch { return []; }
  if (!res.ok) return [];
  const html = await res.text().catch(() => '');
  return extractBandNames(html);
}

// ── User historical events ─────────────────────────────────────
//
// /user/{name}/events shows the gigs the Last.fm user marked as
// "attended" or "going to". For someone scrobbling since 2008 this
// can be a deep archive — exactly the past-concert journal data we
// want to backfill user_concerts with.
//
// Same JSON-LD structure as artist event pages (schema.org/Event),
// but the entries are the USER's attendance log, so multiple
// performers per row are common. We parse them all and let the
// caller decide whether to insert one user_concerts row per
// performer or one row per event.
//
// Pagination: ?page=2&past=1 returns older pages. We walk up to
// `maxPages` (default 30 = ~300-600 events for typical heavy users).
// Empty page = stop.

// Pull one user-events page. `yearOrPath` is either a year number
// (string) for the per-year archive (/events/2016) or the special
// 'upcoming' marker which fetches the default events page (which
// renders the "Upcoming" tab + a list of year-tabs).
//
// Last.fm's historical archive lives at /user/{name}/events/{YYYY}
// — discovered after the user pointed out their pre-2018 events
// page DOES still exist as year tabs. The ?past=1 query param was
// a dead-end from an older UI iteration.
async function fetchLastfmUserEventsPage(username, page, { yearOrPath, timeoutMs }) {
  const baseUrl = 'https://www.last.fm/user/' + encodeURIComponent(username) + '/events';
  const url = (yearOrPath === 'upcoming' || !yearOrPath)
    ? (baseUrl + (page > 1 ? '?page=' + page : ''))
    : (baseUrl + '/' + yearOrPath + (page > 1 ? '?page=' + page : ''));
  let res;
  try {
    // fetchLfm absorbs 429 / 503 / 504 / timeouts with backoff. When
    // Last.fm rate-limited a single year tab fetch, the old code
    // returned `end: true` and the per-year walker stopped immediately,
    // skipping the rest of that year's pages AND every year after it.
    // That was the #1 reason "every import gives different data".
    res = await fetchLfm(url, { timeoutMs, retries: 1 });
  } catch { return { events: [], end: true, status: 'fetch_err' }; }
  if (!res.ok) return { events: [], end: true, status: 'http_' + res.status };
  const html = await res.text().catch(() => '');
  if (!html) return { events: [], end: true, status: 'empty_html' };

  // Primary path: HTML row parser (matches 2026 Last.fm markup).
  // Hoisted blocks/raw counters declared up here so the debug return
  // object below can read them even when the JSON-LD fallback never
  // ran (HTML path filled events first). Earlier inline declarations
  // were scoped to the if-block and threw ReferenceError ("blocks is
  // not defined") on the success path.
  let events = parseLastfmHtmlEvents(html, '');
  let jsonLdBlockCount = 0;
  let jsonLdRawCount   = 0;
  if (events.length === 0) {
    // Legacy fallback — JSON-LD if Last.fm ever re-introduces it.
    const blocks = extractJsonLdBlocks(html);
    jsonLdBlockCount = blocks.length;
    const raw = collectMusicEvents(blocks);
    jsonLdRawCount = raw.length;
    events = raw.map(e => mapLastfmEvent(e, '')).filter(Boolean);
  }

  // Heuristic for "end of pagination": three independent signals,
  // any one positive means "more pages exist". This is much more
  // forgiving than the older "next link OR exact next-page=N+1 match"
  // — Last.fm has changed pagination markup at least 3 times over
  // the years; the broader probe survives more variants.
  const nextPageRx = new RegExp('[?&]page=' + (page + 1) + '[&"\']');
  const hasNextClass = /class="[^"]*pagination[_-]?next[^"]*"/i.test(html);
  const hasNextLink  = nextPageRx.test(html);
  const hasMoreText  = />\s*(Next|Następna|Older)\s*</i.test(html);
  const hasNext = hasNextClass || hasNextLink || hasMoreText;

  // When the parser yields zero events on a 200-OK page, capture a
  // diagnostic snippet so the caller (importer route) can surface it
  // in the response. Without this we can't tell if the page was empty
  // (no events that year), if Last.fm changed markup (parser miss), or
  // if we got an interstitial / consent page that doesn't contain any
  // events-list-item nodes at all.
  let htmlProbe = null;
  if (events.length === 0) {
    const len = html.length;
    htmlProbe = {
      bytes:        len,
      hasListItem:  /events-list-item/.test(html),
      hasTimeTag:   /<time[^>]+datetime="/i.test(html),
      hasJsonLd:    /application\/ld\+json/.test(html),
      hasConsentRx: /consent|gdpr|sign in|sign up|enable javascript/i.test(html),
      titleSnippet: (html.match(/<title>([^<]+)<\/title>/i) || [, ''])[1].slice(0, 120),
      // 400-char window starting at the first events-list-item match, if any.
      itemSnippet:  (() => {
        const m = html.match(/events-list-item[\s\S]{0,400}/);
        return m ? m[0].slice(0, 400) : null;
      })(),
    };
  }

  return {
    events,
    end: events.length === 0 && !hasNext,
    status: 'ok',
    debug: { page, parsedBlocks: jsonLdBlockCount, rawEvents: jsonLdRawCount, finalEvents: events.length, hasNext, htmlProbe },
  };
}

// Detect the year-tabs Last.fm shows at the top of the events page —
// gives us the set of years for which a user has at least one event.
// Returns ['upcoming', 2018, 2017, ..., 2010] for matiskura's profile.
// We trust whatever year integers Last.fm itself surfaces rather than
// brute-force scanning 1995..current.
async function detectYears(username, timeoutMs) {
  const url = 'https://www.last.fm/user/' + encodeURIComponent(username) + '/events';
  let res;
  try {
    // Retry-on-429 even for year detection: if THIS fetch rate-limits
    // we'd return [] → fallback to brute-scan-18-years path which
    // misses everything pre-2008 and produces 18 wasted requests.
    res = await fetchLfm(url, { timeoutMs, retries: 1 });
  } catch { return []; }
  if (!res.ok) return [];
  const html = await res.text().catch(() => '');
  const years = new Set();
  // Match `href="/user/X/events/YYYY"` — the year tab anchors at the
  // top of the page. Last.fm only renders tabs for years that have
  // at least one event, so this is exact.
  const rx = new RegExp('href="/user/' + username.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') +
    '/events/(\\d{4})"', 'g');
  let m;
  while ((m = rx.exec(html)) !== null) years.add(Number(m[1]));
  return [...years].sort((a, b) => b - a);   // newest first
}

// Public: walk EVERY archived year + the upcoming tab to pull the
// user's full attendance history. Last.fm exposes years as separate
// pages (/events/2016 etc); we detect which years they have content
// for via the top-of-page tab anchors, then scrape each archive.
//
// Returns events ARRAY with non-enumerable __debug summary so callers
// can surface per-year diagnostics.
export async function lastfmUserEventsAll(username, {
  past = true,                       // legacy param, kept for backward compat
  maxPages = 60,                     // per-year pagination cap
  maxYears = 60,                     // total archive depth cap
  timeoutMs = 8000,
  pacingMs = 250,
  yearDelayMs = 400,                 // between distinct year archives
} = {}) {
  const name = String(username || '').trim();
  if (!name) return [];
  const out = [];
  const trace = [];
  let lastStatus = 'ok';

  // Discover which years have data. Always include 'upcoming' as the
  // first sweep so a user with future-only events still gets them.
  let years = await detectYears(name, timeoutMs);
  if (years.length === 0) {
    // Fall back to a sensible default range — Last.fm started in 2002,
    // most attended-event marking happened 2008-2018. If the tab
    // detector returns nothing (markup change), brute-scan a few years.
    years = Array.from({ length: 18 }, (_, i) => new Date().getFullYear() - i);
  }
  const targets = ['upcoming', ...years].slice(0, maxYears + 1);

  for (const target of targets) {
    for (let page = 1; page <= maxPages; page++) {
      const r = await fetchLastfmUserEventsPage(name, page, { yearOrPath: target, timeoutMs });
      trace.push({ target, page, ...(r.debug || { status: r.status }) });
      lastStatus = r.status;
      out.push(...r.events);
      if (r.end) break;
      if (page < maxPages) await new Promise(rr => setTimeout(rr, pacingMs));
    }
    if (yearDelayMs > 0) await new Promise(rr => setTimeout(rr, yearDelayMs));
  }
  Object.defineProperty(out, '__debug', { value: { trace, lastStatus, targets }, enumerable: false });
  return out;
}
