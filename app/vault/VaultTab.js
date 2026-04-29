'use client';
// ── VaultTab — sub-tab wrapper for Collection / Watchlist / Bands / Stats ──
import { useState, useEffect } from 'react';
import { C, MONO, BEBAS } from '@/lib/theme';
import { useT } from '@/lib/i18n';
import Icon from '@/app/components/Icon';
import { CollectionTab } from '@/app/collection/CollectionTab';
import { WatchlistTab } from '@/app/collection/CollectionTab';
import BandsTab from '@/app/artists/BandsTab';
import StatsTab from '@/app/stats/StatsTab';

const LS_KEY = 'mv_vault_subtab';
const SUB_TABS = [
  { id: 'collection', iconName: 'pkg',      label: 'Vault' },
  { id: 'watchlist',  iconName: 'heart',    label: 'Wantlist' },
  { id: 'bands',      iconName: 'music',    label: 'Bands' },
  { id: 'stats',      iconName: 'barChart', label: 'Stats' },
];

export default function VaultTab(props) {
  const t = useT();
  const [sub, setSub] = useState('collection');

  useEffect(() => {
    try {
      const stored = localStorage.getItem(LS_KEY);
      if (stored && SUB_TABS.some(s => s.id === stored)) setSub(stored);
    } catch {}
  }, []);

  useEffect(() => {
    const handler = e => {
      const target = e.detail?.subtab;
      if (target && SUB_TABS.some(s => s.id === target)) {
        setSub(target);
        try { localStorage.setItem(LS_KEY, target); } catch {}
      }
    };
    window.addEventListener('mv:vault-subtab', handler);
    return () => window.removeEventListener('mv:vault-subtab', handler);
  }, []);

  const switchTo = (id) => {
    setSub(id);
    try { localStorage.setItem(LS_KEY, id); } catch {}
  };

  const wlCount = (props.watchlist || []).length;

  return (
    <div>
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)',
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
                position: 'relative',
              }}>
              <Icon name={s.iconName} size={16} color={active ? C.text : C.dim}/>
              <span style={{
                fontSize: 10, color: active ? C.accent : C.muted,
                ...MONO, letterSpacing: '0.08em',
                textTransform: 'uppercase', fontWeight: active ? 600 : 400,
              }}>{s.label}</span>
              {s.id === 'watchlist' && wlCount > 0 && (
                <span style={{
                  position: 'absolute', top: 6, right: '50%', marginRight: -22,
                  background: C.accent, color: '#fff',
                  fontSize: 9, ...MONO, fontWeight: 700,
                  borderRadius: 10, padding: '1px 5px', minWidth: 16, textAlign: 'center',
                }}>{wlCount}</span>
              )}
            </button>
          );
        })}
      </div>

      <div>
        {sub === 'collection' && <CollectionTab {...props}/>}
        {sub === 'watchlist' && (
          <WatchlistTab
            user={props.user} watchlist={props.watchlist}
            onRemove={props.onRemoveWatch} onAlbumClick={props.onAlbumClick}
            AlbumCover={props.AlbumCover}
            premium={props.premium} onUpgrade={props.onUpgrade}
          />
        )}
        {sub === 'bands' && (
          <BandsTab
            user={props.user} collection={props.collection}
            watchlist={props.watchlist} followedArtists={props.followedArtists}
            onToggleFollow={props.onToggleFollow}
            onAddToWatchlist={props.onAddToWatchlist}
            onAlbumClick={props.onAlbumClick} AlbumCover={props.AlbumCover}
            premium={props.premium} onUpgrade={props.onUpgrade}
          />
        )}
        {sub === 'stats' && (
          <StatsTab
            collection={props.collection} watchlist={props.watchlist}
            collectionSummary={props.collectionSummary}
          />
        )}
      </div>
    </div>
  );
}
