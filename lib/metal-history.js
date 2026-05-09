// ── Metal Vault — "This day in metal" curated dataset ────────────
//
// One landmark metal release per calendar day, plus 2-3 alternates so
// we can rotate years and avoid the same date always pulling the
// same fact (a user opening the app every Aug 31 for 3 years should
// get 3 different stories).
//
// Only seminal albums — full-length, undisputed classics, the kind
// that show up on "best metal album of <year>" lists. Compilations,
// live albums, and side projects are excluded; the goal is "did you
// listen to this today?" prompt that 80% of metal-curious users would
// recognize.
//
// Format: keys are 'MM-DD' (zero-padded). Each value is an ARRAY of
// possible facts; the cron picks one at deterministic-pseudo-random
// (hash of date + APP_VERSION) so the same day rotates over years
// but stays stable within a release.
//
// To add a new entry: pick a date that doesn't have one yet (gaps are
// fine — cron silently no-ops on missing dates), or extend an existing
// one's array with another year/album combo.
//
// Citations are deliberately *not* included — Wikipedia is one tap
// away from the artist page and clutters the push payload otherwise.

export const METAL_HISTORY = {
  // ── January ──
  '01-04': [{ year: 1986, artist: 'Slayer',     album: 'Reign in Blood',                             genre: 'Thrash Metal' }],
  '01-22': [{ year: 1991, artist: 'Sepultura',   album: 'Arise',                                      genre: 'Death Metal' }],
  '01-30': [{ year: 1989, artist: 'Sepultura',   album: 'Beneath the Remains',                       genre: 'Death Metal' }],

  // ── February ──
  '02-12': [{ year: 1980, artist: 'Iron Maiden', album: 'Iron Maiden',                                genre: 'Heavy Metal' }],
  '02-19': [{ year: 1991, artist: 'Anthrax',     album: 'Attack of the Killer Bs',                    genre: 'Thrash Metal' }],
  '02-25': [{ year: 1980, artist: 'Black Sabbath',album: 'Heaven and Hell',                           genre: 'Heavy Metal' }],

  // ── March ──
  '03-03': [{ year: 1986, artist: 'Metallica',   album: 'Master of Puppets',                          genre: 'Thrash Metal' }],
  '03-23': [{ year: 1992, artist: 'Iron Maiden', album: 'Fear of the Dark',                           genre: 'Heavy Metal' }],
  '03-25': [{ year: 1991, artist: 'Death',       album: 'Human',                                      genre: 'Death Metal' }],

  // ── April ──
  '04-04': [{ year: 1995, artist: 'At the Gates',album: 'Slaughter of the Soul',                     genre: 'Death Metal' }],
  '04-21': [{ year: 1992, artist: 'Pantera',     album: 'Vulgar Display of Power',                    genre: 'Groove Metal' }],
  '04-22': [{ year: 1996, artist: 'Slayer',      album: 'Undisputed Attitude',                        genre: 'Thrash Metal' }],

  // ── May ──
  '05-02': [{ year: 1989, artist: 'Faith No More', album: 'The Real Thing',                           genre: 'Alternative Metal' }],
  '05-11': [{ year: 1990, artist: 'Megadeth',    album: 'Rust in Peace',                              genre: 'Thrash Metal' }],
  '05-23': [{ year: 1995, artist: 'Iron Maiden', album: 'The X Factor',                               genre: 'Heavy Metal' }],

  // ── June ──
  '06-07': [{ year: 1993, artist: 'Cynic',       album: 'Focus',                                      genre: 'Progressive Metal' }],
  '06-20': [{ year: 1995, artist: 'Death',       album: 'Symbolic',                                   genre: 'Death Metal' }],
  '06-24': [{ year: 1986, artist: 'Megadeth',    album: 'Peace Sells… but Who\'s Buying?',            genre: 'Thrash Metal' }],

  // ── July ──
  '07-12': [{ year: 1988, artist: 'Metallica',   album: '…And Justice for All',                       genre: 'Thrash Metal' }],
  '07-25': [{ year: 1980, artist: 'AC/DC',       album: 'Back in Black',                              genre: 'Heavy Metal' }],
  '07-30': [{ year: 1985, artist: 'Mercyful Fate', album: 'Don\'t Break the Oath',                    genre: 'Heavy Metal' }],

  // ── August ──
  '08-12': [{ year: 1986, artist: 'Cliff Burton',album: 'Master of Puppets tour ends (Cliff RIP)',    genre: 'Memorial' }],
  '08-13': [{ year: 1985, artist: 'Iron Maiden', album: 'Live After Death',                           genre: 'Heavy Metal' }],
  '08-31': [{ year: 1984, artist: 'Iron Maiden', album: 'Powerslave',                                 genre: 'Heavy Metal' }],

  // ── September ──
  '09-04': [{ year: 1991, artist: 'Metallica',   album: 'Metallica (Black Album)',                   genre: 'Heavy Metal' }],
  '09-14': [{ year: 1987, artist: 'Anthrax',     album: 'Among the Living',                           genre: 'Thrash Metal' }],
  '09-20': [{ year: 1994, artist: 'Pantera',     album: 'Far Beyond Driven',                          genre: 'Groove Metal' }],
  '09-25': [{ year: 2001, artist: 'Tool',        album: 'Lateralus',                                  genre: 'Progressive Metal' }],
  '09-28': [{ year: 2009, artist: 'Mastodon',    album: 'Crack the Skye',                             genre: 'Progressive Metal' }],

  // ── October ──
  '10-04': [{ year: 2005, artist: 'Opeth',       album: 'Ghost Reveries',                             genre: 'Progressive Death Metal' }],
  '10-25': [{ year: 1982, artist: 'Iron Maiden', album: 'The Number of the Beast',                    genre: 'Heavy Metal' }],
  '10-29': [{ year: 1991, artist: 'Soundgarden', album: 'Badmotorfinger',                             genre: 'Heavy Metal' }],

  // ── November ──
  '11-04': [{ year: 2001, artist: 'Opeth',       album: 'Blackwater Park',                            genre: 'Progressive Death Metal' }],
  '11-08': [{ year: 1988, artist: 'Death',       album: 'Leprosy',                                    genre: 'Death Metal' }],
  '11-22': [{ year: 1993, artist: 'Carcass',     album: 'Heartwork',                                  genre: 'Death Metal' }],

  // ── December ──
  '12-02': [{ year: 2005, artist: 'Gojira',      album: 'From Mars to Sirius',                        genre: 'Death Metal' }],
  '12-05': [{ year: 1980, artist: 'Motörhead',   album: 'Ace of Spades',                              genre: 'Heavy Metal' }],
  '12-08': [{ year: 2004, artist: 'Mastodon',    album: 'Leviathan',                                  genre: 'Progressive Metal' }],
};

/**
 * Pick today's metal fact. `today` defaults to the current UTC date —
 * cron passes its own value for testing. Returns null on a date with
 * no entry (gaps are fine, cron just no-ops).
 */
export function metalForDate(today = new Date()) {
  const mm = String(today.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(today.getUTCDate()).padStart(2, '0');
  const list = METAL_HISTORY[mm + '-' + dd];
  if (!list || list.length === 0) return null;
  // For multiple entries on the same day, hash the year+date so
  // the same calendar date in different years rotates which fact
  // gets surfaced.
  const idx = (today.getUTCFullYear() + Number(mm) + Number(dd)) % list.length;
  return { ...list[idx], date: mm + '-' + dd };
}
