export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';

export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Get all unique artists from collection
  const { data: items } = await supabase
    .from('collection')
    .select('artist')
    .eq('user_id', user.id);

  if (!items?.length) return NextResponse.json({ followed: 0 });

  // Get already followed artists
  const { data: existing } = await supabase
    .from('artist_follows')
    .select('artist_name')
    .eq('user_id', user.id);

  const alreadyFollowed = new Set((existing || []).map(a => a.artist_name));

  // Unique artists not yet followed
  const toFollow = [...new Set(items.map(i => i.artist).filter(Boolean))]
    .filter(name => !alreadyFollowed.has(name));

  if (!toFollow.length) {
    return NextResponse.json({ followed: 0, message: 'All artists already followed' });
  }

  // Batch insert
  const { data, error } = await supabase
    .from('artist_follows')
    .insert(toFollow.map(name => ({ user_id: user.id, artist_name: name })))
    .select();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    followed: data?.length || 0,
    total:    toFollow.length,
    artists:  (data || []).map(a => a.artist_name),
  });
}
