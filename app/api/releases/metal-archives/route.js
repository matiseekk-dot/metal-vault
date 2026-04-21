// ────────────────────────────────────────────────────────────────
// Metal Archives upcoming releases — fills the pre-order gap Discogs has.
// Data: https://www.metal-archives.com/release/ajax-upcoming/json/1
// Response: { aaData: [[band_html, album_html, type, genre, date, ""], ...] }
// No official API, so we hit the AJAX endpoint with a real browser UA.
// ────────────────────────────────────────────────────────────────

export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

function parseLink(html) {
  if (!html) return { name: '', url: '' };
  const m = html.match(/<a\s+href=['"]([^'"]+)['"][^>]*>([^<]+)<\/a>/);
  return m ? { name: m[2].trim(), url: m[1] } : { name: html.replace(/<[^>]+>/g, '').trim(), url: '' };
}

function parseDate(str) {
  if (!str) return null;
  const clean = String(str)
    .replace(/(\d+)(st|nd|rd|th)/g, '$1')
    .replace(/\s*-\s*\d+/, '')
    .trim();
  const d = new Date(clean);
  if (isNaN(d)) return null;
  return d.toISOString().split('T')[0];
}

const METAL_KEYWORDS = [
  'metal', 'grindcore', 'doom', 'sludge', 'crust', 'black', 'death', 'thrash',
  'heavy', 'power', 'speed', 'prog', 'stoner', 'core',
];
function isMetalGenre(genre) {
  const g = (genre || '').toLowerCase();
  return METAL_KEYWORDS.some(k => g.includes(k));
}

export async function GET() {
  try {
    const pages = [0, 100];
    const all = [];

    for (const start of pages) {
      const url = 'https://www.metal-archives.com/release/ajax-upcoming/json/1'
        + '?sEcho=1&iColumns=6&iDisplayStart=' + start + '&iDisplayLength=100'
        + '&iSortCol_0=4&sSortDir_0=asc&iSortingCols=1';

      const r = await fetch(url, {
        headers: {
          'User-Agent': UA,
          'Accept': 'application/json, text/javascript, */*; q=0.01',
          'X-Requested-With': 'XMLHttpRequest',
          'Referer': 'https://www.metal-archives.com/release/upcoming',
        },
        next: { revalidate: 60 * 60 * 12 },
      });

      if (!r.ok) {
        console.warn('[MA] fetch failed:', r.status);
        break;
      }
      const data = await r.json();
      if (!Array.isArray(data.aaData)) break;
      all.push(...data.aaData);
      if (data.aaData.length < 100) break;
    }

    const items = all.map(row => {
      const [bandHtml, albumHtml, type, genre, dateStr] = row;
      const band = parseLink(bandHtml);
      const album = parseLink(albumHtml);
      const releaseDate = parseDate(dateStr);
      const releaseId = album.url ? album.url.match(/albums\/[^/]+\/[^/]+\/(\d+)/)?.[1] : null;
      return {
        id:           releaseId ? 'ma_' + releaseId : null,
        source:       'metal_archives',
        artist:       band.name,
        artistUrl:    band.url,
        album:        album.name,
        albumUrl:     album.url,
        type:         type || 'Full-length',
        genre:        genre || '',
        releaseDate:  releaseDate,
        releaseDateRaw: dateStr,
        preorder:     releaseDate ? new Date(releaseDate) > new Date() : true,
        cover:        null,
        limited:      false,
      };
    }).filter(x => x.artist && x.album && isMetalGenre(x.genre));

    return NextResponse.json({ items, count: items.length });
  } catch (e) {
    console.error('[MA] error:', e);
    return NextResponse.json({ items: [], error: e.message }, { status: 500 });
  }
}
