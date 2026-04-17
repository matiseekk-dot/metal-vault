export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';

export async function GET(request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const format = new URL(request.url).searchParams.get('format') || 'csv';

  const { data, error } = await supabase
    .from('collection').select('*')
    .eq('user_id', user.id)
    .order('added_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (format === 'json') {
    return new NextResponse(JSON.stringify(data, null, 2), {
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': 'attachment; filename="metal-vault-collection.json"',
      },
    });
  }

  // CSV
  const headers = [
    'Artist', 'Album', 'Format', 'Grade', 'Label', 'Year',
    'Purchase Price ($)', 'Current Price ($)', 'Median Price ($)',
    'Gain ($)', 'Discogs ID', 'Added Date', 'Notes',
  ];

  const rows = (data || []).map(item => {
    const purchased = Number(item.purchase_price) || 0;
    const current   = Number(item.median_price || item.current_price) || 0;
    const gain      = current > 0 && purchased > 0 ? (current - purchased).toFixed(2) : '';
    return [
      item.artist             || '',
      item.album              || '',
      item.format             || '',
      item.grade              || 'NM',
      item.label              || '',
      item.year               || '',
      purchased > 0 ? purchased.toFixed(2) : '',
      Number(item.current_price || 0).toFixed(2) || '',
      Number(item.median_price  || 0).toFixed(2) || '',
      gain,
      item.discogs_id         || '',
      item.added_at ? item.added_at.split('T')[0] : '',
      item.notes              || '',
    ].map(v => '"' + String(v).replace(/"/g, '""') + '"').join(',');
  });

  const csv = [headers.join(','), ...rows].join('\n');

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="metal-vault-collection.csv"',
    },
  });
}
