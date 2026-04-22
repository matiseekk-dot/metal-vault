// ────────────────────────────────────────────────────────────────
// Vault Persona — algorithmic "metal identity" based on user's collection.
// Computes: title archetype, top genres, top label, era, crown jewel,
// completionist scores per subgenre. All derived from collection data.
// ────────────────────────────────────────────────────────────────

export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { genreTagsForItem } from '@/lib/genre-helper';

// ── Archetypes: pattern → title ──
// Checked in order; first match wins. Fallback = "Metal Collector".
const ARCHETYPES = [
  { test: c => c.topGenrePct >= 60 && /death/i.test(c.topGenre),  title: 'Death Metal Devotee' },
  { test: c => c.topGenrePct >= 60 && /black/i.test(c.topGenre),  title: 'Black Metal Purist' },
  { test: c => c.topGenrePct >= 60 && /doom|sludge/i.test(c.topGenre), title: 'Doom Dweller' },
  { test: c => c.topGenrePct >= 60 && /thrash/i.test(c.topGenre), title: 'Thrash Traditionalist' },
  { test: c => c.topGenrePct >= 60 && /prog/i.test(c.topGenre),   title: 'Prog Architect' },
  { test: c => c.topGenrePct >= 60 && /power/i.test(c.topGenre),  title: 'Power Metal Paladin' },
  { test: c => c.topLabelPct   >= 35,                              title: c => c.topLabel + ' Loyalist' },
  { test: c => c.uniqueGenres >= 8,                                title: 'Eclectic Chronicler' },
  { test: c => c.rareCount    >= 10,                               title: 'Rare Pressing Hunter' },
  { test: c => c.eraSpan      >= 40,                               title: 'Timeline Archaeologist' },
  { test: c => c.topEra === '2020s',                               title: 'Modern Era Scout' },
  { test: c => c.topEra === '1980s' || c.topEra === '1990s',       title: 'Old School Keeper' },
  { test: () => true,                                              title: 'Metal Collector' },
];

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: items, error } = await supabase
    .from('collection').select('*').eq('user_id', user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (!items || items.length === 0) {
    return NextResponse.json({ empty: true, message: 'Add records to see your Persona' });
  }

  // ── Genres (flatten + count) ──
  // IMPORTANT: use genreTagsForItem which prefers `styles` over `genres` and
  // filters out generic parent buckets like "Rock" when a specific style exists.
  // Without this, most metal collections get tagged "Rock" as #1 genre.
  const genreCounts = {};
  for (const i of items) {
    const tags = genreTagsForItem(i);
    for (const g of tags) {
      if (!g) continue;
      genreCounts[g] = (genreCounts[g] || 0) + 1;
    }
  }
  const genresSorted = Object.entries(genreCounts).sort((a, b) => b[1] - a[1]);
  const topGenre = genresSorted[0]?.[0] || 'Metal';
  const topGenrePct = genresSorted[0] ? Math.round((genresSorted[0][1] / items.length) * 100) : 0;
  const top3Genres = genresSorted.slice(0, 3).map(([name, count]) => ({
    name, count, pct: Math.round((count / items.length) * 100),
  }));

  // ── Labels ──
  const labelCounts = {};
  for (const i of items) {
    if (!i.label) continue;
    labelCounts[i.label] = (labelCounts[i.label] || 0) + 1;
  }
  const labelsSorted = Object.entries(labelCounts).sort((a, b) => b[1] - a[1]);
  const topLabel = labelsSorted[0]?.[0] || null;
  const topLabelPct = labelsSorted[0] ? Math.round((labelsSorted[0][1] / items.length) * 100) : 0;

  // ── Eras (decades) ──
  const eraCounts = { '1970s': 0, '1980s': 0, '1990s': 0, '2000s': 0, '2010s': 0, '2020s': 0 };
  const years = [];
  for (const i of items) {
    const y = parseInt(i.year, 10);
    if (!y || y < 1970 || y > 2030) continue;
    years.push(y);
    const decade = Math.floor(y / 10) * 10;
    const key = decade + 's';
    if (eraCounts[key] !== undefined) eraCounts[key]++;
  }
  const topEra = Object.entries(eraCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'Unknown';
  const eraSpan = years.length > 0 ? Math.max(...years) - Math.min(...years) : 0;

  // ── Artists ──
  const artistCounts = {};
  for (const i of items) {
    if (!i.artist) continue;
    artistCounts[i.artist] = (artistCounts[i.artist] || 0) + 1;
  }
  const uniqueArtists = Object.keys(artistCounts).length;
  const topArtist = Object.entries(artistCounts).sort((a, b) => b[1] - a[1])[0];

  // ── Money ──
  const totalPaid = items.reduce((s, i) => s + (Number(i.purchase_price) || 0), 0);
  const totalValue = items.reduce((s, i) => s + (Number(i.median_price || i.current_price || i.purchase_price) || 0), 0);
  const gain = totalValue - totalPaid;
  const gainPct = totalPaid > 0 ? Math.round((gain / totalPaid) * 100) : 0;

  // ── Crown jewel — most valuable single record ──
  const crownJewel = [...items]
    .map(i => ({
      artist: i.artist,
      album:  i.album,
      value:  Number(i.median_price || i.current_price || 0),
      cover:  i.cover,
      year:   i.year,
    }))
    .filter(i => i.value > 0)
    .sort((a, b) => b.value - a.value)[0] || null;

  // ── Rarity proxy: items worth 2x+ paid price ──
  const rareCount = items.filter(i => {
    const paid = Number(i.purchase_price) || 0;
    const val  = Number(i.median_price || i.current_price) || 0;
    return paid > 0 && val >= paid * 2;
  }).length;

  const uniqueGenres = Object.keys(genreCounts).length;

  // ── Pick archetype ──
  const context = {
    topGenre, topGenrePct, topLabel, topLabelPct, topEra, eraSpan,
    uniqueGenres, rareCount,
  };
  const archetype = ARCHETYPES.find(a => a.test(context));
  const title = typeof archetype.title === 'function' ? archetype.title(context) : archetype.title;

  return NextResponse.json({
    title,
    stats: {
      recordCount: items.length,
      uniqueArtists,
      totalPaid:  Math.round(totalPaid),
      totalValue: Math.round(totalValue),
      gain:       Math.round(gain),
      gainPct,
    },
    topGenre: { name: topGenre, pct: topGenrePct },
    top3Genres,
    topLabel: topLabel ? { name: topLabel, pct: topLabelPct } : null,
    topEra,
    eraSpan,
    topArtist: topArtist ? { name: topArtist[0], count: topArtist[1] } : null,
    crownJewel,
    rareCount,
  });
}
