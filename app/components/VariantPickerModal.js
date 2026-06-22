'use client';
// ── VariantPickerModal — assign a specific Discogs release to a
//    collection row ────────────────────────────────────────────────
//
// Different from VariantTracker (which is a read-only "what variants
// exist + which do I own" view). This one is an INPUT — the user picks
// the exact press they own (colour, country, year, label) and the
// caller PATCHes collection.discogs_id to that release ID.
//
// Why this matters: Discogs marketplace stats live PER RELEASE ID, not
// per master. A 1985 EU black vinyl and a 2020 red 500-copy reissue are
// separate releases. Generic 'release_id' captured at add-time often
// points to one of those variants randomly, so the price the user
// sees in Vault is for the wrong press. Reassigning lets us refresh
// median/lowest from the right marketplace and the gain ▲/▼ becomes
// meaningful.
//
// Usage:
//   <VariantPickerModal
//     album={collectionItem}
//     currentDiscogsId={item.discogs_id}
//     onClose={() => setOpen(false)}
//     onPick={async (variant) => {
//       await fetch('/api/collection?id=' + item.id, {
//         method: 'PATCH',
//         body: JSON.stringify({ discogs_id: variant.id }),
//       });
//     }}
//   />

import { useEffect, useState } from 'react';
import { C, MONO, BEBAS } from '@/lib/theme';
import { useT } from '@/lib/i18n';
import { useCurrency, useFx, formatPrice } from '@/lib/currency';
import { useBackButton } from '@/lib/hooks/useBackButton';

const RARITY_COLOR = {
  'Holy grail': '#f5c842',
  'Rare':       '#dc2626',
  'Uncommon':   '#f97316',
  'Common':     '#888',
  'Mainline':   '#444',
};

export default function VariantPickerModal({
  album, currentDiscogsId, onClose, onPick,
}) {
  const t = useT();
  const cur = useCurrency();
  const fx  = useFx();
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const [picking, setPicking] = useState(null);   // variant id mid-save
  useBackButton(true, onClose);

  // Fetch variants — same endpoint as the read-only tracker. Master id
  // is preferred (skips one Discogs round-trip); falls back to the
  // current release id which Discogs resolves to master internally.
  useEffect(() => {
    if (!album) return;
    let cancelled = false;
    setLoading(true); setError(null); setData(null);
    (async () => {
      try {
        const releaseId = album.discogs_id || album.id;
        const masterId  = album.master_id;
        if (!releaseId && !masterId) {
          setError('no_discogs');
          if (!cancelled) setLoading(false);
          return;
        }
        const param = masterId
          ? 'master_id=' + masterId
          : 'release_id=' + releaseId;
        const r = await fetch('/api/variants?' + param);
        const d = await r.json();
        if (cancelled) return;
        if (!r.ok) {
          setError(d.error || 'Variants unavailable');
        } else {
          setData(d);
        }
      } catch (e) {
        if (!cancelled) setError(e.message);
      }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [album?.id, album?.discogs_id, album?.master_id]);

  const handlePick = async (v) => {
    if (picking) return;
    setPicking(v.id);
    try {
      await onPick(v);
      onClose();
    } catch {
      setPicking(null);
    }
  };

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 5000,
      background: 'rgba(0,0,0,0.7)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 16,
    }}>
      <div onClick={e => e.stopPropagation()}
        role="dialog" aria-modal="true"
        style={{
          background: C.bg2, border: '1px solid ' + C.border,
          borderRadius: 14, width: '100%', maxWidth: 540,
          maxHeight: '85vh', display: 'flex', flexDirection: 'column',
        }}>
        {/* Header */}
        <div style={{
          padding: '14px 16px', borderBottom: '1px solid ' + C.border,
          display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ ...BEBAS, fontSize: 16, color: C.text,
              letterSpacing: '0.04em', lineHeight: 1.1 }}>
              {t('variants.picker.title') || 'Wybierz swój wariant'}
            </div>
            <div style={{ fontSize: 11, color: C.muted, ...MONO, marginTop: 4 }}>
              {album?.artist} — {album?.album}
            </div>
            <div style={{ fontSize: 10, color: C.dim, ...MONO, marginTop: 4, lineHeight: 1.4 }}>
              {t('variants.picker.hint') || 'Wybór konkretnego pressu = celna wycena (różne kolory / kraje / lata mają różne ceny rynkowe).'}
            </div>
          </div>
          <button onClick={onClose}
            aria-label={t('common.close') || 'Zamknij'}
            style={{
              background: 'none', border: 'none', color: C.dim,
              cursor: 'pointer', fontSize: 20, padding: '0 4px', lineHeight: 1,
              flexShrink: 0, marginLeft: 8,
            }}>×</button>
        </div>

        {/* Body */}
        <div style={{ overflow: 'auto', padding: '12px 16px 16px' }}>
          {loading && (
            <div style={{ textAlign: 'center', padding: '30px 0', color: C.dim, ...MONO, fontSize: 11 }}>
              ⟳ {t('variants.loading') || 'Ładowanie wariantów…'}
            </div>
          )}
          {!loading && error === 'no_discogs' && (
            <div style={{ textAlign: 'center', padding: '20px 0', color: C.muted, ...MONO, fontSize: 11, lineHeight: 1.6 }}>
              {t('variants.picker.noDiscogs')
                || 'Ta płyta nie ma powiązania z Discogs (dodana ręcznie). Aby wybrać wariant, najpierw zaktualizuj wpis o ID Discogs.'}
            </div>
          )}
          {!loading && error && error !== 'no_discogs' && (
            <div style={{ color: '#f87171', ...MONO, fontSize: 11, padding: '12px 0' }}>
              ⚠ {error}
            </div>
          )}
          {!loading && data?.variants && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {data.variants.map(v => {
                const isCurrent = String(v.id) === String(currentDiscogsId);
                const rarityColor = RARITY_COLOR[v.rarityLabel] || C.dim;
                const isPickingThis = String(picking) === String(v.id);
                return (
                  <button key={v.id}
                    onClick={() => !isCurrent && handlePick(v)}
                    disabled={isCurrent || !!picking}
                    style={{
                      textAlign: 'left',
                      background: isCurrent ? '#0a1a0a' : C.bg3,
                      border: '1px solid ' + (isCurrent ? '#4ade80' : C.border),
                      borderRadius: 8, padding: '10px 12px',
                      cursor: isCurrent ? 'default' : (picking ? 'wait' : 'pointer'),
                      opacity: (picking && !isPickingThis) ? 0.5 : 1,
                      display: 'flex', gap: 10, alignItems: 'flex-start',
                    }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontSize: 12, color: isCurrent ? '#86efac' : C.text, ...MONO,
                        fontWeight: 600, lineHeight: 1.3, marginBottom: 3,
                      }}>
                        {isCurrent && '✓ '}
                        {v.format || t('variants.unknownFormat') || 'Nieznany format'}
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
                    <div style={{ textAlign: 'right', flexShrink: 0, minWidth: 60 }}>
                      {v.lowestPrice && (
                        <div style={{ fontSize: 11, color: '#4ade80', ...MONO, marginBottom: 2 }}>
                          ~{formatPrice(v.lowestPrice, cur, fx)}
                        </div>
                      )}
                      {isCurrent && (
                        <div style={{ fontSize: 9, color: '#4ade80', ...MONO }}>
                          {t('variants.picker.current') || 'aktualny'}
                        </div>
                      )}
                      {isPickingThis && (
                        <div style={{ fontSize: 9, color: C.accent, ...MONO }}>
                          ⟳ {t('common.saving') || 'zapis…'}
                        </div>
                      )}
                    </div>
                  </button>
                );
              })}
              {data.variants.length === 0 && (
                <div style={{ textAlign: 'center', padding: '20px 0', color: C.muted, ...MONO, fontSize: 11 }}>
                  {t('variants.picker.none') || 'Brak dostępnych wariantów.'}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
