export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Last 90 days
  const since = new Date();
  since.setDate(since.getDate() - 90);

  const { data, error } = await supabase
    .from('portfolio_snapshots').select('*')
    .eq('user_id', user.id)
    .gte('snapshot_date', since.toISOString().split('T')[0])
    .order('snapshot_date', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Also get collection summary
  const { data: collection } = await supabase
    .from('collection').select('purchase_price, current_price, artist, album')
    .eq('user_id', user.id);

  const totalPurchased = (collection || []).reduce((s, i) => s + (Number(i.purchase_price) || 0), 0);
  const totalCurrent   = (collection || []).reduce((s, i) => s + (Number(i.current_price || i.purchase_price) || 0), 0);

  return NextResponse.json({
    snapshots: data || [],
    summary: {
      itemCount:      (collection || []).length,
      totalPurchased,
      totalCurrent,
      gain:           totalCurrent - totalPurchased,
      gainPct:        totalPurchased > 0 ? ((totalCurrent - totalPurchased) / totalPurchased * 100).toFixed(1) : 0,
    },
  });
}
