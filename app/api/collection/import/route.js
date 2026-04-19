export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';

function parseCSVRow(row) {
  const result = [];
  let cur = '', inQuote = false;
  for (let i = 0; i < row.length; i++) {
    const ch = row[i];
    if (ch === '"') {
      if (inQuote && row[i + 1] === '"') { cur += '"'; i++; }
      else inQuote = !inQuote;
    } else if (ch === ',' && !inQuote) { result.push(cur.trim()); cur = ''; }
    else { cur += ch; }
  }
  result.push(cur.trim());
  return result;
}

function parseCSV(text) {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter(l => l.trim());
  if (lines.length < 2) return [];
  const headers = parseCSVRow(lines[0]).map(h =>
    h.toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '')
  );
  return lines.slice(1).map(line => {
    const vals = parseCSVRow(line);
    const obj = {};
    headers.forEach((h, i) => { obj[h] = vals[i] || ''; });
    return obj;
  });
}

function rowToItem(row) {
  const artist = (row.artist || '').trim();
  const album  = (row.album  || '').trim();
  if (!artist || !album) return null;

  // Support multiple column name variants
  const priceRaw = row.purchase_price || row.purchase_price_ ||
                   row.paid || row.price_paid || '';
  const yearRaw  = row.year || row.release_year || '';
  const idRaw    = row.discogs_id || row.discogs_release_id || '';

  return {
    artist,
    album,
    format:         row.format || 'Vinyl',
    grade:          row.grade  || 'NM',
    label:          row.label  || null,
    year:           yearRaw  ? parseInt(yearRaw)  || null : null,
    purchase_price: priceRaw ? parseFloat(priceRaw) || null : null,
    discogs_id:     idRaw    ? Number(idRaw)       || null : null,
    notes:          row.notes  || null,
  };
}

export async function POST(request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let csvText;
  try {
    const fd   = await request.formData();
    const file = fd.get('file');
    if (!file) return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
    csvText = await file.text();
  } catch { return NextResponse.json({ error: 'Invalid form data' }, { status: 400 }); }

  const rows = parseCSV(csvText);
  if (!rows.length) return NextResponse.json({ error: 'CSV is empty or unreadable' }, { status: 400 });

  const { data: existing } = await supabase
    .from('collection').select('discogs_id, artist, album').eq('user_id', user.id);

  const existingKeys     = new Set((existing || []).map(e => (e.artist + '::' + e.album).toLowerCase()));
  const existingDiscogs  = new Set((existing || []).map(e => String(e.discogs_id)).filter(Boolean));

  const toInsert = [], skipped = [], invalid = [];

  for (const row of rows) {
    const item = rowToItem(row);
    if (!item) { invalid.push(row); continue; }
    const key = (item.artist + '::' + item.album).toLowerCase();
    if (item.discogs_id && existingDiscogs.has(String(item.discogs_id))) {
      skipped.push(item.artist + ' — ' + item.album); continue;
    }
    if (existingKeys.has(key)) {
      skipped.push(item.artist + ' — ' + item.album); continue;
    }
    toInsert.push({ user_id: user.id, ...item, added_at: new Date().toISOString() });
    existingKeys.add(key);
  }

  if (!toInsert.length) {
    return NextResponse.json({ imported: 0, skipped: skipped.length, invalid: invalid.length,
      message: 'All records already exist in your collection' });
  }

  let imported = 0;
  const errors = [];
  for (let i = 0; i < toInsert.length; i += 50) {
    const { error, data } = await supabase.from('collection')
      .insert(toInsert.slice(i, i + 50)).select('id');
    if (error) errors.push(error.message);
    else imported += data?.length || 0;
  }

  // Update portfolio snapshot
  const { data: all } = await supabase
    .from('collection').select('purchase_price, current_price, median_price').eq('user_id', user.id);
  if (all?.length) {
    const tv = all.reduce((s,i)=>s+(Number(i.median_price||i.current_price||i.purchase_price)||0),0);
    const tp = all.reduce((s,i)=>s+(Number(i.purchase_price)||0),0);
    await supabase.from('portfolio_snapshots').upsert({
      user_id: user.id, snapshot_date: new Date().toISOString().split('T')[0],
      total_value: tv, total_paid: tp, item_count: all.length,
    }, { onConflict: 'user_id,snapshot_date' });
  }

  return NextResponse.json({
    imported, skipped: skipped.length, invalid: invalid.length,
    errors: errors.length ? errors.slice(0, 3) : undefined,
    message: `Imported ${imported} records, skipped ${skipped.length} duplicates`,
  });
}
