'use client';
// ── VariantTracker — "what variants of this album exist + what
//    you own" — the killer metal-collector feature ────────────────
//
// Renders inside VinylModal below the regular variants list. Pulls
// from /api/variants?master_id (or resolves from release_id if the
// caller doesn't have master). Shows:
//   • Top: progress bar "3 / 23 owned"
//   • Per variant: label, format, year, country, color/numbered,
//     rarity badge, lowest price, owned-checkbox, "Add to wishlist"
//
// Performance: list is virtualised via a simple "show first 12 +
// 'show all' toggle" rather than react-window — most albums have
// 5-30 variants, virtualising is overkill.
//
// Telemetry: tracks 'variants_viewed' on mount and 'variant_action'
// when user adds a missing variant to wishlist (the "discovery"
// outcome we care about).

import { useEffect, useState } from 'react';
import { C, MONO, BEBAS } from '@/lib/theme';
import { useT } from '@/lib/i18n';
import { useCurrency, useFx, formatPrice } from '@/lib/currency';
import { toast } from '@/app/components/Toast';
import { haptic } from '@/lib/haptics';
import { track } from '@/lib/analytics';

const RARITY_COLOR = {
  'Holy grail': '#f5c842',
  'Rare':       '#dc2626',
  'Uncommon':   '#f97316',
  'Common':     '#888',
  'Mainline':   '#444',
};

export default function VariantTracker({ album, onWatchToggle, isWatched }) {
  const t = useT();
  const cur = useCurrency();
  const fx  = useFx();

  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    if (!album) return;
    let cancelled = false;
    setLoading(true); setError(null); setData(null); setShowAll(false);
    (async () => {
      try {
        // Resolve the Discogs reference. Two callsites:
        //   1. Feed → album.id IS the Discogs release id (numeric).
        //   2. Collection → album.id is a Supabase UUID (string).
        //      The Discogs reference lives on album.discogs_id.
        // Master_id is also acceptable (skips one Discogs roundtrip)
        // and the cron sets it on collection rows.
        const discogsRelease =
          (album.discogs_id && /^\d+$/.test(String(album.discogs_id))) ? album.discogs_id
          : (/^\d+$/.test(String(album.id)) ? album.id : null);
        const masterId = album.master_id && /^\d+$/.test(String(album.master_id)) ? album.master_id : null;

        if (!discogsRelease && !masterId) {
          // Manually-added record without a Discogs link — no master to query.
          setError('no_discogs');
          if (!cancelled) setLoading(false);
          return;
        }
        const param = masterId
          ? 'master_id=' + masterId
          : 'release_id=' + discogsRelease;
        const r = await fetch('/api/variants?' + param);
        const d = await r.json();
        if (cancelled) return;
        if (!r.ok) {
          setError(d.error || 'Variants unavailable');
        } else {
          setData(d);
          track('variants_viewed', {
            master_id: d.master_id,
            total:     d.total,
            owned:     d.owned_count,
          });
        }
      } catch (e) {
        if (!cancelled) setError(e.message);
      }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [album?.id, album?.discogs_id, album?.master_id]);

  if (loading) {
    return (
      <div style={{ padding: '14px 16px', textAlign: 'center', color: C.dim, ...MONO, fontSize: 11 }}>
        ⟳ {t('variants.loading') || 'Loading variants…'}
      </div>
    );
  }
  if (error || !data || !data.total) return null;

  const visible = showAll ? data.variants : data.variants.slice(0, 12);
  const ownedPct = Math.round((data.owned_count / data.total) * 100);

  const onWishlistVariant = (v) => {
    track('variant_action', { action: 'wishlist', release_id: v.id });
    haptic.tap();
    onWatchToggle?.({
      id:         v.id,
      album_id:   String(v.id),
      artist:     album.artist,
      album:      album.album,
      cover:      v.thumb || album.cover,
      format:     v.format,
      releaseDate: v.released,
    });
    toast.success(t('variants.toast.wishlisted') || 'Added to watchlist ✓');
  };

  return (
    <div style={{ padding: '14px 16px 4px' }}>
      <div style={{ fontSize: 10, color: C.accent, ...MONO,
        letterSpacing: '0.2em', textTransform: 'uppercase', marginBottom: 10 }}>
        {t('variants.heading') || 'All variants of this album'}
      </div>

      {/* Progress strip */}
      <div style={{
        background: C.bg3, border: '1px solid ' + C.border,
        borderRadius: 10, padding: '10px 12px', marginBottom: 12,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
          <div style={{ ...BEBAS, fontSize: 18, color: C.text, letterSpacing: '0.04em' }}>
            {data.owned_count} / {data.total} {t('variants.owned') || 'owned'}
          </div>
          <div style={{ fontSize: 10, color: C.muted, ...MONO }}>
            {ownedPct}%
          </div>
        </div>
        <div style={{ height: 6, background: C.bg, borderRadius: 3, overflow: 'hidden' }}>
          <div style={{
            height: '100%',
            width: ownedPct + '%',
            background: ownedPct === 100
              ? 'linear-gradient(90deg,#f5c842,#dc2626)'
              : C.accent,
            transition: 'width 0.4s',
          }}/>
        </div>
      </div>

      {/* Variants list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {visible.map(v => {
          const rarityColor = RARITY_COLOR[v.rarityLabel] || C.dim;
          const watched = isWatched?.(v.id);
          return (
            <div key={v.id} style={{
              background: v.owned ? '#0a1a0a' : C.bg2,
              border: '1px solid ' + (v.owned ? '#1a3d1a' : C.border),
              borderRadius: 8, padding: '8px 10px',
              display: 'flex', gap: 10, alignItems: 'flex-start',
            }}>
              {/* Owned dot — flush left for fast scanning */}
              <div style={{
                width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
                background: v.owned ? '#4ade80' : 'transparent',
                border: v.owned ? 'none' : '1px solid ' + C.dim,
                marginTop: 6,
              }}/>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: 11, color: v.owned ? '#86efac' : C.text, ...MONO,
                  fontWeight: 600, lineHeight: 1.3, marginBottom: 2,
                  overflow: 'hidden',
                }}>
                  {v.format || (t('variants.unknownFormat') || 'Unknown format')}
                  {v.isLimited && <span style={{ color: '#f5c842', marginLeft: 4 }}>· LTD</span>}
                  {v.isRepress && <span style={{ color: '#60a5fa', marginLeft: 4 }}>· REPRESS</span>}
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                  {v.released && <span style={{ fontSize: 9, color: C.dim, ...MONO }}>{String(v.released).slice(0, 4)}</span>}
                  {v.country  && <span style={{ fontSize: 9, color: C.dim, ...MONO }}>· {v.country}</span>}
                  {v.label    && <span style={{ fontSize: 9, color: C.dim, ...MONO }}>· {v.label}</span>}
                  {v.rarityLabel && (
                    <span style={{
                      fontSize: 8, color: rarityColor, ...MONO,
                      background: rarityColor + '22',
                      padding: '1px 5px', borderRadius: 3,
                      border: '1px solid ' + rarityColor + '44',
                      letterSpacing: '0.05em',
                    }}>{v.rarityLabel.toUpperCase()}</span>
                  )}
                </div>
              </div>
              {/* Right side — price + action */}
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                {v.lowestPrice && (
                  <div style={{ fontSize: 11, color: '#4ade80', ...MONO, marginBottom: 4 }}>
                    {formatPrice(v.lowestPrice, cur, fx)}
                  </div>
                )}
                {v.owned ? (
                  <a href={v.discogsUrl} target="_blank" rel="noopener noreferrer"
                    onClick={e => e.stopPropagation()}
                    style={{ fontSize: 9, color: C.dim, ...MONO, textDecoration: 'none' }}>
                    Discogs ↗
                  </a>
                ) : (
                  <button onClick={() => onWishlistVariant(v)}
                    style={{
                      background: 'transparent', border: '1px solid ' + (watched ? '#f5c842' : C.border),
                      borderRadius: 6, color: watched ? '#f5c842' : C.dim,
                      padding: '4px 8px', cursor: 'pointer',
                      fontSize: 10, ...MONO,
                      minHeight: 28,
                    }}>
                    {watched ? '★' : '☆'}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {data.total > 12 && !showAll && (
        <button onClick={() => setShowAll(true)}
          style={{
            width: '100%', padding: '8px', marginTop: 8,
            background: 'none', border: '1px solid ' + C.border,
            borderRadius: 8, color: C.dim,
            cursor: 'pointer', fontSize: 11, ...MONO,
          }}>
          {t('variants.showAll', { n: data.total - 12 }) || ('Show ' + (data.total - 12) + ' more variants')}
        </button>
      )}
    </div>
  );
}
