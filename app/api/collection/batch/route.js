export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';

export async function DELETE(request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { ids } = await request.json();
  if (!ids?.length) return NextResponse.json({ deleted: 0 });

  // Single query — delete all at once
  const { error, count } = await supabase
    .from('collection')
    .delete({ count: 'exact' })
    .in('id', ids)
    .eq('user_id', user.id); // safety: only own items

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Update portfolio snapshot
  const { data: remaining } = await supabase
    .from('collection').select('purchase_price, median_price, current_price')
    .eq('user_id', user.id);

  const totalValue = (remaining || []).reduce((s, i) => s + (Number(i.median_price || i.current_price || i.purchase_price) || 0), 0);
  const totalPaid  = (remaining || []).reduce((s, i) => s + (Number(i.purchase_price) || 0), 0);

  await supabase.from('portfolio_snapshots').upsert(
    {
      user_id:       user.id,
      snapshot_date: new Date().toISOString().split('T')[0],
      total_value:   totalValue,
      total_paid:    totalPaid,
      item_count:    (remaining || []).length,
    },
    { onConflict: 'user_id,snapshot_date' }
  );

  return NextResponse.json({ deleted: count });
}
