'use client';
// ── ListenLogModal — detailed play logger ─────────────────────
//
// Opens on long-press of ListenButton. Lets the user log a play with:
//   • Side selector (A/B/AB/C/D for double LPs)
//   • Mood / occasion notes
//   • Custom date (backdate a play they forgot to log)
//   • Recent plays list with delete/undo
//
// Free vs Pro: today everything's free. Mood notes + backdated plays
// are gated by `premium` for future monetization — UI shows the lock
// hint but the inputs themselves stay enabled so we can flip the flag
// later without UX rework.

import { useEffect, useState } from 'react';
import { C, MONO, BEBAS } from '@/lib/theme';
import { useT } from '@/lib/i18n';
import Icon from '@/app/components/Icon';
import { toast, confirm as mvConfirm } from '@/app/components/Toast';
import { useBackButton } from '@/lib/hooks/useBackButton';

const SIDES = ['A', 'B', 'AB', 'C', 'D'];

function fmtDate(iso, locale) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString(locale || 'en', {
      day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return iso.slice(0, 16).replace('T', ' ');
  }
}

export default function ListenLogModal({ item, onClose, onLogged }) {
  const t = useT();
  useBackButton(true, onClose);

  const [side, setSide] = useState(null);
  const [notes, setNotes] = useState('');
  // Pre-fill datetime-local with current local time. Browser parses
  // datetime-local as local zone, which is what we want for "I played
  // it last Tuesday at 9pm".
  const [whenLocal, setWhenLocal] = useState(() => {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  });
  const [saving, setSaving] = useState(false);
  const [history, setHistory] = useState([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);

  // Load existing history for this item — lets user undo recent mistakes
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/listens?item_id=${encodeURIComponent(item.id)}&limit=10`)
      .then(r => r.json())
      .then(d => { if (!cancelled) { setHistory(d.logs || []); setHistoryLoaded(true); } })
      .catch(() => setHistoryLoaded(true));
    return () => { cancelled = true; };
  }, [item.id]);

  const submit = async () => {
    if (saving) return;
    setSaving(true);
    try {
      // Convert datetime-local to ISO. The input gives us "2026-05-04T20:30"
      // in local zone — `new Date()` parses that as local-zone, then ISO
      // serializes to UTC. Server validates +/-1y bounds.
      const playedAt = whenLocal ? new Date(whenLocal).toISOString() : undefined;

      const r = await fetch('/api/listens', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          collection_item_id: item.id,
          side: side || null,
          notes: notes || null,
          played_at: playedAt,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Log failed');
      if (onLogged && d.item) onLogged({ ...item, ...d.item });
      toast.success(t('listen.logged'));
      onClose();
    } catch (e) {
      toast.error(t('listen.error', { msg: e.message }));
    } finally {
      setSaving(false);
    }
  };

  const undoOne = async (logId) => {
    if (!(await mvConfirm(t('listen.confirmUndo'), { kind: 'danger', confirmLabel: t('common.delete') }))) return;
    try {
      const r = await fetch(`/api/listens?id=${encodeURIComponent(logId)}`, { method: 'DELETE' });
      if (!r.ok) throw new Error('Delete failed');
      setHistory(prev => prev.filter(l => l.id !== logId));
      // Pull authoritative counter back from /api/collection — cheaper
      // than a per-item refetch, since we only touched one row
      if (onLogged) {
        onLogged({
          ...item,
          play_count:     Math.max((item.play_count || 0) - 1, 0),
          last_played_at: history.find(l => l.id !== logId)?.played_at || null,
        });
      }
    } catch (e) {
      toast.error(t('listen.error', { msg: e.message }));
    }
  };

  return (
    <div onClick={onClose}
      style={{ position:'fixed', inset:0, zIndex:250, background:'rgba(0,0,0,0.85)',
        display:'flex', alignItems:'flex-end', justifyContent:'center' }}>
      <div onClick={e => e.stopPropagation()}
        style={{ background:C.bg, width:'100%', maxWidth:480, maxHeight:'92vh',
          borderRadius:'16px 16px 0 0', overflowY:'auto',
          border:`1px solid ${C.border}`, paddingBottom:24 }}>

        {/* Header */}
        <div style={{ padding:'14px 16px', borderBottom:`1px solid ${C.border}`,
          display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:10 }}>
          <div style={{ minWidth:0, flex:1 }}>
            <div style={{ fontSize:9, color:C.accent, ...MONO, letterSpacing:'0.18em',
              textTransform:'uppercase', marginBottom:3 }}>
              <Icon name="play" size={10} color={C.accent}/> {t('listen.modalTitle')}
            </div>
            <div style={{ ...BEBAS, fontSize:18, color:C.text, letterSpacing:'0.04em',
              overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
              {item.artist}
            </div>
            <div style={{ fontSize:11, color:C.muted, ...MONO,
              overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
              {item.album}
            </div>
          </div>
          <button onClick={onClose}
            style={{ width:32, height:32, borderRadius:'50%', border:`1px solid ${C.border}`,
              background:'rgba(0,0,0,0.4)', color:'#fff', cursor:'pointer',
              fontSize:18, lineHeight:1, padding:0, flexShrink:0 }}>
            ×
          </button>
        </div>

        {/* Form */}
        <div style={{ padding:'14px 16px' }}>
          {/* Side picker */}
          <div style={{ marginBottom:12 }}>
            <div style={{ fontSize:9, color:C.muted, ...MONO, letterSpacing:'0.1em',
              textTransform:'uppercase', marginBottom:5 }}>
              {t('listen.side')} <span style={{ color:C.dim, textTransform:'none' }}>· {t('common.optional')}</span>
            </div>
            <div style={{ display:'flex', gap:5, flexWrap:'wrap' }}>
              <button onClick={() => setSide(null)}
                style={{ padding:'5px 10px', borderRadius:6, cursor:'pointer',
                  border:'1px solid '+(side === null ? C.accent : C.border),
                  background: side === null ? C.accent + '22' : C.bg3,
                  color: side === null ? C.accent : C.dim, ...MONO, fontSize:11 }}>—</button>
              {SIDES.map(s => (
                <button key={s} onClick={() => setSide(s)}
                  style={{ padding:'5px 10px', borderRadius:6, cursor:'pointer',
                    border:'1px solid '+(side === s ? C.accent : C.border),
                    background: side === s ? C.accent + '22' : C.bg3,
                    color: side === s ? C.accent : C.dim, ...MONO, fontSize:11 }}>
                  {s}
                </button>
              ))}
            </div>
          </div>

          {/* When */}
          <div style={{ marginBottom:12 }}>
            <div style={{ fontSize:9, color:C.muted, ...MONO, letterSpacing:'0.1em',
              textTransform:'uppercase', marginBottom:5 }}>
              {t('listen.when')}
            </div>
            <input type="datetime-local"
              value={whenLocal}
              onChange={e => setWhenLocal(e.target.value)}
              style={{ width:'100%', background:C.bg3, border:`1px solid ${C.border}`,
                borderRadius:6, color:C.text, padding:'8px 10px', fontSize:13,
                ...MONO, outline:'none', boxSizing:'border-box' }}/>
          </div>

          {/* Notes */}
          <div style={{ marginBottom:14 }}>
            <div style={{ fontSize:9, color:C.muted, ...MONO, letterSpacing:'0.1em',
              textTransform:'uppercase', marginBottom:5 }}>
              {t('listen.notes')} <span style={{ color:C.dim, textTransform:'none' }}>· {t('common.optional')}</span>
            </div>
            <input type="text"
              value={notes}
              onChange={e => setNotes(e.target.value.slice(0, 500))}
              placeholder={t('listen.notesPlaceholder')}
              style={{ width:'100%', background:C.bg3, border:`1px solid ${C.border}`,
                borderRadius:6, color:C.text, padding:'8px 10px', fontSize:13,
                ...MONO, outline:'none', boxSizing:'border-box' }}/>
          </div>

          {/* Submit */}
          <button onClick={submit} disabled={saving}
            style={{ width:'100%', padding:'12px',
              background: saving ? C.bg3 : C.accent,
              border:'none', borderRadius:8,
              color:'#fff', cursor: saving ? 'wait' : 'pointer',
              ...BEBAS, fontSize:15, letterSpacing:'0.08em' }}>
            {saving ? t('common.saving') : t('listen.logPlay')}
          </button>

          {/* Recent listens */}
          <div style={{ marginTop:18 }}>
            <div style={{ fontSize:9, color:C.accent, ...MONO, letterSpacing:'0.18em',
              textTransform:'uppercase', marginBottom:6 }}>
              {t('listen.recent')}
            </div>
            {!historyLoaded ? (
              <div style={{ fontSize:11, color:C.dim, ...MONO }}>{t('common.loading')}</div>
            ) : history.length === 0 ? (
              <div style={{ fontSize:11, color:C.dim, ...MONO }}>{t('listen.noHistory')}</div>
            ) : (
              <div style={{ display:'flex', flexDirection:'column', gap:5 }}>
                {history.map(log => (
                  <div key={log.id}
                    style={{ display:'flex', alignItems:'center', gap:8, padding:'7px 9px',
                      background:C.bg2, border:`1px solid ${C.border}`, borderRadius:7 }}>
                    <Icon name="play" size={11} color={C.muted}/>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontSize:11, color:C.text, ...MONO }}>
                        {fmtDate(log.played_at)}
                        {log.side && <span style={{ color:C.accent, marginLeft:6 }}>· {log.side}</span>}
                      </div>
                      {log.notes && (
                        <div style={{ fontSize:10, color:C.dim, ...MONO, marginTop:1,
                          overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                          {log.notes}
                        </div>
                      )}
                    </div>
                    <button onClick={() => undoOne(log.id)}
                      title={t('listen.undoOne')}
                      style={{ background:'none', border:`1px solid #7f1d1d`, borderRadius:5,
                        color:'#f87171', cursor:'pointer', padding:'3px 7px', fontSize:11 }}>
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
