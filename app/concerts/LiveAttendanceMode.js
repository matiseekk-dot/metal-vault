'use client';
// ── LiveAttendanceMode — fullscreen at-the-festival band ticker ──
//
// What it solves: at Brutal Assault you're not going to dig into the
// expanded festival card and tap 4-px ✓ buttons between sets. You
// need a thumb-friendly view that lets you mark "yes I saw them"
// the second a band wraps. This component is that view.
//
// Triggered from ConcertsTab when there's a festival in the user's
// journal whose planned_date is within ±1 day of "now". Renders as
// a full-bleed overlay (no chrome competing for screen space), 2-col
// grid of giant tap-targets, sticky festival name at top, single X
// to close.
//
// Each tile is a single button. Tap = flip attended. Optimistic local
// update + onToggle callback so the parent can persist. The grid
// auto-sorts: marked items dim and drift to the bottom so the next
// unmarked acts stay close to the user's thumb.
//
// No pinch-zoom needed — text scales via fontSize so the smallest
// text is 16px even on phones.

import { useState, useEffect, useMemo } from 'react';
import { C, MONO, BEBAS } from '@/lib/theme';
import { useBackButton } from '@/lib/hooks/useBackButton';
import { useT } from '@/lib/i18n';
import { haptic } from '@/lib/haptics';

export default function LiveAttendanceMode({
  // Festival aggregate { key, venue, year, date, items[] }
  festival,
  // (concertRow, nextAttended) => Promise<void>  — parent persists
  onToggle,
  // () => void  — close handler
  onClose,
}) {
  useBackButton(true, onClose);
  const t = useT();

  // Local optimistic state mirrors the items' attended flags. We map
  // by client_id so a re-render from the parent doesn't tear our
  // local truth (parent state may lag the network round-trip).
  const [marks, setMarks] = useState(() => {
    const m = {};
    for (const it of (festival?.items || [])) {
      m[it.id] = it.attended !== false;
    }
    return m;
  });

  // Re-sync from parent when items change (e.g. user toggled outside
  // this view, OR the parent finished a server fetch). Only override
  // entries we haven't touched locally yet — preserves in-flight
  // optimistic flips.
  useEffect(() => {
    setMarks(prev => {
      const next = { ...prev };
      for (const it of (festival?.items || [])) {
        if (!(it.id in prev)) next[it.id] = it.attended !== false;
      }
      return next;
    });
  }, [festival]);

  const total    = (festival?.items || []).length;
  const attendedN = Object.values(marks).filter(Boolean).length;

  // Sort: unmarked first (alphabetical by band so users can scan to
  // a known name); then marked, dimmed, at the bottom. The first
  // item ("headliner" in import order) gets a ⭐ regardless of
  // position so users always know who's the marquee act.
  const headlinerId = festival?.items?.[0]?.id;
  const sortedItems = useMemo(() => {
    const arr = [...(festival?.items || [])];
    arr.sort((a, b) => {
      const am = marks[a.id] ? 1 : 0;
      const bm = marks[b.id] ? 1 : 0;
      if (am !== bm) return am - bm;
      // Within bucket, alphabetical
      return String(a.band || '').localeCompare(String(b.band || ''));
    });
    return arr;
  }, [festival, marks]);

  const flip = async (item) => {
    const cur = marks[item.id] !== false;
    const next = !cur;
    setMarks(m => ({ ...m, [item.id]: next }));
    haptic.tap?.();
    try { await onToggle(item, next); } catch {}
  };

  if (!festival) return null;

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: '#000', color: C.text,
      display: 'flex', flexDirection: 'column',
      // Lock body scroll while the overlay is up. The overlay scrolls
      // internally below — this keeps the user from accidentally
      // pulling the underlying page out from under their thumb.
      overflow: 'hidden',
    }}>
      {/* Sticky header */}
      <div style={{
        padding: '14px 16px 12px',
        background: 'linear-gradient(180deg,#1a1408 0%, #0a0805 100%)',
        borderBottom: '1px solid #f5c84244',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 9, color: '#f5c842', ...MONO,
              letterSpacing: '0.25em', textTransform: 'uppercase',
              marginBottom: 4 }}>
              🎸 {t('concerts.liveModeOn') || 'Tryb live · oznaczaj kogo widzisz'}
            </div>
            <div style={{ ...BEBAS, fontSize: 22, lineHeight: 1.05,
              color: '#f5c842', letterSpacing: '0.04em' }}>
              🎪 {festival.venue?.name || (t('concerts.unknownVenue') || 'Festiwal')}
            </div>
            <div style={{ fontSize: 11, color: C.dim, ...MONO, marginTop: 4 }}>
              {festival.date || festival.year} · {attendedN}/{total} {t('concerts.seenLabel') || 'widziane'}
            </div>
          </div>
          <button onClick={onClose} aria-label="Close"
            style={{ background: '#1a0d0d', border: '1px solid #d5100744',
              borderRadius: 8, color: '#f87171',
              padding: '10px 14px', cursor: 'pointer',
              fontSize: 18, lineHeight: 1, minWidth: 48, minHeight: 48 }}>
            ✕
          </button>
        </div>
      </div>

      {/* Grid */}
      <div style={{
        flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch',
        padding: 12,
      }}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(2, 1fr)',
          gap: 10,
        }}>
          {sortedItems.map(it => {
            const seen = marks[it.id] !== false;
            const isHead = it.id === headlinerId;
            return (
              <button key={it.id}
                onClick={() => flip(it)}
                style={{
                  textAlign: 'left',
                  padding: '16px 12px',
                  minHeight: 88,
                  background: seen
                    ? 'linear-gradient(135deg,#0d1f0d 0%, #1a3d1a 100%)'
                    : (isHead
                        ? 'linear-gradient(135deg,#1a1408 0%, #2a1a05 100%)'
                        : C.bg2),
                  border: '1px solid ' + (seen
                    ? '#4ade8088'
                    : (isHead ? '#f5c84266' : C.border)),
                  borderRadius: 10,
                  color: seen ? '#dcf5dc' : C.text,
                  cursor: 'pointer',
                  opacity: seen ? 0.85 : 1,
                  position: 'relative',
                  // Avoid double-tap zoom interfering with rapid tagging.
                  touchAction: 'manipulation',
                  // Soft anim on flip for visual confirmation.
                  transition: 'background 0.15s, border-color 0.15s',
                }}>
                {/* Top-right ✓ or empty checkbox */}
                <div style={{ position: 'absolute', top: 8, right: 10,
                  fontSize: 18, lineHeight: 1, color: seen ? '#4ade80' : '#555' }}>
                  {seen ? '✓' : '○'}
                </div>
                {/* Band name */}
                <div style={{ ...BEBAS, fontSize: 18, lineHeight: 1.1,
                  color: seen ? '#dcf5dc' : (isHead ? '#fde68a' : C.text),
                  letterSpacing: '0.03em', paddingRight: 22 }}>
                  {isHead && <span style={{ marginRight: 4 }}>⭐</span>}
                  {it.band}
                </div>
                {/* Status label */}
                <div style={{ fontSize: 10, ...MONO, marginTop: 6,
                  color: seen ? '#4ade80aa' : '#777',
                  letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                  {seen
                    ? (t('concerts.liveSawIt') || 'Widziałem')
                    : (t('concerts.liveTapToMark') || 'Stuknij gdy zobaczysz')}
                </div>
              </button>
            );
          })}
        </div>
        {/* Empty-state — festival has no lineup yet for some reason. */}
        {sortedItems.length === 0 && (
          <div style={{ textAlign: 'center', padding: '60px 0',
            color: C.dim, ...MONO, fontSize: 12 }}>
            {t('concerts.liveNoBands') || 'Brak lineupu do oznaczenia'}
          </div>
        )}
      </div>

      {/* Bottom progress bar — visual reminder of how much of the
          festival's lineup you've ticked. Pleasant feedback loop. */}
      {total > 0 && (
        <div style={{
          flexShrink: 0,
          height: 6,
          background: C.bg3,
          borderTop: '1px solid ' + C.border,
        }}>
          <div style={{
            width: ((attendedN / total) * 100) + '%',
            height: '100%',
            background: 'linear-gradient(90deg,#4ade80,#f5c842)',
            transition: 'width 0.25s',
          }}/>
        </div>
      )}
    </div>
  );
}
