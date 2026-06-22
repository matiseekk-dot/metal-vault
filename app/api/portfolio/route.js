import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { sumMarketValue, isLowConfidence } from '@/lib/portfolio-value';


export const dynamic = 'force-dynamic';

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Last 90 days
  const since = new Date();
  since.setDate(since.getDate() - 90);

  // Snapshots only need date + value columns for the chart; the table
  // also has total_paid + item_count (used by summary, not the chart).
  const { data, error } = await supabase
    .from('portfolio_snapshots')
    .select('snapshot_date, total_value, total_paid, item_count')
    .eq('user_id', user.id)
    .gte('snapshot_date', since.toISOString().split('T')[0])
    .order('snapshot_date', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Live summary — same confidence rules as /api/collection summary.
  // We need num_for_sale + is_gift + is_sold to apply the marketValueOf
  // helper that filters low-confidence single-listing prices and
  // excludes sold rows.
  const { data: collection } = await supabase
    .from('collection')
    .select('purchase_price, current_price, median_price, num_for_sale, is_gift, is_sold, artist, album')
    .eq('user_id', user.id);
  const held = (collection || []).filter(i => !i.is_sold);
  const totalPurchased = held.reduce((s, i) =>
    s + (i.is_gift ? 0 : (Number(i.purchase_price) || 0)), 0);
  const totalCurrent       = sumMarketValue(held);
  const lowConfidenceCount = held.filter(isLowConfidence).length;

  return NextResponse.json({
    snapshots: data || [],
    summary: {
      itemCount:        held.length,
      totalPurchased,
      totalCurrent,
      lowConfidenceCount,
      gain:           totalCurrent - totalPurchased,
      gainPct:        totalPurchased > 0 ? ((totalCurrent - totalPurchased) / totalPurchased * 100).toFixed(1) : 0,
    },
  });
}
