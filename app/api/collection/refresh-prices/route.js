export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';

function discogsAuth() {
  const k = process.env.DISCOGS_KEY, s = process.env.DISCOGS_SECRET, t = process.env.DISCOGS_TOKEN;
  if (!k && !t) return null;
  return k && s ? `Discogs key=${k}, secret=${s}` : `Discogs token=${t}`;
}

// Rate limit: 1 call per 30s per user (prevent Discogs abuse)
const lastCall = new Map();

export async function POST(request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Rate limiting
  const now = Date.now();
  const last = lastCall.get(user.id) || 0;
  if (now - last < 30_000) {
    return NextResponse.json({ error: 'Please wait before refreshing again', retryAfter: 30 }, { status: 429 });
  }
  lastCall.set(user.id, now);

  const auth = discogsAuth();
  if (!auth) return NextResponse.json({ error: 'Discogs not configured' }, { status: 503 });

  const staleCutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data: items } = await supabase
    .from('collection')
    .select('id, discogs_id')
    .eq('user_id', user.id)
    .not('discogs_id', 'is', null)
    .or(`last_price_check.is.null,last_price_check.lt.${staleCutoff}`)
    .order('added_at', { ascending: false })
    .limit(250);

  if (!items?.length) {
    return NextResponse.json({ updated: 0, total: 0, message: 'All prices are up to date' });
  }

  let updated = 0, errors = 0;
  const BATCH = 8;

  for (let i = 0; i < items.length; i += BATCH) {
    const batch = items.slice(i, i + BATCH);
    await Promise.all(batch.map(async item => {
      try {
        const r = await fetch(
          `https://api.discogs.com/marketplace/stats/${item.discogs_id}`,
          { headers: { Authorization: auth, 'User-Agent': 'MetalVault/1.0' } }
        );
        if (!r.ok) { errors++; return; }
        const d = await r.json();
        const current = d.lowest_price?.value || null;
        const median  = d.median?.value        || null;
        await supabase.from('collection').update({
          current_price:    current,
          median_price:     median,
          last_price_check: new Date().toISOString(),
        }).eq('id', item.id);
        updated++;
      } catch { errors++; }
    }));
    if (i + BATCH < items.length) await new Promise(r => setTimeout(r, 500));
  }

  // Update portfolio snapshot
  const { data: all } = await supabase
    .from('collection').select('purchase_price, current_price, median_price').eq('user_id', user.id);
  if (all?.length) {
    const totalValue = all.reduce((s, i) => s + (Number(i.median_price || i.current_price || i.purchase_price) || 0), 0);
    const totalPaid  = all.reduce((s, i) => s + (Number(i.purchase_price) || 0), 0);
    await supabase.from('portfolio_snapshots').upsert({
      user_id: user.id,
      snapshot_date: new Date().toISOString().split('T')[0],
      total_value: totalValue, total_paid: totalPaid, item_count: all.length,
    }, { onConflict: 'user_id,snapshot_date' });
  }

  return NextResponse.json({ updated, errors, total: items.length,
    message: `Updated ${updated}/${items.length} prices` });
}
