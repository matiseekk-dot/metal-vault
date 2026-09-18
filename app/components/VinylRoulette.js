'use client';
// ── VinylRoulette — "what should I spin tonight?" random picker ────
//
// One-tap daily engagement hook: pick a random record from the user's
// own collection, weighted so it actually surfaces something worth
// rediscovering rather than pure uniform noise:
//
//   • Never-played records (play_count === 0)          → weight 4
//   • "Dust collecting" — not spun in 90+ days          → weight 2
//   • Everything else (recently played)                → weight 1
//
// Excludes sold and pre-ordered rows (nothing to physically play yet).
// Optional genre chip narrows the pool to a mood ("something heavier
// tonight") without needing real audio-mood classification.
//
// Logging a spin reuses the existing ListenButton — same POST
// /api/listens path, same optimistic play_count/last_played_at patch
// the rest of the app already relies on, so a roulette-logged spin
// shows up identically in Stats / Listening tab / dust-collection
// callouts elsewhere.

import { useState, useMemo } from 'react';
import { C, MONO, BEBAS } from '@/lib/theme';
import { useT } from '@/lib/i18n';
import { useBackButton } from '@/lib/hooks/useBackButton';
import { realGenre } from '@/lib/genre-helper';
import { track } from '@/lib/analytics';
import { haptic } from '@/lib/haptics';
import ListenButton from '@/app/components/ListenButton';
import { AlbumCover } from '@/app/components/ui';

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;
const SPIN_MS = 650;   // brief shuffle animation before reveal — long
                        // enough to read as "choosing", short enough
                        // to not feel like a loading stall

// Mirrors ListenButton.js's own relativeTime() exactly — same i18n keys,
// same tier boundaries — so "last spun" reads identically whether it's
// shown here or on the card's play chip. (An earlier version of this
// skipped the minutes tier and misreported a spin logged seconds ago
// as "1 hour ago".)
function relTime(iso, t) {
  if (!iso) return null;
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 60) return t('listen.justPlayed.minutesAgo', { n: Math.max(m, 1) });
  const h = Math.floor(m / 60);
  if (h < 24) return t('listen.justPlayed.hoursAgo', { n: h });
  const d = Math.floor(h / 24);
  if (d < 30) return t('listen.justPlayed.daysAgo', { n: d });
  const mo = Math.floor(d / 30);
  if (mo < 12) return t('listen.justPlayed.monthsAgo', { n: mo });
  const y = Math.floor(d / 365);
  return t('listen.justPlayed.yearsAgo', { n: y });
}

function weightOf(item) {
  const playCount = Number(item.play_count) || 0;
  if (playCount === 0) return 4;
  const lastMs = item.last_played_at ? new Date(item.last_played_at).getTime() : null;
  if (!lastMs || (Date.now() - lastMs) > NINETY_DAYS_MS) return 2;
  return 1;
}

function pickWeighted(pool) {
  if (pool.length === 0) return null;
  const bag = [];
  for (const item of pool) {
    const w = weightOf(item);
    for (let i = 0; i < w; i++) bag.push(item);
  }
  return bag[Math.floor(Math.random() * bag.length)];
}

export default function VinylRoulette({ collection, onUpdate, premium, onUpgrade, onClose }) {
  const t = useT();
  // Android hardware back closes the sheet instead of exiting the app —
  // same pattern as every other overlay in this file tree (ManualAddForm,
  // PriceModal, ConcertPicker). Verified this doesn't self-close on tap:
  // an earlier debug pass here caught a real false alarm where the
  // Browser preview pane's own history sandboxing synthesizes a
  // popstate right after pushState (reproduced identically on the
  // pre-existing ManualAddForm modal too, confirming it's an artifact
  // of that preview tool, not this hook or this component).
  useBackButton(true, onClose);

  const [genre,    setGenre]    = useState('all');
  const [spinning, setSpinning] = useState(false);
  const [picked,   setPicked]   = useState(null);
  const [flash,    setFlash]    = useState(null);   // cover cycling during spin

  // Eligible pool: owned + physically in hand (not sold, not still
  // waiting on a pre-order) — matches what "spin tonight" can actually
  // mean. Genre chip narrows further using the same realGenre() logic
  // Stats uses, so "Death Metal" here means the same thing it does there.
  const pool = useMemo(() => {
    const base = (collection || []).filter(i => !i.is_sold && !i.is_preordered);
    if (genre === 'all') return base;
    return base.filter(i => realGenre(i) === genre);
  }, [collection, genre]);

  // Top genres present in the eligible pool — same ranking approach as
  // StatsTab's genre breakdown, capped to keep the chip row one line.
  const topGenres = useMemo(() => {
    const base = (collection || []).filter(i => !i.is_sold && !i.is_preordered);
    const map = {};
    base.forEach(i => { const g = realGenre(i); map[g] = (map[g] || 0) + 1; });
    return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([g]) => g);
  }, [collection]);

  const spin = () => {
    if (pool.length === 0) return;
    setSpinning(true);
    setPicked(null);
    haptic.tap?.();
    // Quick visual shuffle — cycle a few random covers from the pool
    // before landing on the actual pick, so the moment reads as "the
    // app is choosing" rather than an instant, less satisfying swap.
    let ticks = 0;
    const maxTicks = 6;
    const interval = setInterval(() => {
      ticks++;
      setFlash(pool[Math.floor(Math.random() * pool.length)]);
      if (ticks >= maxTicks) {
        clearInterval(interval);
        const result = pickWeighted(pool);
        setPicked(result);
        setFlash(null);
        setSpinning(false);
        haptic.success?.();
        track('roulette_spin', {
          pool_size:    pool.length,
          genre_filter: genre,
          never_played: result ? weightOf(result) === 4 : null,
          dust:         result ? weightOf(result) === 2 : null,
        });
      }
    }, SPIN_MS / maxTicks);
  };

  const displayItem = spinning ? flash : picked;
  const lastPlayedLabel = picked ? relTime(picked.last_played_at, t) : null;
  const isNeverPlayed = picked && (Number(picked.play_count) || 0) === 0;

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 6000,
      background: 'rgba(0,0,0,0.9)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 16,
    }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{
        background: C.bg2, border: '1px solid ' + C.border,
        borderRadius: 16, width: '100%', maxWidth: 420,
        maxHeight: '90vh', overflow: 'auto',
        display: 'flex', flexDirection: 'column',
      }}>
        {/* Header */}
        <div style={{ padding: '18px 20px 8px', display: 'flex',
          justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ ...BEBAS, fontSize: 24, color: C.text, letterSpacing: '0.04em' }}>
              🎲 {t('vault.roulette.title') || 'Co dziś posłuchać?'}
            </div>
            <div style={{ fontSize: 11, color: C.dim, ...MONO, marginTop: 2 }}>
              {t('vault.roulette.subtitle', { n: pool.length })
                || `${pool.length} płyt w puli`}
            </div>
          </div>
          <button onClick={onClose} aria-label={t('common.close')}
            style={{ background: 'none', border: 'none', color: C.dim,
              cursor: 'pointer', fontSize: 20, padding: 6, lineHeight: 1 }}>×</button>
        </div>

        {/* Genre chips */}
        {topGenres.length > 1 && (
          <div style={{ display: 'flex', gap: 6, padding: '4px 20px 14px',
            overflowX: 'auto', touchAction: 'pan-x' }}>
            {['all', ...topGenres].map(g => {
              const active = genre === g;
              return (
                <button key={g} onClick={() => { setGenre(g); setPicked(null); }}
                  style={{
                    padding: '6px 12px', borderRadius: 20, whiteSpace: 'nowrap',
                    cursor: 'pointer', fontSize: 11, ...MONO, flexShrink: 0,
                    background: active ? C.accent + '22' : C.bg3,
                    color: active ? C.accent : C.dim,
                    border: '1px solid ' + (active ? C.accent + '66' : C.border),
                  }}>
                  {g === 'all' ? (t('vault.roulette.genreAll') || 'Wszystko') : g}
                </button>
              );
            })}
          </div>
        )}

        {/* Body */}
        <div style={{ padding: '4px 20px 20px', flex: 1 }}>
          {pool.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '30px 10px', color: C.dim, ...MONO, fontSize: 12, lineHeight: 1.6 }}>
              <div style={{ fontSize: 40, marginBottom: 10 }}>📭</div>
              {genre === 'all'
                ? (t('vault.roulette.empty') || 'Dodaj płyty do kolekcji, żeby losować.')
                : (t('vault.roulette.emptyGenre') || 'Brak płyt w tym gatunku.')}
            </div>
          ) : !displayItem ? (
            <button onClick={spin} disabled={spinning}
              style={{
                width: '100%', padding: '40px 20px',
                background: C.bg3, border: '1px dashed ' + C.border,
                borderRadius: 12, cursor: spinning ? 'wait' : 'pointer',
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10,
              }}>
              <div style={{ fontSize: 44 }}>🎲</div>
              <div style={{ ...BEBAS, fontSize: 20, color: C.accent, letterSpacing: '0.06em' }}>
                {t('vault.roulette.spinCta') || 'LOSUJ'}
              </div>
            </button>
          ) : (
            <div style={{
              background: C.bg3, border: '1px solid ' + (spinning ? C.border : C.accent + '55'),
              borderRadius: 12, padding: 18,
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12,
              transition: 'border-color 0.2s',
            }}>
              {spinning && (
                <div style={{ fontSize: 10, color: C.accent, ...MONO,
                  letterSpacing: '0.2em', textTransform: 'uppercase' }}>
                  {t('vault.roulette.spinning') || 'Losowanie…'}
                </div>
              )}
              <div style={{
                opacity: spinning ? 0.5 : 1,
                filter: spinning ? 'blur(1px)' : 'none',
                transition: 'opacity 0.1s, filter 0.1s',
              }}>
                <AlbumCover src={displayItem.cover} artist={displayItem.artist} size={140} />
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ ...BEBAS, fontSize: 22, color: C.text, letterSpacing: '0.04em', lineHeight: 1.1 }}>
                  {displayItem.artist}
                </div>
                <div style={{ fontSize: 13, color: C.muted, ...MONO, marginTop: 2 }}>
                  {displayItem.album}
                </div>
              </div>

              {!spinning && picked && (
                <>
                  {/* Why this one — builds trust in the weighting instead
                      of reading as pure randomness. */}
                  <div style={{
                    fontSize: 10, color: isNeverPlayed ? C.gold : C.dim, ...MONO,
                    background: isNeverPlayed ? '#2a1a05' : 'transparent',
                    border: isNeverPlayed ? '1px solid #f5c84255' : 'none',
                    borderRadius: 6, padding: isNeverPlayed ? '4px 10px' : 0,
                  }}>
                    {isNeverPlayed
                      ? '✨ ' + (t('vault.roulette.neverPlayed') || 'Jeszcze nie odsłuchane')
                      : lastPlayedLabel
                        ? (t('vault.roulette.lastPlayed', { when: lastPlayedLabel })
                          || 'Ostatnio: ' + lastPlayedLabel)
                        : null}
                  </div>

                  <div style={{ display: 'flex', gap: 8, width: '100%', marginTop: 4 }}>
                    <div style={{ flex: 1 }} onClick={e => e.stopPropagation()}>
                      <ListenButtonWide
                        item={picked}
                        premium={premium}
                        onUpgrade={onUpgrade}
                        onLogged={(updated) => {
                          setPicked(p => p && p.id === updated.id ? { ...p, ...updated } : p);
                          const next = (collection || []).map(c =>
                            c.id === updated.id ? { ...c, ...updated } : c);
                          onUpdate(next);
                        }}
                      />
                    </div>
                    <button onClick={spin}
                      title={t('vault.roulette.spinAgain') || 'Losuj ponownie'}
                      style={{
                        padding: '0 16px', background: 'none',
                        border: '1px solid ' + C.border, borderRadius: 10,
                        color: C.muted, cursor: 'pointer', fontSize: 20,
                      }}>
                      🎲
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── ListenButtonWide — centers the shared ListenButton pill in a
// flex:1 slot. ListenButton's default render is an intrinsically-sized
// inline pill (by design, for use inline next to other row actions),
// not a stretchable block button — reused as-is rather than forking
// the shared component just for this screen's layout.
function ListenButtonWide({ item, onLogged, premium, onUpgrade }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'center' }}>
      <ListenButton item={item} onLogged={onLogged} premium={premium} onUpgrade={onUpgrade} />
    </div>
  );
}
