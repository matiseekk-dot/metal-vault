import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';


export const dynamic = 'force-dynamic';

// SECURITY: fields user may write. user_id, created_at, added_at are server-owned.
// median_price, current_price are server-computed via Discogs fetch (NOT user input).
const COLLECTION_WRITABLE = [
  'discogs_id', 'artist', 'album', 'year', 'format', 'label', 'cover',
  'genres', 'styles', 'purchase_price', 'purchase_date', 'grade', 'grade_note',
  'notes', 'catalog_number',
  // Detailed grading (Pro feature, but field writes allowed for all to avoid data loss)
  'sleeve_grade', 'vinyl_grade', 'inner_sleeve_grade', 'hype_sticker', 'playback_notes',
  // "Want to sell" (Pro feature — gating happens at the UI layer + a
  // server-side premium check below for activation). Storing the
  // fields without premium is fine; the *generation* of listings is
  // what's gated.
  'for_sale', 'asking_price', 'for_sale_note',
  // The vinyl × concert bridge — points at a user_concerts.client_id
  // the user bought this record AT. Migration 041.
  'bought_at_concert_id',
  // Pre-order flag — set TRUE when the user committed to buying but
  // the record hasn't shipped/arrived yet. Migration 043.
  'is_preordered',
  // Sold-record tracking (migration 044). Soft-delete pattern:
  // the row stays in the table but is_sold=true → hidden from
  // default Vault, surfaces under the "Sold" filter chip,
  // excluded from portfolio current-value calculations.
  // PnL = sold_price - purchase_price.
  'is_sold', 'sold_date', 'sold_price',
  // Gift flag (migration 046). When true, purchase_price counts
  // as 0 in totalPaid (user didn't spend) but the row stays in
  // collection and counts toward itemCount. gift_from is free
  // text — "Tata", "Łukasz", or any sentimental label.
  'is_gift', 'gift_from',
];

function filterWritable(body) {
  return Object.fromEntries(
    Object.entries(body || {}).filter(([k]) => COLLECTION_WRITABLE.includes(k))
  );
}

function validateCollectionItem(body) {
  if (body.purchase_price !== undefined && body.purchase_price !== null) {
    const p = Number(body.purchase_price);
    if (isNaN(p) || p < 0 || p > 1000000) return 'purchase_price out of range';
  }
  if (body.asking_price !== undefined && body.asking_price !== null) {
    const p = Number(body.asking_price);
    if (isNaN(p) || p < 0 || p > 1000000) return 'asking_price out of range';
  }
  if (body.for_sale_note && String(body.for_sale_note).length > 500) {
    return 'for_sale_note max 500 chars';
  }
  if (body.playback_notes && String(body.playback_notes).length > 2000) {
    return 'playback_notes max 2000 chars';
  }
  if (body.grade_note && String(body.grade_note).length > 500) {
    return 'grade_note max 500 chars';
  }
  if (body.notes && String(body.notes).length > 2000) {
    return 'notes max 2000 chars';
  }
  return null;
}

async function getUser(sb) {
  const { data: { user } } = await sb.auth.getUser();
  return user;
}

async function updateSnapshot(supabase, userId) {
  const { data: items } = await supabase
    .from('collection').select('purchase_price, current_price, median_price')
    .eq('user_id', userId);
  if (!items) return;
  const totalValue = items.reduce((s, i) => s + (Number(i.median_price || i.current_price || i.purchase_price) || 0), 0);
  const totalPaid  = items.reduce((s, i) => s + (Number(i.purchase_price) || 0), 0);
  await supabase.from('portfolio_snapshots').upsert(
    {
      user_id:       userId,
      snapshot_date: new Date().toISOString().split('T')[0],
      total_value:   totalValue,
      total_paid:    totalPaid,
      item_count:    items.length,
    },
    { onConflict: 'user_id,snapshot_date' }
  );
}

export async function GET() {
  const supabase = await createClient();
  const user = await getUser(supabase);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data, error } = await supabase
    .from('collection').select('*')
    .eq('user_id', user.id)
    .order('added_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Compute summary. Sold items DON'T count toward live portfolio
  // value — we no longer hold them — but they do count toward the
  // lifetime PnL line (sold price contributes alongside what we
  // received). Realized PnL = sum(sold_price - purchase_price)
  // over sold rows. Unrealized PnL = totalCurrent - totalPaid
  // restricted to held rows.
  const held = (data || []).filter(i => !i.is_sold);
  const sold = (data || []).filter(i =>  i.is_sold);
  // Gifts: user didn't pay for these, so they don't contribute to
  // lifetime spend. They DO still hold market value, so they count
  // in totalCurrent — owning a gifted record is real ownership.
  const totalPaid    = held.reduce((s, i) =>
    s + (i.is_gift ? 0 : (Number(i.purchase_price) || 0)), 0);
  // totalCurrent helper — picks the most trustworthy number for
  // each row. Discogs median_price gets reported even when only
  // ONE seller is listing the item — a €999 outlier on a rare
  // press would push the portfolio totals into fantasy territory.
  // Require >= 3 active listings before trusting the median;
  // otherwise fall back to purchase_price (user's real cost basis,
  // safer floor than a single-seller outlier).
  const marketValueOf = (i) => {
    const offers = Number(i.num_for_sale) || 0;
    const market = Number(i.median_price || i.current_price) || 0;
    if (market > 0 && offers >= 3) return market;
    if (i.is_gift) return 0;
    return Number(i.purchase_price) || 0;
  };
  const totalCurrent = held.reduce((s, i) => s + marketValueOf(i), 0);
  const giftCount   = held.filter(i => i.is_gift).length;
  // Low-confidence count — how many rows in the portfolio carry
  // a market price based on <3 listings. Surfaced in summary so
  // the UI can hint 'X records have unreliable valuations'.
  const lowConfidenceCount = held.filter(i => {
    const offers = Number(i.num_for_sale) || 0;
    const hasMarket = (Number(i.median_price || i.current_price) || 0) > 0;
    return hasMarket && offers < 3;
  }).length;
  const realizedPnl  = sold.reduce((s, i) =>
    s + ((Number(i.sold_price) || 0) - (Number(i.purchase_price) || 0)), 0);
  const soldRevenue  = sold.reduce((s, i) => s + (Number(i.sold_price) || 0), 0);

  return NextResponse.json({
    items: data,
    summary: {
      itemCount:      held.length,         // held only — what the user sees in Vault
      soldCount:      sold.length,
      totalPaid,                            // held only
      totalCurrent,                         // held only
      gain:           totalCurrent - totalPaid,
      gainPct:        totalPaid > 0 ? ((totalCurrent - totalPaid) / totalPaid * 100).toFixed(1) : '0',
      realizedPnl,                          // from sold rows
      soldRevenue,
      giftCount,                            // gifts within held
      lowConfidenceCount,                   // rows where market price is based on <3 listings
    },
  });
}

export async function POST(request) {
  const supabase = await createClient();
  const user = await getUser(supabase);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Free plan: unlimited records (paywall is on price alerts, not collection size)
  const body = await request.json();
  const safe = filterWritable(body);
  const vErr = validateCollectionItem(safe);
  if (vErr) return NextResponse.json({ error: vErr }, { status: 400 });

  const { data, error } = await supabase
    .from('collection')
    .insert({ ...safe, user_id: user.id })
    .select().single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Fetch price from Discogs in background (non-blocking)
  if (body.discogs_id) {
    fetchAndStorePrices(body.discogs_id, data.id, supabase).catch(() => {});
  }

  await updateSnapshot(supabase, user.id);
  return NextResponse.json({ item: data });
}

export async function PATCH(request) {
  const supabase = await createClient();
  const user = await getUser(supabase);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const id   = new URL(request.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });
  const body = await request.json();
  const safe = filterWritable(body);
  const vErr = validateCollectionItem(safe);
  if (vErr) return NextResponse.json({ error: vErr }, { status: 400 });
  if (Object.keys(safe).length === 0) return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });

  const { data, error } = await supabase
    .from('collection').update(safe)
    .eq('id', id).eq('user_id', user.id)
    .select().single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // If discogs_id changed (variant picker), kick off a price refresh
  // in the background — old median/lowest were for a different release
  // ID, so leaving them stale would defeat the whole point of picking
  // the right variant. Non-blocking; client gets the updated row on
  // the next /api/collection GET.
  if (body.discogs_id && data && String(data.discogs_id) === String(body.discogs_id)) {
    fetchAndStorePrices(body.discogs_id, data.id, supabase).catch(() => {});
  }

  await updateSnapshot(supabase, user.id);
  return NextResponse.json({ item: data });
}

export async function DELETE(request) {
  const supabase = await createClient();
  const user = await getUser(supabase);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const id = new URL(request.url).searchParams.get('id');
  const { error } = await supabase
    .from('collection').delete()
    .eq('id', id).eq('user_id', user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await updateSnapshot(supabase, user.id);
  return NextResponse.json({ success: true });
}

async function fetchAndStorePrices(discogsId, collectionItemId, supabase) {
  const key    = process.env.DISCOGS_KEY;
  const secret = process.env.DISCOGS_SECRET;
  const token  = process.env.DISCOGS_TOKEN;
  const auth   = key && secret
    ? 'Discogs key=' + key + ', secret=' + secret
    : 'Discogs token=' + token;

  const res = await fetch(
    'https://api.discogs.com/marketplace/stats/' + discogsId,
    { headers: { Authorization: auth, 'User-Agent': 'MetalVault/1.0' } }
  );
  if (!res.ok) return;
  const data = await res.json();

  await supabase.from('collection').update({
    current_price:    data.lowest_price?.value  || null,
    median_price:     data.median?.value        || null,
    num_for_sale:     data.num_for_sale          ?? null,
    last_price_check: new Date().toISOString(),
  }).eq('id', collectionItemId);
}
