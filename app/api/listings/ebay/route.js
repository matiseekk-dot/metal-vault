// ── eBay listings comparison ──────────────────────────────────
// Display-only price comparison. Returns lowest 3 active listings for
// a given album. NEVER recommends transactions or compares to other
// markets — that's user's call. Compliance: eBay API License "Public
// Display" clause permitted, "price modeling/arbitrage" clauses avoided.
//
// Two modes:
//   GET ?artist=Gojira&album=Magma&format=Vinyl
//     → { listings: [{title, price, currency, condition, sellerRating, url, image}] }
//     Used by MarketComparison (single-album drill-down).
//
//   POST { items: [{artist, album}, ...] }
//     → { results: [{artist, album, lowestPrice, currency, itemUrl, image, ...}] }
//     Used by Listening tab to enrich many unowned-streamed albums at
//     once. One row per input, returns the cheapest qualifying listing
//     so the UI can render a compact "eBay od $X" pill. Cache key prefix
//     differs from GET so the heavier "top 5 listings" payload isn't
//     evicted by lighter "single best" entries.

import { NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabase-server';


export const dynamic = 'force-dynamic';

const EBAY_OAUTH = 'https://api.ebay.com/identity/v1/oauth2/token';
const EBAY_BROWSE = 'https://api.ebay.com/buy/browse/v1/item_summary/search';
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;  // 6h — match Discogs price cache

// Single in-memory token cache (eBay OAuth tokens last 2h)
let cachedToken = null;
let tokenExpires = 0;

async function getEbayToken() {
  if (cachedToken && Date.now() < tokenExpires - 60_000) return cachedToken;

  const id = process.env.EBAY_APP_ID;
  const secret = process.env.EBAY_CERT_ID;
  if (!id || !secret) throw new Error('EBAY_APP_ID / EBAY_CERT_ID not configured');

  const auth = Buffer.from(id + ':' + secret).toString('base64');
  const r = await fetch(EBAY_OAUTH, {
    method: 'POST',
    headers: {
      'Authorization': 'Basic ' + auth,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope',
  });
  if (!r.ok) throw new Error('eBay OAuth failed: ' + r.status);
  const d = await r.json();
  cachedToken  = d.access_token;
  tokenExpires = Date.now() + (d.expires_in * 1000);
  return cachedToken;
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const artist = (searchParams.get('artist') || '').trim();
  const album  = (searchParams.get('album')  || '').trim();
  const format = (searchParams.get('format') || 'Vinyl').trim();

  if (!artist || !album) {
    return NextResponse.json({ error: 'artist and album required' }, { status: 400 });
  }

  // Skip entirely if eBay not configured — return empty array, never error
  if (!process.env.EBAY_APP_ID || !process.env.EBAY_CERT_ID) {
    return NextResponse.json({ listings: [], skipped: 'not_configured' });
  }

  // Cache key — same as Discogs cache pattern
  const cacheKey = 'ebay-v2::' + (artist + '::' + album + '::' + format).toLowerCase().replace(/\s+/g, '_');
  const sb = getAdminClient();

  // 1) Try cache (6h TTL)
  try {
    const { data: cached } = await sb
      .from('discogs_cache')  // reuse existing cache table for now
      .select('data, created_at')
      .eq('cache_key', cacheKey)
      .single();
    if (cached?.data && cached.created_at) {
      const age = Date.now() - new Date(cached.created_at).getTime();
      if (age < CACHE_TTL_MS) {
        return NextResponse.json({ listings: cached.data.listings || [], cached: true });
      }
    }
  } catch {}

  // 2) Live lookup
  let listings = [];
  try {
    const token = await getEbayToken();
    // Build query: "artist album vinyl" — eBay full-text search
    const q = encodeURIComponent(artist + ' ' + album + ' vinyl');
    // Filter to Music > Records category (id 176985), audiobooks/CDs filtered out
    const filters = [
      'categoryIds:{176985}',  // Vinyl Records
      'conditions:{NEW|USED}',
      'priceCurrency:USD',
    ].join(',');
    const url = EBAY_BROWSE + '?q=' + q + '&filter=' + encodeURIComponent(filters)
      + '&sort=price&limit=10';
    const r = await fetch(url, {
      headers: {
        'Authorization': 'Bearer ' + token,
        'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
        'X-EBAY-C-ENDUSERCTX': 'affiliateCampaignId=' + (process.env.EBAY_EPN_CAMPAIGN_ID || ''),
      },
      // 5s timeout
      signal: AbortSignal.timeout(5000),
    });
    if (!r.ok) throw new Error('eBay search failed: ' + r.status);
    const d = await r.json();

    // Map to our schema. PREFER itemAffiliateWebUrl when available — that's
    // how eBay Partner Network attributes the click and pays commission.
    // Quality filter — eBay returns noise like digital downloads or chinese
    // bootlegs at <$5. Vinyl LP never realistically sells under $5 in reality,
    // so anything below is treated as outlier (digital/scam/wrong category).
    listings = (d.itemSummaries || []).map(item => ({
      title:           item.title,
      price:           Number(item.price?.value) || 0,
      currency:        item.price?.currency || 'USD',
      condition:       item.condition || 'Unknown',
      sellerRating:    item.seller?.feedbackPercentage ? Number(item.seller.feedbackPercentage) : null,
      sellerFeedback:  item.seller?.feedbackScore ? Number(item.seller.feedbackScore) : null,
      url:             item.itemAffiliateWebUrl || item.itemWebUrl,
      image:           item.image?.imageUrl || item.thumbnailImages?.[0]?.imageUrl || null,
      location:        item.itemLocation?.country || null,
    }))
      // Skip listings under $5 — vinyl LP never legitimately sells that cheap;
      // these are digital downloads, scams, or wrong category.
      .filter(l => l.price >= 5)
      .slice(0, 5);

    // 3) Cache result
    await sb.from('discogs_cache').upsert(
      { cache_key: cacheKey, data: { listings }, created_at: new Date().toISOString() },
      { onConflict: 'cache_key' }
    );
  } catch (e) {
    console.warn('eBay lookup error:', e.message);
    // Graceful degradation — return empty array, NEVER 500
    return NextResponse.json({ listings: [], error: e.message });
  }

  return NextResponse.json({ listings });
}

// ── Batch mode for Listening tab ──────────────────────────────
// Accepts up to 12 (artist, album) pairs and returns one summary row
// per pair — the single cheapest qualifying listing. Cached separately
// from the GET path because the response shape (one item, not five) is
// different and we don't want to keep evicting one cache with the other.
const BATCH_TTL_MS = 7 * 24 * 60 * 60 * 1000;   // 7d for "is the cheapest copy still ~$X"
const BATCH_PACING_MS = 200;
const BATCH_MAX = 12;

function normaliseAlbum(s) {
  return String(s || '').toLowerCase().trim()
    .replace(/\s*[\[(].*?(remaster|reissue|deluxe|edition|expanded|anniversary).*?[\])]\s*/gi, '')
    .replace(/\s*-\s*(remaster|reissue|deluxe).*$/gi, '')
    .replace(/\s+/g, ' ').trim();
}
function normaliseArtist(s) {
  return String(s || '').toLowerCase().trim()
    .replace(/\s*\(\d+\)\s*$/, '').replace(/\s+/g, ' ').trim();
}

async function ebayCheapestFor(artist, album, token) {
  const q = encodeURIComponent(artist + ' ' + album + ' vinyl');
  const filters = ['categoryIds:{176985}', 'conditions:{NEW|USED}', 'priceCurrency:USD'].join(',');
  const url = EBAY_BROWSE + '?q=' + q + '&filter=' + encodeURIComponent(filters)
    + '&sort=price&limit=10';
  let r;
  try {
    r = await fetch(url, {
      headers: {
        'Authorization':            'Bearer ' + token,
        'X-EBAY-C-MARKETPLACE-ID':  'EBAY_US',
        'X-EBAY-C-ENDUSERCTX':      'affiliateCampaignId=' + (process.env.EBAY_EPN_CAMPAIGN_ID || ''),
      },
      signal: AbortSignal.timeout(5000),
    });
  } catch { return null; }
  if (!r.ok) return null;
  let d;
  try { d = await r.json(); } catch { return null; }
  const items = (d.itemSummaries || [])
    .map(it => ({
      title:    it.title,
      price:    Number(it.price?.value) || 0,
      currency: it.price?.currency || 'USD',
      // PREFER affiliate URL — that's how eBay Partner Network attributes
      // the click and pays commission. Falls back to public itemWebUrl.
      itemUrl:  it.itemAffiliateWebUrl || it.itemWebUrl,
      image:    it.image?.imageUrl || it.thumbnailImages?.[0]?.imageUrl || null,
      condition: it.condition || null,
      country:   it.itemLocation?.country || null,
    }))
    // Same outlier filter as the GET path — vinyl LP doesn't sell <$5
    // legitimately; cheaper hits are digital downloads, scams, or
    // misclassified items.
    .filter(x => x.price >= 5)
    .sort((a, b) => a.price - b.price);
  if (items.length === 0) return null;
  const top = items[0];
  return {
    lowestPrice: top.price,
    currency:    top.currency,
    itemUrl:     top.itemUrl,
    image:       top.image,
    condition:   top.condition,
    country:     top.country,
    title:       top.title,
  };
}

export async function POST(request) {
  if (!process.env.EBAY_APP_ID || !process.env.EBAY_CERT_ID) {
    return NextResponse.json({ error: 'eBay not configured', results: [] }, { status: 503 });
  }

  let body;
  try { body = await request.json(); } catch { body = {}; }
  const inputs = Array.isArray(body.items) ? body.items.slice(0, BATCH_MAX) : [];
  if (inputs.length === 0) return NextResponse.json({ results: [] });

  const sb = getAdminClient();
  let token;
  try { token = await getEbayToken(); }
  catch (e) { return NextResponse.json({ error: e.message, results: [] }, { status: 502 }); }

  const out = [];
  let upstreamHits = 0;

  for (const inp of inputs) {
    const artist = String(inp.artist || '').trim();
    const album  = String(inp.album  || '').trim();
    if (!artist || !album) {
      out.push({ artist, album, error: 'invalid' });
      continue;
    }
    const cacheKey = 'ebay-batch::' + normaliseArtist(artist) + '::' + normaliseAlbum(album);

    // Cache check
    try {
      const { data: cached } = await sb.from('discogs_cache')
        .select('data, created_at')
        .eq('cache_key', cacheKey)
        .single();
      if (cached?.data && Date.now() - new Date(cached.created_at).getTime() < BATCH_TTL_MS) {
        out.push({ artist, album, ...cached.data, fromCache: true });
        continue;
      }
    } catch {}

    if (upstreamHits > 0) await new Promise(r => setTimeout(r, BATCH_PACING_MS));
    upstreamHits++;

    const cheapest = await ebayCheapestFor(artist, album, token);
    const payload = cheapest || { notFound: true };
    try {
      await sb.from('discogs_cache').upsert(
        { cache_key: cacheKey, data: payload, created_at: new Date().toISOString() },
        { onConflict: 'cache_key' }
      );
    } catch {}
    out.push({ artist, album, ...payload, fromCache: false });
  }

  return NextResponse.json({ results: out, upstreamHits });
}
