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

// Pull a CSS-class block out of an HTML fragment. We use anchored
// regex with [\s\S]*? for the body so multi-line content is captured
// (last.fm pretty-prints with line breaks inside cells).
function extractClassBlock(html, cls) {
  const rx = new RegExp('class="[^"]*\\b' + cls + '\\b[^"]*"[^>]*>([\\s\\S]*?)</', 'i');
  const m  = html.match(rx);
  return m ? m[1] : '';
}

function parseLastfmHtmlEvents(html, fallbackArtist) {
  if (!html) return [];
  // Match the OUTER row by both its opening "events-list-item" class
  // and the closing </tr> that closes that row. The lookahead form
  // tolerates nested <tr class="events-list-mobile-ad"> children that
  // Last.fm sometimes injects between event rows.
  const rowRx = /<tr[^>]*class="[^"]*\bevents-list-item\b[^"]*"[^>]*>([\s\S]*?)<\/tr>/gi;
  const events = [];
  let m;
  while ((m = rowRx.exec(html)) !== null) {
    const row = m[1];

    // Skip the mobile-ad pseudo-rows
    if (/events-list-mobile-ad/.test(row)) continue;

    // datetime — <time datetime="ISO">
    const dtMatch = row.match(/<time[^>]*datetime="([^"]+)"/i);
    const datetime = dtMatch ? dtMatch[1] : null;
    if (!datetime) continue;   // no date = no useful row

    // title — <a> inside events-list-item-event--title
    const titleBlock = extractClassBlock(row, 'events-list-item-event--title');
    const titleAnchor = titleBlock.match(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/i);
    const eventUrl   = titleAnchor ? titleAnchor[1] : '';
    const title      = titleAnchor ? stripHtml(titleAnchor[2]) : '';

    // lineup — text inside events-list-item-event--lineup, comma-split
    const lineupBlock = extractClassBlock(row, 'events-list-item-event--lineup');
    const lineupText  = stripHtml(lineupBlock);
    const lineup = lineupText
      ? lineupText.split(/,\s*/).map(s => s.trim()).filter(Boolean)
      : [];
    // Ensure the artist we queried for is first if we have a name.
    if (fallbackArtist) {
      const ix = lineup.findIndex(n => n.toLowerCase() === fallbackArtist.toLowerCase());
      if (ix > 0) { const [name] = lineup.splice(ix, 1); lineup.unshift(name); }
      else if (ix === -1) lineup.unshift(fallbackArtist);
    }

    // Venue + location
    const venue    = stripHtml(extractClassBlock(row, 'events-list-item-venue--title'));
    const city     = stripHtml(extractClassBlock(row, 'events-list-item-venue--city'));
    const country  = toIso2(stripHtml(extractClassBlock(row, 'events-list-item-venue--country')));

    // Attendees count (e.g. "11 going") — surfaces as a hint when present.
    const attendBlock = extractClassBlock(row, 'events-list-item-attendees-count');
    const attendText  = stripHtml(attendBlock);

    // Stable synthetic id when there's no event URL fragment.
    const idFromUrl = eventUrl ? eventUrl.match(/\/event\/(\d+)/)?.[1] : null;
    const id = idFromUrl ? 'lfm-event:' + idFromUrl
      : ('lfm:' + (fallbackArtist || '') + ':' + datetime + ':' + venue);

    events.push({
      id,
      datetime,
      venue:   venue || 'Unknown venue',
      city,
      region:  '',
      country,
      lat:     null,
      lng:     null,
      lineup,
      ticketsUrl: eventUrl ? ('https://www.last.fm' + eventUrl) : null,
      onSale:  false,   // Last.fm doesn't surface sale state here
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

async function fetchLastfmUserEventsPage(username, page, { past, timeoutMs }) {
  const url = 'https://www.last.fm/user/' + encodeURIComponent(username) +
              '/events?page=' + page + (past ? '&past=1' : '');
  let res;
  try {
    res = await fetch(url, {
      headers: { 'User-Agent': LFM_UA, 'Accept': 'text/html' },
      signal:  AbortSignal.timeout(timeoutMs),
    });
  } catch { return { events: [], end: true, status: 'fetch_err' }; }
  if (!res.ok) return { events: [], end: true, status: 'http_' + res.status };
  const html = await res.text().catch(() => '');
  if (!html) return { events: [], end: true, status: 'empty_html' };

  // Primary path: HTML row parser (matches 2026 Last.fm markup).
  let events = parseLastfmHtmlEvents(html, '');
  // Legacy fallback — JSON-LD if Last.fm ever re-introduces it.
  if (events.length === 0) {
    const blocks = extractJsonLdBlocks(html);
    const raw    = collectMusicEvents(blocks);
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

  return {
    events,
    end: events.length === 0 && !hasNext,
    status: 'ok',
    debug: { page, parsedBlocks: blocks.length, rawEvents: raw.length, finalEvents: events.length, hasNext },
  };
}

// Public: paginate the user's events feed to exhaustion (subject to
// maxPages cap). Returns events ARRAY with non-enumerable __debug
// summary attached so callers can surface per-page diagnostics in
// toast / import response without changing the return type signature.
export async function lastfmUserEventsAll(username, { past = true, maxPages = 60, timeoutMs = 8000, pacingMs = 350 } = {}) {
  const name = String(username || '').trim();
  if (!name) return [];
  const out = [];
  const trace = [];
  let lastStatus = 'ok';
  let lastPageWithEvents = 0;
  for (let page = 1; page <= maxPages; page++) {
    const r = await fetchLastfmUserEventsPage(name, page, { past, timeoutMs });
    trace.push(r.debug || { page, status: r.status });
    lastStatus = r.status;
    out.push(...r.events);
    if (r.events.length > 0) lastPageWithEvents = page;
    if (r.end) break;
    // Pace politely so we don't get rate-limited mid-import.
    if (page < maxPages) await new Promise(rr => setTimeout(rr, pacingMs));
  }
  Object.defineProperty(out, '__debug', { value: { trace, lastStatus, lastPageWithEvents }, enumerable: false });
  return out;
}
