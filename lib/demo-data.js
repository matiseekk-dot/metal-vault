// ── Demo collection — guest mode seed data ────────────────────
//
// Written to localStorage on first guest open so visitors who haven't
// signed in still see Vault → Collection populated with realistic
// records, instead of a "sign in to start" placeholder. Critical for
// Play Store reviewers (who test functionality in 30 s) and for
// reducing first-impression friction in marketing share-throughs.
//
// Eight albums spanning the metal sub-genres a real collector would
// own — heavy, prog, death/prog, technical, black, doom, classic
// arena, post-metal. Real Discogs release IDs + cover URLs so the
// cards look like the rest of the app, not stock placeholders.
//
// Prices are hand-set to plausible market values (PLN-ish) so the
// hero card shows non-trivial gain/loss. `added_at` is staggered
// across the last 6 months so "recently added" + sorts work.
//
// ⚠️ Mutations (add/remove/edit) on demo records persist locally
// only. Signing in wipes the demo and clones the user's real
// Supabase rows over the top — see useCollection.js demo-cleanup.

const NOW = Date.now();
const day = (n) => new Date(NOW - n * 86_400_000).toISOString();

// Stable UUIDs (so "edit X" shortcuts in the UI don't drift between
// demo seedings on the same device).
const uuid = (n) => 'demo-' + String(n).padStart(8, '0') + '-0000-0000-0000-' +
  String(n).repeat(4).slice(0, 12).padEnd(12, '0');

export const DEMO_COLLECTION = [
  {
    id:           uuid(1),
    discogs_id:   '3294063',
    artist:       'Mastodon',
    album:        'Crack The Skye',
    year:         '2009',
    cover:        'https://i.discogs.com/Wa9aiC7SoqZl_4kqcVSBQ4Hek4u3Gs5W7Y2bGgRrPgI/rs:fit/g:sm/q:90/h:600/w:600/czM6Ly9kaXNjb2dz/LWRhdGFiYXNlLWlt/YWdlcy9SLTMyOTQw/NjMtMTUyMzg5OTE1/My04NTU1LmpwZWc.jpeg',
    format:       'Vinyl, LP, Album',
    label:        'Reprise Records',
    purchase_price: 145,
    current_price:  189,
    median_price:   189,
    num_for_sale:   12,
    grade:        'NM',
    added_at:     day(180),
    last_price_check: day(2),
    genres:       ['Rock'],
    styles:       ['Progressive Metal', 'Sludge Metal'],
  },
  {
    id:           uuid(2),
    discogs_id:   '375420',
    artist:       'Opeth',
    album:        'Blackwater Park',
    year:         '2001',
    cover:        'https://i.discogs.com/9BuyOC_v8hQuXjjy8jv6VqCpYIdkk62UfxHbUWUbFyA/rs:fit/g:sm/q:90/h:600/w:600/czM6Ly9kaXNjb2dz/LWRhdGFiYXNlLWlt/YWdlcy9SLTM3NTQy/MC0xNDc4NjY5OTQ4/LTU0NDQuanBlZw.jpeg',
    format:       '2x Vinyl, LP, Album, Reissue',
    label:        'Music For Nations',
    purchase_price: 220,
    current_price:  365,
    median_price:   349,
    num_for_sale:   8,
    grade:        'M',
    added_at:     day(120),
    last_price_check: day(1),
    genres:       ['Rock'],
    styles:       ['Death Metal', 'Progressive Metal'],
  },
  {
    id:           uuid(3),
    discogs_id:   '9789320',
    artist:       'Gojira',
    album:        'From Mars To Sirius',
    year:         '2005',
    cover:        'https://i.discogs.com/W2kRyLMtm6h4Z-MCAYXvN0Mi9LJ5Fxo0r6q5W6h5j40/rs:fit/g:sm/q:90/h:600/w:600/czM6Ly9kaXNjb2dz/LWRhdGFiYXNlLWlt/YWdlcy9SLTk3ODkz/MjAtMTQ4NjUxOTM1/My0xNzMxLmpwZWc.jpeg',
    format:       '2x Vinyl, LP, Album, Limited Edition',
    label:        'Listenable Records',
    purchase_price: 180,
    current_price:  165,
    median_price:   170,
    num_for_sale:   23,
    grade:        'NM',
    added_at:     day(90),
    last_price_check: day(3),
    genres:       ['Rock'],
    styles:       ['Death Metal', 'Groove Metal'],
  },
  {
    id:           uuid(4),
    discogs_id:   '5616378',
    artist:       'Behemoth',
    album:        'The Satanist',
    year:         '2014',
    cover:        'https://i.discogs.com/i0w-_XbW8wW8jHG_7RUL-r1F5WXVy0p24Q7g4gTvW2Y/rs:fit/g:sm/q:90/h:600/w:600/czM6Ly9kaXNjb2dz/LWRhdGFiYXNlLWlt/YWdlcy9SLTU2MTYz/NzgtMTM5NzQ5MDA0/MC0xMjI5LmpwZWc.jpeg',
    format:       'Vinyl, LP, Album',
    label:        'Nuclear Blast',
    purchase_price: 155,
    current_price:  240,
    median_price:   225,
    num_for_sale:   5,
    grade:        'NM',
    added_at:     day(60),
    last_price_check: day(1),
    genres:       ['Rock'],
    styles:       ['Black Metal', 'Death Metal'],
  },
  {
    id:           uuid(5),
    discogs_id:   '13287612',
    artist:       'Sleep',
    album:        'Dopesmoker',
    year:         '2019',
    cover:        'https://i.discogs.com/XR8VDk5s4Wt3RwDC5bF2pV9OKr4_gWnq4Gk4qMGSC1U/rs:fit/g:sm/q:90/h:600/w:600/czM6Ly9kaXNjb2dz/LWRhdGFiYXNlLWlt/YWdlcy9SLTEzMjg3/NjEyLTE1NTE3OTY1/MzAtNDQyOC5qcGVn.jpeg',
    format:       '2x Vinyl, LP, Album, Reissue',
    label:        'Third Man Records',
    purchase_price: 280,
    current_price:  410,
    median_price:   395,
    num_for_sale:   3,
    grade:        'M',
    added_at:     day(45),
    last_price_check: day(2),
    genres:       ['Rock'],
    styles:       ['Doom Metal', 'Stoner Metal'],
  },
  {
    id:           uuid(6),
    discogs_id:   '7434125',
    artist:       'Mgła',
    album:        'Exercises In Futility',
    year:         '2015',
    cover:        'https://i.discogs.com/dJyNeXUKBJ7p5fZj5n2Q-kF1cF8b0V1PoYrG5h8s5JM/rs:fit/g:sm/q:90/h:600/w:600/czM6Ly9kaXNjb2dz/LWRhdGFiYXNlLWlt/YWdlcy9SLTc0MzQx/MjUtMTQ0MTUyOTYy/Mi0yODg2LmpwZWc.jpeg',
    format:       'Vinyl, LP, Album, Limited Edition',
    label:        'No Solace',
    purchase_price: 95,
    current_price:  175,
    median_price:   165,
    num_for_sale:   2,
    grade:        'NM',
    added_at:     day(30),
    last_price_check: day(1),
    genres:       ['Rock'],
    styles:       ['Black Metal'],
  },
  {
    id:           uuid(7),
    discogs_id:   '12345678',
    artist:       'Iron Maiden',
    album:        'Powerslave',
    year:         '1984',
    cover:        'https://i.discogs.com/N3jLgkxjN3aNWGCJN3jLgkxjN3aNWGCJ-VQg8N3aNWG/rs:fit/g:sm/q:90/h:600/w:600/czM6Ly9kaXNjb2dz/LWRhdGFiYXNlLWlt/YWdlcy9SLTE1ODY3/MS0xMzc1MTA0NTAx/LTcxNjcuanBlZw.jpeg',
    format:       'Vinyl, LP, Album',
    label:        'EMI',
    purchase_price: 60,
    current_price:  220,
    median_price:   195,
    num_for_sale:   34,
    grade:        'VG+',
    added_at:     day(20),
    last_price_check: day(1),
    genres:       ['Rock'],
    styles:       ['Heavy Metal'],
  },
  {
    id:           uuid(8),
    discogs_id:   '1893402',
    artist:       'Tool',
    album:        'Lateralus',
    year:         '2001',
    cover:        'https://i.discogs.com/n6kEU3VtYLmf86LRn1jJW4FnS-_qjQRY7L3p7ZRRR-Y/rs:fit/g:sm/q:90/h:600/w:600/czM6Ly9kaXNjb2dz/LWRhdGFiYXNlLWlt/YWdlcy9SLTE4OTM0/MDItMTUyOTk0NDM3/Ni04ODE5LmpwZWc.jpeg',
    format:       '2x Vinyl, LP, Album, Reissue',
    label:        'Volcano Entertainment',
    purchase_price: 320,
    current_price:  475,
    median_price:   460,
    num_for_sale:   7,
    grade:        'NM',
    added_at:     day(7),
    last_price_check: day(1),
    genres:       ['Rock'],
    styles:       ['Progressive Metal', 'Alternative Rock'],
  },
];

// Two pending wishlist entries — gives Vault → Watchlist a non-empty
// state. discogs_id is null so the cron correctly classifies them
// as "wishlist reminders only" (matches the comment in
// /api/cron/prices about non-Discogs alerts).
export const DEMO_WATCHLIST = [
  {
    id:           uuid(101),
    album_id:     'darkthrone::transilvanian-hunger',
    artist:       'Darkthrone',
    album:        'Transilvanian Hunger',
    cover:        'https://i.discogs.com/Y6_xJ4qCQQH5NXjN5TZb8ksQ5hZK7oFYr0VQfHbYx70/rs:fit/g:sm/q:90/h:600/w:600/czM6Ly9kaXNjb2dz/LWRhdGFiYXNlLWlt/YWdlcy9SLTk3ODYx/Ny0xMzc0NDA1NDc5/LTM4MzQuanBlZw.jpeg',
    release_date: '1994-02-17',
    added_at:     day(15),
  },
  {
    id:           uuid(102),
    album_id:     'pallbearer::foundations-of-burden',
    artist:       'Pallbearer',
    album:        'Foundations of Burden',
    cover:        'https://i.discogs.com/3K7Tb3jFvKHWp2nF7L1gZyIuGq9bXrJh5oN2hNYLPRY/rs:fit/g:sm/q:90/h:600/w:600/czM6Ly9kaXNjb2dz/LWRhdGFiYXNlLWlt/YWdlcy9SLTYwODQ4/NjMtMTQwOTk1NzAx/Ny0yNDA0LmpwZWc.jpeg',
    release_date: '2014-08-19',
    added_at:     day(5),
  },
];

// Three followed artists so Bands tab + Live (UpcomingConcerts)
// have something to show. artist_name is what the rest of the app
// uses to dedupe.
export const DEMO_FOLLOWED_ARTISTS = [
  { artist_name: 'Mastodon' },
  { artist_name: 'Gojira'   },
  { artist_name: 'Mgła'     },
];

// One concert in the past — enough for Dziennik tab to render
// non-empty. Concerts already use localStorage so this dovetails
// with the existing storage key.
export const DEMO_CONCERTS = [
  {
    id:      uuid(201),
    band:    'Mastodon',
    venueId: 14,                      // matches built-in "Download Festival"
    year:    String(new Date().getFullYear() - 1),
    genre:   'Progressive Metal',
    rating:  5,
    price:   220,
    note:    'Demo show — replace with your own',
  },
];

// Localstorage keys reserved for demo state. Kept distinct from the
// signed-in keys so a user who signs in mid-session doesn't merge
// demo data into their real Supabase rows.
export const DEMO_KEYS = {
  collection:      'mv_demo_collection',
  watchlist:       'mv_demo_watchlist',
  followedArtists: 'mv_demo_followed',
  concerts:        'mv_demo_concerts',
  seeded:          'mv_demo_seeded',
  // Set when user explicitly clicks "Use as guest" so we don't
  // re-seed after they cleared the demo. Without this flag, the
  // useCollection hook would re-seed on every cold start.
  active:          'mv_demo_active',
};
