export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';

// SECURITY: fields user may write. user_id, created_at, added_at are server-owned.
// median_price, current_price are server-computed via Discogs fetch (NOT user input).
const COLLECTION_WRITABLE = [
  'discogs_id', 'artist', 'album', 'year', 'format', 'label', 'cover',
  'genres', 'styles', 'purchase_price', 'purchase_date', 'grade', 'grade_note',
  'notes', 'catalog_number',
  // Detailed grading (Pro feature, but field writes allowed for all to avoid data loss)
  'sleeve_grade', 'vinyl_grade', 'inner_sleeve_grade', 'hype_sticker', 'playback_notes',
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

  // Compute summary
  const totalPaid    = (data || []).reduce((s, i) => s + (Number(i.purchase_price) || 0), 0);
  const totalCurrent = (data || []).reduce((s, i) => s + (Number(i.median_price || i.current_price || i.purchase_price) || 0), 0);

  return NextResponse.json({
    items: data,
    summary: {
      itemCount:      (data || []).length,
      totalPaid,
      totalCurrent,
      gain:           totalCurrent - totalPaid,
      gainPct:        totalPaid > 0 ? ((totalCurrent - totalPaid) / totalPaid * 100).toFixed(1) : '0',
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
    last_price_check: new Date().toISOString(),
  }).eq('id', collectionItemId);
}
