'use client';
// ── ConcertPicker — pick a concert to link a Vault item to ──
//
// Used by CollectionTab's expanded-card "Kupiłem na koncercie" button.
// Lazy-loads the user's concert journal on mount (cached for the
// session via state) and presents it grouped by year with a search
// filter. Single-select; clicking a row fires onPick(concertId) and
// closes.

import { useState, useEffect } from 'react';
import { C, MONO, BEBAS } from '@/lib/theme';
import { useBackButton } from '@/lib/hooks/useBackButton';
import { useT } from '@/lib/i18n';

export default function ConcertPicker({ currentId, onPick, onClose }) {
  useBackButton(true, onClose);
  const t = useT();
  const [concerts, setConcerts] = useState(null);  // null=loading, []=empty, [...]=data
  const [venues,   setVenues]   = useState([]);
  const [search,   setSearch]   = useState('');

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch('/api/user-concerts');
        if (!alive) return;
        if (!r.ok) { setConcerts([]); return; }
        const j = await r.json();
        setConcerts(j.concerts || []);
        setVenues(j.venues || []);
      } catch { if (alive) setConcerts([]); }
    })();
    return () => { alive = false; };
  }, []);

  const venueById = new Map((venues || []).map(v => [v.client_id || v.id, v]));

  // Group by year (DESC), bucketed for visual scan. Same shape the
  // main concerts list uses so the modal feels familiar.
  const filtered = (concerts || []).filter(c => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    const v = venueById.get(c.venue_id);
    return (c.band || '').toLowerCase().includes(q)
        || (v?.name || '').toLowerCase().includes(q)
        || (c.year || '').toString().includes(q);
  });

  const byYear = new Map();
  for (const c of filtered) {
    const y = String(c.year || '——');
    if (!byYear.has(y)) byYear.set(y, []);
    byYear.get(y).push(c);
  }
  const years = [...byYear.keys()].sort((a, b) => {
    const na = Number(a) || -Infinity, nb = Number(b) || -Infinity;
    return nb - na;
  });

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'rgba(0,0,0,0.92)', backdropFilter: 'blur(8px)',
      display: 'flex', flexDirection: 'column',
    }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{
        maxWidth: 600, margin: '0 auto', width: '100%',
        height: '100%', display: 'flex', flexDirection: 'column',
        background: C.bg, borderLeft: '1px solid ' + C.border,
        borderRight: '1px solid ' + C.border,
      }}>
        {/* Header */}
        <div style={{
          padding: '14px 16px', borderBottom: '1px solid ' + C.border,
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <div style={{ flex: 1 }}>
            <div style={{ ...BEBAS, fontSize: 18, color: C.text, letterSpacing: '0.05em' }}>
              {t('collection.boughtPickerTitle') || 'Wybierz koncert'}
            </div>
            <div style={{ fontSize: 10, color: C.dim, ...MONO, marginTop: 2 }}>
              {t('collection.boughtPickerHint') || 'Stuknij koncert na którym kupiłeś tę płytę'}
            </div>
          </div>
          <button onClick={onClose} aria-label="Close"
            style={{ background: 'none', border: '1px solid ' + C.border,
              borderRadius: 6, color: C.dim, padding: '6px 10px',
              cursor: 'pointer', fontSize: 14 }}>✕</button>
        </div>

        {/* Search + "Clear link" */}
        <div style={{ padding: '10px 16px', display: 'flex', gap: 6,
          borderBottom: '1px solid ' + C.border, flexShrink: 0 }}>
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder={t('collection.boughtPickerSearch') || 'Szukaj zespołu / miejsca / roku…'}
            style={{ flex: 1, background: C.bg3, border: '1px solid ' + C.border,
              borderRadius: 6, color: C.text, padding: '8px 10px',
              fontSize: 13, ...MONO, outline: 'none' }} />
          {currentId && (
            <button onClick={() => { onPick(null); }}
              title={t('collection.boughtPickerClear') || 'Usuń powiązanie'}
              style={{ background: '#1a0d0d', border: '1px solid #d5100744',
                borderRadius: 6, color: '#f87171', padding: '6px 10px',
                cursor: 'pointer', ...MONO, fontSize: 11, whiteSpace: 'nowrap' }}>
              ✕ {t('common.unlink') || 'Odepnij'}
            </button>
          )}
        </div>

        {/* List */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 12,
          WebkitOverflowScrolling: 'touch' }}>
          {concerts === null && (
            <div style={{ textAlign: 'center', padding: '40px 0',
              ...MONO, color: C.dim, fontSize: 11 }}>
              {t('common.loading') || 'Wczytywanie…'}
            </div>
          )}
          {concerts && concerts.length === 0 && (
            <div style={{ textAlign: 'center', padding: '40px 0',
              ...MONO, color: C.dim, fontSize: 11 }}>
              {t('collection.boughtPickerEmpty')
                || 'Brak koncertów w dzienniku — dodaj jakiś najpierw w zakładce Koncerty'}
            </div>
          )}
          {concerts && concerts.length > 0 && years.length === 0 && (
            <div style={{ textAlign: 'center', padding: '40px 0',
              ...MONO, color: C.dim, fontSize: 11 }}>
              {t('common.noResults') || 'Brak dopasowań'}
            </div>
          )}
          {years.map(y => (
            <div key={y} style={{ marginBottom: 14 }}>
              <div style={{ ...MONO, fontSize: 10, color: '#7c8aa6',
                letterSpacing: '0.22em', textTransform: 'uppercase',
                padding: '6px 4px', borderBottom: '1px solid ' + C.border,
                marginBottom: 6 }}>
                {y === '——' ? (t('concerts.yearUnknown') || 'BEZ DATY') : y}
                <span style={{ marginLeft: 8, opacity: 0.6 }}>
                  · {byYear.get(y).length}
                </span>
              </div>
              {byYear.get(y).map(c => {
                const v = venueById.get(c.venue_id);
                const isCurrent = c.id === currentId || c.client_id === currentId;
                const cid = c.client_id || c.id;
                return (
                  <button key={cid}
                    onClick={() => onPick(cid)}
                    style={{
                      width: '100%', textAlign: 'left',
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '10px 12px', marginBottom: 4,
                      background: isCurrent ? '#1a3d1a' : C.bg2,
                      border: '1px solid ' + (isCurrent ? '#4ade8066' : C.border),
                      borderLeft: '3px solid ' + (isCurrent ? '#4ade80' : (v?.cat === 'Festival' ? '#f5c842' : '#888')),
                      borderRadius: 6, color: C.text,
                      cursor: 'pointer', minHeight: 50,
                    }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ ...BEBAS, fontSize: 15, lineHeight: 1.1,
                        color: isCurrent ? '#4ade80' : C.text,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {v?.cat === 'Festival' ? '🎪 ' : ''}{c.band}
                      </div>
                      <div style={{ fontSize: 10, color: C.dim, ...MONO, marginTop: 2,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {v ? v.name : '?'}{v?.city ? ' · ' + v.city : ''}
                        {c.planned_date ? ' · ' + c.planned_date : (c.year ? ' · ' + c.year : '')}
                      </div>
                    </div>
                    {isCurrent && <span style={{ color: '#4ade80', fontSize: 16 }}>✓</span>}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
