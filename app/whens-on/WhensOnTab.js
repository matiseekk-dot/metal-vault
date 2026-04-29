'use client';
// ── WhensOnTab — "What's coming up" tab combining Calendar + Concerts ──
// Mental model: anything happening soon. Pre-orders/releases (calendar)
// and gigs (concerts) live here as sub-tabs.
import { useState, useEffect } from 'react';
import { C, MONO } from '@/lib/theme';
import Icon from '@/app/components/Icon';
import CalendarTab from '@/app/calendar/CalendarTab';
import ConcertsTab from '@/app/concerts/ConcertsTab';
import UpcomingConcertsTab from '@/app/concerts/UpcomingConcertsTab';

const LS_KEY = 'mv_whenson_subtab';
const SUB_TABS = [
  { id: 'calendar', iconName: 'calendar', label: 'Releases' },
  { id: 'upcoming', iconName: 'music',    label: 'Live'     },
  { id: 'concerts', iconName: 'star',     label: 'My Shows' },
];

export default function WhensOnTab(props) {
  const [sub, setSub] = useState('calendar');

  useEffect(() => {
    try {
      const stored = localStorage.getItem(LS_KEY);
      if (stored && SUB_TABS.some(s => s.id === stored)) setSub(stored);
    } catch {}
  }, []);

  const switchTo = (id) => {
    setSub(id);
    try { localStorage.setItem(LS_KEY, id); } catch {}
  };

  return (
    <div>
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)',
        background: C.bg2, borderBottom: '1px solid ' + C.border,
        position: 'sticky', top: 56, zIndex: 50,
      }}>
        {SUB_TABS.map(s => {
          const active = sub === s.id;
          return (
            <button key={s.id} onClick={() => switchTo(s.id)}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                padding: '12px 4px 10px',
                display: 'flex', flexDirection: 'column',
                alignItems: 'center', gap: 4,
                borderBottom: active ? '2px solid ' + C.accent : '2px solid transparent',
              }}>
              <Icon name={s.iconName} size={16} color={active ? C.text : C.dim}/>
              <span style={{
                fontSize: 10, color: active ? C.accent : C.muted,
                ...MONO, letterSpacing: '0.08em',
                textTransform: 'uppercase', fontWeight: active ? 600 : 400,
              }}>{s.label}</span>
            </button>
          );
        })}
      </div>

      <div>
        {sub === 'calendar' && <CalendarTab releases={props.releases} followedArtists={props.followedArtists}/>}
        {sub === 'upcoming' && <UpcomingConcertsTab user={props.user} followedArtists={props.followedArtists}/>}
        {sub === 'concerts' && <ConcertsTab/>}
      </div>
    </div>
  );
}
