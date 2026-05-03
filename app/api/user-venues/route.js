// ── /api/user-venues ───────────────────────────────────────────────
// User-added venues for the concert journal (built-in venues stay
// hardcoded in ConcertsTab.js).
//
// POST   → upsert one venue: { id, name, city, cat }
// DELETE → ?id=<client_id>
// PUT    → bulk import { venues: [...] } (one-shot localStorage migration)

export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';

function cleanVenue(v) {
  return {
    name: String(v.name || '').trim().slice(0, 200),
    city: String(v.city ?? '').slice(0, 120),
    cat:  String(v.cat  ?? 'Other').slice(0, 30),
  };
}

export async function POST(request) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const id = body.id ? String(body.id).slice(0, 80) : null;
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

  const fields = cleanVenue(body);
  if (!fields.name) return NextResponse.json({ error: 'Missing name' }, { status: 400 });

  const { error } = await sb.from('user_venues').upsert({
    user_id:   user.id,
    client_id: id,
    ...fields,
  }, { onConflict: 'user_id,client_id' });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(request) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

  const { error } = await sb
    .from('user_venues')
    .delete()
    .eq('user_id', user.id)
    .eq('client_id', id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function PUT(request) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const items = Array.isArray(body.venues) ? body.venues : [];
  if (items.length === 0) return NextResponse.json({ ok: true, imported: 0 });
  if (items.length > 500) {
    return NextResponse.json({ error: 'Too many items in one batch' }, { status: 413 });
  }

  const rows = items
    .filter(v => v?.id && v?.name)
    .map(v => ({
      user_id:   user.id,
      client_id: String(v.id).slice(0, 80),
      ...cleanVenue(v),
    }));

  if (rows.length === 0) return NextResponse.json({ ok: true, imported: 0 });

  const { error } = await sb
    .from('user_venues')
    .upsert(rows, { onConflict: 'user_id,client_id' });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, imported: rows.length });
}
