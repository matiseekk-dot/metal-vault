// ────────────────────────────────────────────────────────────────
// Upcoming releases via MusicBrainz (open, no API key, allows cloud IPs).
// Replaces Metal Archives (Cloudflare-blocked Vercel).
// Endpoint: /release?query=primarytype:album AND tag:metal AND date:[NOW TO NOW+6MONTHS]
// Covers via Cover Art Archive (https://coverartarchive.org/release-group/<mbid>/front-250)
// Route is still /api/releases/metal-archives for backward compat.
// ────────────────────────────────────────────────────────────────

export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';

const UA = 'MetalVault/1.0 (https://metal-vault-six.vercel.app)'; // MB requires identifiable UA
const METAL_TAGS = [
  'metal', 'black-metal', 'death-metal', 'thrash-metal', 'doom-metal',
  'heavy-metal', 'power-metal', 'progressive-metal', 'grindcore', 'sludge',
  'stoner-metal', 'folk-metal', 'melodic-death-metal', 'technical-death-metal',
];

function toISO(d) { return d.toISOString().split('T')[0]; }

export async function GET() {
  try {
    // Window: today → +6 months. MB Lucene: date:[YYYY-MM-DD TO YYYY-MM-DD]
    const today = new Date();
    const future = new Date();
    future.setMonth(future.getMonth() + 6);
    const dateFilter = 'date:[' + toISO(today) + ' TO ' + toISO(future) + ']';

    // Query: metal tag + primary album/EP + upcoming window
    // Fetch max 100 at a time (MB limit)
    const query = '(' + METAL_TAGS.map(t => 'tag:' + t).join(' OR ') + ')'
      + ' AND ' + dateFilter
      + ' AND (primarytype:Album OR primarytype:EP)'
      + ' AND status:official';

    const url = 'https://musicbrainz.org/ws/2/release-group/'
      + '?query=' + encodeURIComponent(query)
      + '&limit=100&offset=0&fmt=json';

    const r = await fetch(url, {
      headers: { 'User-Agent': UA, 'Accept': 'application/json' },
      next: { revalidate: 60 * 60 * 6 }, // 6h cache
    });

    if (!r.ok) {
      return NextResponse.json({
        items: [], error: 'MusicBrainz ' + r.status, count: 0,
      });
    }

    const data = await r.json();
    const groups = data['release-groups'] || [];

    // Map to our format. Use first release-event date if available, else `first-release-date`.
    const items = groups.map(g => {
      const mbid = g.id;
      const artists = (g['artist-credit'] || []).map(a => a.name || a.artist?.name).filter(Boolean);
      const artistName = artists.join(', ') || 'Unknown';
      const releaseDate = g['first-release-date'] || null;
      const tagNames = (g.tags || []).map(t => t.name);
      const primaryTag = tagNames.find(t => METAL_TAGS.includes(t)) || tagNames[0] || 'metal';
      // Cover Art Archive — front-250 works for release-groups too
      const cover = 'https://coverartarchive.org/release-group/' + mbid + '/front-250';

      return {
        id:            'mb_' + mbid,
        source:        'musicbrainz',
        artist:        artistName,
        album:         g.title || '',
        cover,
        releaseDate,
        releaseDateRaw: releaseDate,
        genre:         primaryTag.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
        preorder:      releaseDate ? new Date(releaseDate) > today : true,
        limited:       false,
        type:          g['primary-type'] || 'Album',
        discogs_url:   'https://musicbrainz.org/release-group/' + mbid,
      };
    }).filter(x => x.artist && x.album && x.releaseDate);

    // Sort by release date ascending (soonest upcoming first)
    items.sort((a, b) => new Date(a.releaseDate) - new Date(b.releaseDate));

    return NextResponse.json({
      items,
      count: items.length,
      source: 'musicbrainz',
      debug: {
        totalFound: data.count,
        queryWindow: toISO(today) + ' → ' + toISO(future),
      },
    });
  } catch (e) {
    console.error('[MB] error:', e);
    return NextResponse.json({ items: [], error: e.message, count: 0 }, { status: 500 });
  }
}
