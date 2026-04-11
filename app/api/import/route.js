export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';

const HEADERS = (key, secret, token) => ({
  Authorization: key && secret
    ? `Discogs key=${key}, secret=${secret}`
    : `Discogs token=${token}`,
  'User-Agent': 'MetalVault/1.0 +https://metal-vault.app',
});

async function fetchAllPages(baseUrl, headers) {
  const items = [];
  let page = 1;
  let totalPages = 1;

  while (page <= totalPages && page <= 20) { // max 20 pages = 1000 items
    const url = `${baseUrl}&page=${page}&per_page=50`;
    const r = await fetch(url, { headers });
    if (!r.ok) {
      if (r.status === 404) throw new Error('Discogs user not found or collection is private');
      throw new Error(`Discogs error ${r.status}`);
    }
    const data = await r.json();
    totalPages = data.pagination?.pages || 1;

    const releases = data.releases || data.wants || [];
    items.push(...releases);
    page++;

    // Small delay to respect rate limits
    if (page <= totalPages) await new Promise(r => setTimeout(r, 500));
  }

  return items;
}

function normaliseRelease(r, type) {
  const info = r.basic_information || r.basic_information || r;
  return {
    discogs_id:     info.id || r.id,
    artist:         info.artists?.[0]?.name || 'Unknown',
    album:          info.title || info.name || '',
    cover:          info.cover_image || info.thumb || null,
    format:         info.formats?.[0]?.name || 'Vinyl',
    label:          info.labels?.[0]?.name || null,
    year:           info.year || null,
    genres:         info.genres || [],
    styles:         info.styles || [],
    discogsUrl:     `https://www.discogs.com/release/${info.id || r.id}`,
    type,           // 'collection' or 'wantlist'
    // Collection-specific
    purchase_price: r.notes?.find?.(n => n.field_id === 1)?.value || null,
    rating:         r.rating || null,
    folder:         r.folder_id || null,
    date_added:     r.date_added || null,
  };
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const username = (searchParams.get('username') || '').trim().toLowerCase();
  const type     = searchParams.get('type') || 'both'; // 'collection' | 'wantlist' | 'both'

  if (!username) {
    return NextResponse.json({ error: 'Provide Discogs username' }, { status: 400 });
  }

  const key    = process.env.DISCOGS_KEY;
  const secret = process.env.DISCOGS_SECRET;
  const token  = process.env.DISCOGS_TOKEN;

  if (!key && !token) {
    return NextResponse.json({ error: 'Discogs not configured' }, { status: 503 });
  }

  const headers = HEADERS(key, secret, token);
  const results = { username, collection: [], wantlist: [], errors: [] };

  // Fetch collection
  if (type === 'collection' || type === 'both') {
    try {
      const raw = await fetchAllPages(
        `https://api.discogs.com/users/${username}/collection/folders/0/releases?sort=added&sort_order=desc`,
        headers
      );
      results.collection = raw.map(r => normaliseRelease(r, 'collection'));
    } catch (e) {
      results.errors.push({ source: 'collection', error: e.message });
    }
  }

  // Fetch wantlist
  if (type === 'wantlist' || type === 'both') {
    try {
      const raw = await fetchAllPages(
        `https://api.discogs.com/users/${username}/wants?sort=added&sort_order=desc`,
        headers
      );
      results.wantlist = raw.map(r => normaliseRelease(r, 'wantlist'));
    } catch (e) {
      results.errors.push({ source: 'wantlist', error: e.message });
    }
  }

  return NextResponse.json({
    username,
    collection_count: results.collection.length,
    wantlist_count:   results.wantlist.length,
    collection:       results.collection,
    wantlist:         results.wantlist,
    errors:           results.errors,
  });
}
