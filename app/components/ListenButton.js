'use client';
// ── ListenButton — 1-tap "I just played this" logger ──────────
//
// Renders inline on a collection card. Single tap = log a play with
// minimal payload (just the item id). Long-press = open a modal for
// side A/B selection, mood notes, or backdated entries.
//
// State updates (play_count + last_played_at) come back from the
// API and are pushed to the parent via onLogged so the card can
// re-render its counter chip without a full collection refetch.
//
// Free users: unlimited 1-tap logs (the whole feature is free for
// engagement). Pro will get the side/mood/backdate modal — gating
// happens inside ListenLogModal.

import { useState, useRef } from 'react';
import { C, MONO, BEBAS } from '@/lib/theme';
import { useT } from '@/lib/i18n';
import Icon from '@/app/components/Icon';
import { toast } from '@/app/components/Toast';
import ListenLogModal from '@/app/components/ListenLogModal';

// Format "12h ago", "3d ago", "5mo ago" — kept tiny, no library
function relativeTime(iso, t) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 60)        return t('listen.justPlayed.minutesAgo', { n: Math.max(m, 1) });
  const h = Math.floor(m / 60);
  if (h < 24)        return t('listen.justPlayed.hoursAgo', { n: h });
  const d = Math.floor(h / 24);
  if (d < 30)        return t('listen.justPlayed.daysAgo', { n: d });
  const mo = Math.floor(d / 30);
  if (mo < 12)       return t('listen.justPlayed.monthsAgo', { n: mo });
  const y = Math.floor(d / 365);
  return t('listen.justPlayed.yearsAgo', { n: y });
}

export default function ListenButton({ item, onLogged, premium, onUpgrade, compact = false }) {
  const t = useT();
  const [busy, setBusy]       = useState(false);
  const [modalOpen, setModal] = useState(false);
  const [lastJust, setLastJust] = useState(false); // brief "✓ logged" feedback
  const longPressTimer = useRef(null);
  const longPressFired = useRef(false);

  const playCount = item.play_count || 0;
  const lastPlayed = item.last_played_at;

  // ── Quick log (single tap) ──────────────────────────────────
  // Sends just collection_item_id. Server stamps played_at = now().
  // Optimistic UI: bump count immediately, revert on error.
  const quickLog = async () => {
    if (busy) return;
    setBusy(true);
    setLastJust(true);
    setTimeout(() => setLastJust(false), 1800);

    // Optimistic patch — parent re-renders the chip immediately
    if (onLogged) {
      onLogged({
        ...item,
        play_count:     playCount + 1,
        last_played_at: new Date().toISOString(),
      });
    }

    try {
      const r = await fetch('/api/listens', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ collection_item_id: item.id }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Log failed');
      // Use the server's authoritative counters (handles edge case where
      // the optimistic count drifts from real)
      if (onLogged && d.item) {
        onLogged({ ...item, ...d.item });
      }
    } catch (e) {
      toast.error(t('listen.error', { msg: e.message }));
      // Revert optimistic update
      if (onLogged) onLogged(item);
    } finally {
      setBusy(false);
    }
  };

  // ── Long-press handlers ─────────────────────────────────────
  // Touch / mouse: 500ms hold opens the detailed log modal. We use a
  // ref to track whether the long-press fired so the click handler
  // can skip the quick log when it does.
  const onPressStart = () => {
    longPressFired.current = false;
    longPressTimer.current = setTimeout(() => {
      longPressFired.current = true;
      // Give haptic feedback on Android TWA where supported
      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        try { navigator.vibrate(15); } catch {}
      }
      setModal(true);
    }, 500);
  };
  const onPressEnd = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };
  const onClick = (e) => {
    e.stopPropagation();
    if (longPressFired.current) {
      // Prevent quick-log when long press just fired
      longPressFired.current = false;
      return;
    }
    quickLog();
  };

  // Compact mode: minimal icon button for the right-rail action column
  // alongside Follow/Delete. Shows count as a tiny badge on top-right
  // when > 0. No relative-time string — that lives in the chip area.
  if (compact) {
    return (
      <>
        <button
          onClick={onClick}
          onMouseDown={onPressStart}
          onMouseUp={onPressEnd}
          onMouseLeave={onPressEnd}
          onTouchStart={onPressStart}
          onTouchEnd={onPressEnd}
          onTouchCancel={onPressEnd}
          disabled={busy}
          title={t('listen.tooltipQuick')}
          style={{
            position:'relative',
            background:'none', border:'none', cursor: busy ? 'wait' : 'pointer',
            fontSize:16, color: lastJust ? '#4ade80' : (playCount > 0 ? C.accent : C.ultra),
            padding:'8px 10px', lineHeight:1, minWidth:40, textAlign:'center',
            WebkitTapHighlightColor:'transparent',
            userSelect:'none', WebkitUserSelect:'none',
          }}
        >
          <Icon name="play" size={15} color="currentColor"/>
          {playCount > 0 && !lastJust && (
            <span style={{
              position:'absolute', top:2, right:2,
              minWidth:14, height:14, padding:'0 4px',
              borderRadius:7, background:C.accent, color:'#fff',
              fontSize:9, ...MONO, fontWeight:600,
              display:'flex', alignItems:'center', justifyContent:'center',
              lineHeight:1,
            }}>{playCount > 99 ? '99' : playCount}</span>
          )}
          {lastJust && (
            <span style={{
              position:'absolute', top:2, right:2,
              minWidth:14, height:14, padding:'0 4px',
              borderRadius:7, background:'#166534', color:'#fff',
              fontSize:9, lineHeight:1,
              display:'flex', alignItems:'center', justifyContent:'center',
            }}>✓</span>
          )}
        </button>

        {modalOpen && (
          <ListenLogModal
            item={item}
            onClose={() => setModal(false)}
            onLogged={onLogged}
            premium={premium}
            onUpgrade={onUpgrade}
          />
        )}
      </>
    );
  }

  return (
    <>
      <button
        onClick={onClick}
        onMouseDown={onPressStart}
        onMouseUp={onPressEnd}
        onMouseLeave={onPressEnd}
        onTouchStart={onPressStart}
        onTouchEnd={onPressEnd}
        onTouchCancel={onPressEnd}
        disabled={busy}
        title={lastJust ? t('listen.logged') : t('listen.tooltipQuick')}
        style={{
          display:'inline-flex', alignItems:'center', gap:5,
          background: lastJust ? '#0d2a0d' : (playCount > 0 ? C.bg3 : 'transparent'),
          border: '1px solid ' + (lastJust ? '#166534' : (playCount > 0 ? C.border : C.dim + '66')),
          borderRadius: 6,
          color: lastJust ? '#4ade80' : (playCount > 0 ? C.text : C.dim),
          padding: '5px 9px',
          cursor: busy ? 'wait' : 'pointer',
          fontSize: 11, ...MONO,
          transition: 'all 200ms',
          // Tap-highlight off — long-press flicker on iOS otherwise
          WebkitTapHighlightColor: 'transparent',
          userSelect: 'none', WebkitUserSelect: 'none',
        }}
      >
        <Icon name="play" size={11} color="currentColor"/>
        {lastJust ? (
          <span style={{ ...BEBAS, fontSize:13, letterSpacing:'0.05em' }}>
            {t('listen.logged').toUpperCase()}
          </span>
        ) : playCount > 0 ? (
          <span>
            <span style={{ ...BEBAS, fontSize:13, letterSpacing:'0.05em' }}>{playCount}×</span>
            {lastPlayed && (
              <span style={{ marginLeft:5, fontSize:9, color:C.dim }}>
                · {relativeTime(lastPlayed, t)}
              </span>
            )}
          </span>
        ) : (
          <span>{t('listen.play')}</span>
        )}
      </button>

      {modalOpen && (
        <ListenLogModal
          item={item}
          onClose={() => setModal(false)}
          onLogged={onLogged}
          premium={premium}
          onUpgrade={onUpgrade}
        />
      )}
    </>
  );
}
