// ── MusicBrainz client ────────────────────────────────────────
// MB requires:
//   • Mandatory User-Agent identifying the app + contact (or they ban you)
//   • 1 req/sec hard rate limit per IP
//
// Docs: https://musicbrainz.org/doc/MusicBrainz_API
//
// We use this for:
//   • Searching artists (incl. members → bands they played in)
//   • Getting artist relations (members, ex-members, similar)
//   • Resolving release-group MBIDs for Cover Art Archive lookups

const MB_BASE = 'https://musicbrainz.org/ws/2';
// User-Agent format mandated by MB: "App/Version ( contact )"
// Contact env var falls back to the Vercel-hosted public URL — same surface
// MB sees in webhook tests, so they can reach us.
function userAgent() {
  const contact = process.env.MUSICBRAINZ_CONTACT
    || process.env.NEXT_PUBLIC_APP_URL
    || 'https://metal-vault-six.vercel.app';
  return `MetalVault/1.0 ( ${contact} )`;
}

// ── Throttle: MB allows 1 req/sec strict. We serialize across the lifetime
// of this Node module (per Vercel function instance — reasonable since each
// instance handles its own user load). If two callers arrive simultaneously,
// the second waits for the first.
let mbQueue = Promise.resolve();
function throttledFetch(url) {
  const next = mbQueue.then(async () => {
    const res = await fetch(url, {
      headers: { 'User-Agent': userAgent(), 'Accept': 'application/json' },
    });
    // Sleep 1.05s after a successful call before releasing the next caller.
    // Slightly over 1s for safety margin against MB's clock skew.
    await new Promise(r => setTimeout(r, 1050));
    return res;
  });
  // Keep the chain alive even on errors so a single failure doesn't break
  // throttling for subsequent requests.
  mbQueue = next.catch(() => {});
  return next;
}

// ── Search artists by name ────────────────────────────────────
// Returns top N matches with MBID, score, country, type (Group/Person),
// and disambiguation text (helpful for distinguishing same-named artists).
export async function searchArtist(query, limit = 8) {
  if (!query?.trim()) return [];
  const q = encodeURIComponent(query.trim());
  const url = `${MB_BASE}/artist/?query=${q}&limit=${limit}&fmt=json`;
  try {
    const res = await throttledFetch(url);
    if (!res.ok) return [];
    const d = await res.json();
    return (d.artists || []).map(a => ({
      mbid:           a.id,
      name:           a.name,
      sortName:       a['sort-name'],
      type:           a.type,                       // 'Group', 'Person', 'Orchestra', etc.
      country:        a.country,
      gender:         a.gender,                     // for persons
      disambiguation: a.disambiguation,             // free-text qualifier
      score:          a.score,                      // 0-100, MB relevance
      tags:           (a.tags || []).map(t => t.name),
      lifeSpan:       a['life-span'],               // { begin, end, ended }
    }));
  } catch {
    return [];
  }
}

// ── Get full artist details + relations ───────────────────────
// Returns members (current/past), bands the artist played in, similar artists.
// Single API call with `inc=artist-rels+url-rels+release-group-rels` is heavy
// but saves us from N follow-up calls.
export async function getArtistRelations(mbid) {
  if (!mbid) return null;
  const url = `${MB_BASE}/artist/${mbid}?inc=artist-rels+url-rels&fmt=json`;
  try {
    const res = await throttledFetch(url);
    if (!res.ok) return null;
    const d = await res.json();
    const rels = d.relations || [];

    // Members are bidirectional in MB. If THIS artist is a Group, members are
    // people whose `direction: 'backward'` and type is "member of band". If
    // THIS artist is a Person, the same relation type with `direction: 'forward'`
    // points to bands they played in.
    const members = [];      // people who were/are in this band
    const bands   = [];      // bands this person played in
    const associated = [];   // collaborations, side projects, etc.

    for (const r of rels) {
      if (!r.artist) continue;
      const target = {
        mbid:    r.artist.id,
        name:    r.artist.name,
        type:    r.artist.type,
        roles:   (r.attributes || []),                  // e.g. ['lead vocals', 'guitar']
        begin:   r.begin,
        end:     r.end,
        ended:   r.ended,
        active:  !r.ended,
        relType: r.type,                                // 'member of band', 'collaboration', etc.
      };
      if (r.type === 'member of band') {
        if (r.direction === 'backward') members.push(target);
        else                            bands.push(target);
      } else if (r.type === 'collaboration' || r.type === 'subgroup' || r.type === 'supporting musician') {
        associated.push(target);
      }
    }

    // Stable sort: active members first, then by recency. Active = no end date
    // (or ended:false). Among inactive, more recent end date first.
    const sortByActivity = (a, b) => {
      if (a.active !== b.active) return a.active ? -1 : 1;
      const ae = a.end || '0000', be = b.end || '0000';
      return be.localeCompare(ae);
    };
    members.sort(sortByActivity);
    bands.sort(sortByActivity);

    // Pull URL relations — Wikipedia, official site, Bandcamp, etc.
    const urls = {};
    for (const r of rels) {
      if (r.url && r.type) urls[r.type] = r.url.resource;
    }

    return {
      mbid,
      name:           d.name,
      type:           d.type,
      country:        d.country,
      disambiguation: d.disambiguation,
      lifeSpan:       d['life-span'],
      tags:           (d.tags || []).map(t => t.name),
      members,
      bands,
      associated,
      urls,
    };
  } catch {
    return null;
  }
}

// ── Resolve release-group MBID for an artist + album title ────
// Used by Cover Art Archive — we need the release-group MBID, not the artist's.
export async function findReleaseGroupMbid(artist, album) {
  if (!artist || !album) return null;
  const q = encodeURIComponent(`artist:"${artist}" AND release:"${album}"`);
  const url = `${MB_BASE}/release-group/?query=${q}&limit=1&fmt=json`;
  try {
    const res = await throttledFetch(url);
    if (!res.ok) return null;
    const d = await res.json();
    return d['release-groups']?.[0]?.id || null;
  } catch {
    return null;
  }
}

// ── Get full discography for an artist (release-groups) ───────
// Used as a Discogs fallback. Returns Album + Live releases, filtering
// out compilations / soundtracks / demos / single-only items by MB's
// primary/secondary-type taxonomy.
//
// Caller passes either an MBID or an artist name; if name we resolve
// the top match first (one extra MB call).
export async function getArtistDiscography(mbidOrName, opts = {}) {
  if (!mbidOrName) return null;
  let mbid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(mbidOrName)
    ? mbidOrName
    : null;
  let resolvedName = null;

  if (!mbid) {
    const matches = await searchArtist(mbidOrName, 1);
    if (!matches[0]?.mbid) return null;
    mbid = matches[0].mbid;
    resolvedName = matches[0].name;
  }

  // MB paginates at 100. Most metal bands have <100 release-groups so
  // a single page covers them; we only fetch page 2+ when needed.
  const all = [];
  for (let offset = 0; offset < 200; offset += 100) {
    const url = `${MB_BASE}/release-group?artist=${mbid}&type=album|live&limit=100&offset=${offset}&fmt=json`;
    let res;
    try { res = await throttledFetch(url); } catch { return null; }
    if (!res.ok) return null;
    const d = await res.json();
    const groups = d['release-groups'] || [];
    all.push(...groups);
    if (groups.length < 100) break;   // last page
  }

  // Filter rules mirror the Discogs route:
  //   primary-type: Album / Live / EP (we exclude EP unless caller asks)
  //   secondary-types: drop Compilation, Soundtrack, Mixtape/Street,
  //                    Demo, Interview, Audio drama, Audiobook, DJ-mix.
  const SKIP = new Set([
    'Compilation', 'Soundtrack', 'Mixtape/Street', 'Demo',
    'Interview', 'Audio drama', 'Audiobook', 'DJ-mix', 'Spokenword',
  ]);
  const includeEP = !!opts.includeEP;

  const albums = all
    .filter(g => {
      const primary = g['primary-type'];
      if (primary !== 'Album' && primary !== 'Live'
          && !(includeEP && primary === 'EP')) return false;
      const secondary = g['secondary-types'] || [];
      if (secondary.some(s => SKIP.has(s))) return false;
      return true;
    })
    .map(g => {
      const date = g['first-release-date'] || '';
      return {
        id:         g.id,                                    // MBID = stable
        mbid:       g.id,
        title:      g.title,
        year:       date ? parseInt(date.slice(0, 4), 10) || '' : '',
        // Cover Art Archive URL (250px). UI lazy-loads — if CAA returns
        // 404 the <img onError> falls back to the letter placeholder.
        cover:      `https://coverartarchive.org/release-group/${g.id}/front-250`,
        format:     g['secondary-types']?.includes('Live') ? 'Live Album' : 'Album',
        // MB doesn't have a stable "Discogs URL" equivalent — link to MB
        discogsUrl: `https://musicbrainz.org/release-group/${g.id}`,
        primaryType:    g['primary-type'],
        secondaryTypes: g['secondary-types'] || [],
      };
    })
    .sort((a, b) => (a.year || 9999) - (b.year || 9999));

  return {
    mbid,
    name:    resolvedName,
    albums,
  };
}
