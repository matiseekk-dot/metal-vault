// ── /api/user-concerts ─────────────────────────────────────────────
// Personal concert journal CRUD. Backs the "When's On → Concerts" tab.
//
// GET    → returns { concerts: [...], venues: [...] } for the user
// POST   → upsert one concert: { id, band, venueId, year, genre, rating, price, note }
//          (id = client_id, generated client-side via crypto.randomUUID)
// DELETE → ?id=<client_id> removes one concert
//
// User-added venues are at /api/user-venues. Built-in venues (arenas,
// festivals) stay hardcoded in app/concerts/ConcertsTab.js — they have
// numeric ids that the client stringifies before sending.

export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';

function clean(item) {
  // Coerce to expected types and trim. Values that don't fit the column
  // schema get neutered so a malformed payload can't crash the upsert.
  const out = {
    band:     String(item.band || '').trim().slice(0, 200),
    venue_id: item.venueId ? String(item.venueId).slice(0, 80) : null,
    year:     item.year ? String(item.year).slice(0, 8) : null,
    genre:    String(item.genre || 'Metal').slice(0, 60),
    rating:   Math.max(0, Math.min(5, Number(item.rating) || 0)),
    price:    String(item.price ?? '').slice(0, 40),
    note:     String(item.note ?? '').slice(0, 2000),
  };
  // Optional planned-concert fields. Only include them when the client
  // explicitly sent them — keeps PATCH-like partial updates from
  // silently flipping a past gig to upcoming.
  if (item.is_planned !== undefined)     out.is_planned     = !!item.is_planned;
  if (item.tickets_bought !== undefined) out.tickets_bought = !!item.tickets_bought;
  if (item.planned_date !== undefined) {
    // Accept ISO date strings (YYYY-MM-DD); null clears.
    out.planned_date = item.planned_date ? String(item.planned_date).slice(0, 10) : null;
  }
  return out;
}

export async function GET() {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const [{ data: concerts, error: cErr }, { data: venues, error: vErr }] = await Promise.all([
    sb.from('user_concerts').select('*').eq('user_id', user.id).order('updated_at', { ascending: false }),
    sb.from('user_venues').select('*').eq('user_id', user.id),
  ]);

  if (cErr) return NextResponse.json({ error: cErr.message }, { status: 500 });
  if (vErr) return NextResponse.json({ error: vErr.message }, { status: 500 });

  // Reshape rows to the client-side format the UI already expects (id
  // instead of client_id, venueId instead of venue_id).
  return NextResponse.json({
    concerts: (concerts || []).map(c => ({
      id: c.client_id,
      band: c.band,
      venueId: c.venue_id,
      year: c.year,
      genre: c.genre,
      rating: c.rating,
      price: c.price,
      note: c.note,
      // Planned-concert fields. Defensive defaults so the UI keeps
      // rendering past gigs unchanged when migration 038 hasn't been
      // applied yet (column simply absent → undefined → falsy).
      is_planned:     !!c.is_planned,
      tickets_bought: !!c.tickets_bought,
      planned_date:   c.planned_date || null,
    })),
    venues: (venues || []).map(v => ({
      id: v.client_id,
      name: v.name,
      city: v.city,
      cat: v.cat,
    })),
  });
}

export async function POST(request) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const id = body.id ? String(body.id).slice(0, 80) : null;
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

  const fields = clean(body);
  if (!fields.band) return NextResponse.json({ error: 'Missing band' }, { status: 400 });

  const { error } = await sb.from('user_concerts').upsert({
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
    .from('user_concerts')
    .delete()
    .eq('user_id', user.id)
    .eq('client_id', id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

// PUT — bulk import endpoint, used once on first login per device to push
// any concerts the user already had in localStorage up to the server.
// Body: { concerts: [{ id, band, venueId, year, genre, rating, price, note }, ...] }
// Idempotent thanks to (user_id, client_id) primary key.
export async function PUT(request) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const items = Array.isArray(body.concerts) ? body.concerts : [];
  if (items.length === 0) return NextResponse.json({ ok: true, imported: 0 });
  if (items.length > 1000) {
    // Sanity cap. Even prolific concert-goers don't have 1000+ shows.
    return NextResponse.json({ error: 'Too many items in one batch' }, { status: 413 });
  }

  const rows = items
    .filter(i => i?.id && i?.band)
    .map(i => ({
      user_id:   user.id,
      client_id: String(i.id).slice(0, 80),
      ...clean(i),
    }));

  if (rows.length === 0) return NextResponse.json({ ok: true, imported: 0 });

  const { error } = await sb
    .from('user_concerts')
    .upsert(rows, { onConflict: 'user_id,client_id', ignoreDuplicates: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, imported: rows.length });
}
