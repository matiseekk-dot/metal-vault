// ── eBay listings comparison ──────────────────────────────────
// Display-only price comparison. Returns lowest 3 active listings for
// a given album. NEVER recommends transactions or compares to other
// markets — that's user's call. Compliance: eBay API License "Public
// Display" clause permitted, "price modeling/arbitrage" clauses avoided.
//
// Query params: ?artist=Gojira&album=Magma&format=Vinyl
// Returns: { listings: [{title, price, currency, condition, sellerRating, url, image}] }

export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabase-server';

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
  const cacheKey = 'ebay::' + (artist + '::' + album + '::' + format).toLowerCase().replace(/\s+/g, '_');
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
    listings = (d.itemSummaries || []).slice(0, 5).map(item => ({
      title:        item.title,
      price:        Number(item.price?.value) || 0,
      currency:     item.price?.currency || 'USD',
      condition:    item.condition || 'Unknown',
      sellerRating: item.seller?.feedbackPercentage || null,
      url:          item.itemAffiliateWebUrl || item.itemWebUrl,
      image:        item.image?.imageUrl || item.thumbnailImages?.[0]?.imageUrl || null,
      location:     item.itemLocation?.country || null,
    })).filter(l => l.price > 0);

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
