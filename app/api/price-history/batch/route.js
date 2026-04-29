// ── Price history batch endpoint ──────────────────────────────
// Returns last 30 days of median_price snapshots for many records at once.
// Used by Vault collection list to render per-record sparklines.
//
// Pro-only (consistent with /api/price-history).
//
// POST { discogs_ids: [123, 456, ...] }  (max 200 IDs per call)
// Returns { histories: { "123": [12, 13, 14, ...], "456": [...] } }
//
// Values are median_price as numbers; dates are implied positional (last 30 days).
// We collapse to value array (no dates) because sparklines only need the shape.

export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { createClient, getAdminClient } from '@/lib/supabase-server';
import { isPremium } from '@/lib/stripe';

const MAX_IDS = 200;
const DAYS = 30;

export async function POST(request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Pro-only
  const { data: profile } = await getAdminClient()
    .from('profiles').select('subscription_status, subscription_end, plan').eq('id', user.id).single();
  if (!isPremium(profile)) {
    return NextResponse.json({ histories: {}, error: 'PREMIUM_REQUIRED' }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const ids = Array.isArray(body.discogs_ids) ? body.discogs_ids : [];

  // Deduplicate + cap + coerce to numbers (defense against malformed input)
  const uniqIds = [...new Set(ids.map(id => Number(id)).filter(n => Number.isInteger(n) && n > 0))]
    .slice(0, MAX_IDS);

  if (uniqIds.length === 0) {
    return NextResponse.json({ histories: {} });
  }

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - DAYS);

  const { data, error } = await getAdminClient()
    .from('price_history')
    .select('discogs_id, snapshot_date, median_price')
    .in('discogs_id', uniqIds)
    .gte('snapshot_date', cutoff.toISOString().split('T')[0])
    .order('snapshot_date', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Group by discogs_id, collapse to value arrays.
  // Filter out null medians — sparkline can't render nulls and a partial array
  // is still meaningful (just shorter).
  const histories = {};
  for (const row of data || []) {
    const v = row.median_price;
    if (v == null) continue;
    const key = String(row.discogs_id);
    if (!histories[key]) histories[key] = [];
    histories[key].push(Number(v));
  }

  return NextResponse.json({ histories });
}
