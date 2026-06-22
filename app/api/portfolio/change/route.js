// ── /api/portfolio/change — value delta over time ────────────
// Aggregates collection portfolio value at multiple time horizons.
// For each horizon (30d, 90d), we sum:
//   • Items with discogs_id → median_price from price_history at the horizon date
//   • Items without → fallback to current median_price (no historical data)
// Returns: { current, change30d, change90d, percentChange30d, percentChange90d }
//
// "current" is computed live from collection.median_price (synced daily by cron).
// For horizon values, we look up price_history at the closest snapshot ≤ horizon date.
//
// Pro feature — uses price_history table which is Pro-gated by feature, but
// here we just compute it for any user with collection. Free user might not
// see this in UI (we'll gate at render-time).

export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { createClient, supabaseAdmin } from '@/lib/supabase-server';
import { marketValueOf, sumMarketValue } from '@/lib/portfolio-value';

export async function GET() {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // 1) Get user's collection — include num_for_sale + is_gift + is_sold
  //    so the confidence guard in lib/portfolio-value can fire.
  const { data: collectionRaw } = await sb
    .from('collection')
    .select('id, discogs_id, median_price, current_price, purchase_price, num_for_sale, is_gift, is_sold, added_at')
    .eq('user_id', user.id);

  // Drop sold rows — they don't belong in held-portfolio value over
  // time (the cost basis stays for realized PnL elsewhere).
  const collection = (collectionRaw || []).filter(i => !i.is_sold);

  if (collection.length === 0) {
    return NextResponse.json({
      current: 0, change30d: 0, change90d: 0,
      percentChange30d: 0, percentChange90d: 0,
      itemCount: 0, itemsWithHistory: 0,
    });
  }

  // 2) Current value — use the same marketValueOf logic the live
  //    summary uses (single source of truth in lib/portfolio-value).
  //    Items with <3 listings fall back to purchase_price; gifts
  //    have no cost basis.
  const currentValue = sumMarketValue(collection);

  // Total paid — used as a fallback baseline when there's no
  // historical price_history yet (cron just started running, or this
  // is a fresh user). Gifts excluded — user didn't pay for them.
  const totalPaid = collection.reduce((sum, item) =>
    sum + (item.is_gift ? 0 : (Number(item.purchase_price) || 0)), 0);

  // 3) Historical lookup — admin client because price_history has RLS rules
  const adminSb = supabaseAdmin;
  const discogsIds = collection.map(c => c.discogs_id).filter(Boolean);

  // Compute target dates
  const today = new Date();
  const date30 = new Date(today); date30.setDate(date30.getDate() - 30);
  const date90 = new Date(today); date90.setDate(date90.getDate() - 90);
  const date30Str = date30.toISOString().split('T')[0];
  const date90Str = date90.toISOString().split('T')[0];

  // Lookup historical prices for both horizons in one query (window = oldest needed)
  const { data: history } = discogsIds.length > 0
    ? await adminSb
        .from('price_history')
        .select('discogs_id, snapshot_date, median_price')
        .in('discogs_id', discogsIds)
        .gte('snapshot_date', date90Str)
        .order('snapshot_date', { ascending: true })
    : { data: [] };

  // Build maps: for each discogs_id → closest snapshot ≤ targetDate
  // We pick the LATEST snapshot ≤ targetDate (closest before/at horizon).
  const priceAtDate = (targetDateStr) => {
    const map = {};
    for (const row of (history || [])) {
      if (!row.median_price || row.snapshot_date > targetDateStr) continue;
      const id = String(row.discogs_id);
      if (!map[id] || row.snapshot_date > map[id].date) {
        map[id] = { price: Number(row.median_price), date: row.snapshot_date };
      }
    }
    return map;
  };

  const map30 = priceAtDate(date30Str);
  const map90 = priceAtDate(date90Str);

  // Compute aggregate value at each horizon
  // Items without history at horizon → fall back to current median_price (assume value was the same)
  // This avoids penalizing items just added.
  let value30 = 0, value90 = 0, withHistory30 = 0, withHistory90 = 0;
  for (const item of collection) {
    const idStr = String(item.discogs_id);
    // Today's per-item value uses the trusted formula. The
    // historical lookup (price_history table) is a raw median
    // from the daily cron and predates the confidence guard,
    // so for missing-history items we fall back to today's
    // trusted number rather than today's raw median.
    const currentItemValue = marketValueOf(item);

    const at30 = map30[idStr]?.price;
    const at90 = map90[idStr]?.price;

    value30 += at30 != null ? at30 : currentItemValue;
    value90 += at90 != null ? at90 : currentItemValue;

    if (at30 != null) withHistory30++;
    if (at90 != null) withHistory90++;
  }

  const change30d = currentValue - value30;
  const change90d = currentValue - value90;

  const itemsWithHistory = Math.max(withHistory30, withHistory90);

  // Purchase-price fallback for fresh users with no price_history yet.
  // We surface BOTH the (zero-or-near-zero) time-based delta AND a
  // purchase-baseline delta so the UI can pick whichever is more
  // informative. Once the daily cron has run for a few days the real
  // 30d numbers will dominate.
  const changeVsPaid = totalPaid > 0 ? currentValue - totalPaid : null;
  const percentVsPaid = (totalPaid > 0)
    ? Math.round((changeVsPaid / totalPaid) * 1000) / 10
    : null;

  return NextResponse.json({
    current:           Math.round(currentValue * 100) / 100,
    value30dAgo:       Math.round(value30 * 100) / 100,
    value90dAgo:       Math.round(value90 * 100) / 100,
    change30d:         Math.round(change30d * 100) / 100,
    change90d:         Math.round(change90d * 100) / 100,
    percentChange30d:  value30 > 0 ? Math.round((change30d / value30) * 1000) / 10 : 0,
    percentChange90d:  value90 > 0 ? Math.round((change90d / value90) * 1000) / 10 : 0,
    itemCount:         collection.length,
    itemsWithHistory,
    coverage:          collection.length > 0
      ? Math.round((itemsWithHistory / collection.length) * 100)
      : 0,
    // Fallback: lifetime gain vs purchase price. Always populated when
    // the user has set purchase_price on at least one item.
    totalPaid:         Math.round(totalPaid * 100) / 100,
    changeVsPaid:      changeVsPaid != null ? Math.round(changeVsPaid * 100) / 100 : null,
    percentVsPaid,
  });
}
