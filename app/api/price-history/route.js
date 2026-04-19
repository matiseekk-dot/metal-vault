export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { createClient, getAdminClient } from '@/lib/supabase-server';
import { isPremium } from '@/lib/stripe';

export async function GET(request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Price history = Pro feature
  const { data: profile } = await getAdminClient()
    .from('profiles').select('subscription_status, subscription_end, plan').eq('id', user.id).single();

  if (!isPremium(profile)) {
    return NextResponse.json({ error: 'PREMIUM_REQUIRED', message: 'Price history requires Metal Vault Pro.' }, { status: 403 });
  }

  const discogsId = new URL(request.url).searchParams.get('discogs_id');
  if (!discogsId) return NextResponse.json({ error: 'discogs_id required' }, { status: 400 });

  const { data, error } = await getAdminClient()
    .from('price_history')
    .select('snapshot_date, lowest_price, median_price')
    .eq('discogs_id', discogsId)
    .order('snapshot_date', { ascending: true })
    .limit(365); // 1 year of data

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ history: data || [] });
}
