'use client';
import { useState, useEffect, useCallback } from 'react';

const C = {
  bg:'#0a0a0a', bg2:'#141414', bg3:'#1e1e1e',
  border:'#2a2a2a', accent:'#dc2626',
  text:'#f0f0f0', muted:'#888', dim:'#555',
  green:'#4ade80', red:'#f87171', gold:'#f5c842',
};
const MONO  = { fontFamily:"'Space Mono',monospace" };
const BEBAS = { fontFamily:"'Bebas Neue',sans-serif" };

// ── Normalize for matching ────────────────────────────────────
function norm(str) {
  return String(str || '')
    .toLowerCase()
    .replace(/\s*\(\d+\)$/, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function titleMatch(a, b) {
  const na = norm(a), nb = norm(b);
  return na === nb || na.includes(nb) || nb.includes(na);
}

// ── Completion bar ────────────────────────────────────────────
function CompletionBar({ have, total, size = 'normal' }) {
  const pct = total > 0 ? Math.round((have / total) * 100) : 0;
  const color = pct === 100 ? C.gold : pct >= 70 ? C.green : pct >= 40 ? '#60a5fa' : C.muted;
  const filled = Math.round((have / Math.max(total, 1)) * 12);
  const bar = '█'.repeat(filled) + '░'.repeat(12 - filled);

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ ...MONO, fontSize: size === 'large' ? 13 : 10, color, letterSpacing: 1 }}>
        {bar}
      </span>
      <span style={{ ...MONO, fontSize: size === 'large' ? 13 : 10, color }}>
        {have}/{total}
      </span>
      {pct === 100 && (
        <span style={{ fontSize: 12 }} title="Complete!">🏆</span>
      )}
    </div>
  );
}

// ── Single artist discography row (expanded) ──────────────────
function ArtistDiscography({ artistName, collection, onAddToWatchlist, watchlist }) {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);

  useEffect(() => {
    setLoading(true);
    fetch('/api/artists/discography?artist=' + encodeURIComponent(artistName))
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(e => { setError(e.message); setLoading(false); });
  }, [artistName]);

  if (loading) return (
    <div style={{ padding: '16px', textAlign: 'center', color: C.dim, ...MONO, fontSize: 11 }}>
      Loading discography…
    </div>
  );

  if (error || data?.error || !data?.albums?.length) return (
    <div style={{ padding: '12px 16px', color: C.dim, ...MONO, fontSize: 11 }}>
      {data?.notFound ? '⚠️ Artist not found on Discogs' : '⚠️ ' + (error || data?.error || 'No albums found')}
    </div>
  );

  // Cross-reference with user collection
  const normCollection = collection
    .filter(item => norm(item.artist) === norm(artistName))
    .map(item => norm(item.album));

  const watchlistTitles = (watchlist || [])
    .filter(item => norm(item.artist) === norm(artistName))
    .map(item => norm(item.album));

  const enriched = data.albums.map(album => {
    const inCollection = normCollection.some(c => titleMatch(c, album.normTitle));
    const inWatchlist  = watchlistTitles.some(w => titleMatch(w, album.normTitle));
    return { ...album, inCollection, inWatchlist };
  });

  const haveCount = enriched.filter(a => a.inCollection).length;
  const missing   = enriched.filter(a => !a.inCollection);

  return (
    <div style={{ padding: '12px 16px 16px' }}>
      {/* Summary */}
      <div style={{ marginBottom: 14 }}>
        <CompletionBar have={haveCount} total={enriched.length} size="large" />
        {missing.length > 0 && (
          <div style={{ fontSize: 10, color: C.dim, ...MONO, marginTop: 4 }}>
            {missing.length} album{missing.length !== 1 ? 's' : ''} missing
          </div>
        )}
      </div>

      {/* Album list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {enriched.map(album => {
          const statusColor = album.inCollection ? C.green : album.inWatchlist ? C.gold : C.red;
          const statusIcon  = album.inCollection ? '✓' : album.inWatchlist ? '★' : '✗';

          return (
            <div key={album.id} style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '8px 10px', borderRadius: 8,
              background: album.inCollection ? '#0d1f0d' : album.inWatchlist ? '#1a1500' : C.bg3,
              border: '1px solid ' + (album.inCollection ? '#1a3d1a' : album.inWatchlist ? '#3d3000' : C.border),
              opacity: album.inCollection ? 1 : 0.85,
            }}>
              {/* Cover thumbnail */}
              <div style={{
                width: 36, height: 36, borderRadius: 4, flexShrink: 0,
                background: C.bg2, overflow: 'hidden',
                border: '1px solid ' + C.border,
              }}>
                {album.cover
                  ? <img src={album.cover} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>💿</div>
                }
              </div>

              {/* Title + year */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: 12, color: album.inCollection ? C.text : C.muted,
                  ...MONO, fontWeight: album.inCollection ? 'bold' : 'normal',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {album.title}
                </div>
                <div style={{ fontSize: 10, color: C.dim, ...MONO }}>{album.year}</div>
              </div>

              {/* Status */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                <span style={{ fontSize: 13, color: statusColor, ...MONO }}>{statusIcon}</span>

                {!album.inCollection && !album.inWatchlist && (
                  <button
                    onClick={() => onAddToWatchlist(artistName, album)}
                    style={{
                      background: '#1a1a00', border: '1px solid ' + C.gold,
                      borderRadius: 6, color: C.gold, padding: '3px 8px',
                      fontSize: 10, cursor: 'pointer', ...MONO,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    + Watch
                  </button>
                )}

                {album.inWatchlist && !album.inCollection && (
                  <span style={{ fontSize: 9, color: C.gold, ...MONO }}>watching</span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Discogs link */}
      <div style={{ marginTop: 10, textAlign: 'right' }}>
        <a
          href={'https://www.discogs.com/artist/' + data.artistId}
          target="_blank" rel="noopener noreferrer"
          style={{ fontSize: 9, color: C.dim, ...MONO, textDecoration: 'none' }}
        >
          View on Discogs ↗
        </a>
      </div>
    </div>
  );
}

// ── Main BandsTab ─────────────────────────────────────────────
export default function BandsTab({ collection, watchlist, onAddToWatchlist }) {
  const [expanded, setExpanded] = useState(null);
  const [search,   setSearch]   = useState('');

  // Group collection by artist
  const artistMap = {};
  collection.forEach(item => {
    const key = item.artist || 'Unknown';
    if (!artistMap[key]) artistMap[key] = [];
    artistMap[key].push(item);
  });

  // Sort: most records first
  let artists = Object.entries(artistMap)
    .sort((a, b) => b[1].length - a[1].length);

  // Filter by search
  if (search.trim()) {
    const q = search.toLowerCase();
    artists = artists.filter(([name]) => name.toLowerCase().includes(q));
  }

  const toggle = useCallback((name) => {
    setExpanded(e => e === name ? null : name);
  }, []);

  if (collection.length === 0) return (
    <div style={{ textAlign: 'center', padding: '40px 16px', color: C.dim, ...MONO }}>
      <div style={{ fontSize: 40, marginBottom: 12 }}>🎸</div>
      <div style={{ fontSize: 13, lineHeight: 1.7 }}>Add records to your collection<br />to track band discographies</div>
    </div>
  );

  return (
    <div style={{ padding: '12px 0 24px' }}>

      {/* Header */}
      <div style={{ padding: '0 16px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ ...BEBAS, fontSize: 18, color: C.text, letterSpacing: '0.06em' }}>
            BAND DISCOGRAPHIES
          </div>
          <div style={{ fontSize: 10, color: C.dim, ...MONO, marginTop: 2 }}>
            {artists.length} artists · tap to check completion
          </div>
        </div>
      </div>

      {/* Search */}
      <div style={{ padding: '0 16px 12px' }}>
        <input
          type="text"
          placeholder="Search artist…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{
            width: '100%', boxSizing: 'border-box',
            background: C.bg3, border: '1px solid ' + C.border,
            borderRadius: 8, color: C.text, padding: '8px 12px',
            fontSize: 14, ...MONO, outline: 'none',
          }}
        />
      </div>

      {/* Artist list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
        {artists.map(([artistName, items]) => {
          const isOpen = expanded === artistName;

          return (
            <div key={artistName} style={{
              borderBottom: '1px solid ' + C.border,
              background: isOpen ? C.bg2 : 'transparent',
            }}>
              {/* Artist row */}
              <button
                onClick={() => toggle(artistName)}
                style={{
                  width: '100%', background: 'none', border: 'none',
                  cursor: 'pointer', padding: '12px 16px',
                  display: 'flex', alignItems: 'center', gap: 12,
                  textAlign: 'left',
                }}
              >
                {/* Artist avatar / initial */}
                <div style={{
                  width: 38, height: 38, borderRadius: 8, flexShrink: 0,
                  background: 'linear-gradient(135deg,' + C.accent + '33,' + C.bg3 + ')',
                  border: '1px solid ' + (isOpen ? C.accent : C.border),
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  ...BEBAS, fontSize: 18, color: isOpen ? C.accent : C.muted,
                }}>
                  {artistName[0]?.toUpperCase() || '?'}
                </div>

                {/* Name + records count */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    ...BEBAS, fontSize: 16, color: isOpen ? C.text : C.muted,
                    letterSpacing: '0.04em', lineHeight: 1.2,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {artistName}
                  </div>
                  <div style={{ fontSize: 10, color: C.dim, ...MONO, marginTop: 2 }}>
                    {items.length} record{items.length !== 1 ? 's' : ''} in vault
                  </div>
                </div>

                {/* Expand chevron */}
                <div style={{
                  fontSize: 14, color: C.dim, transition: 'transform 0.2s',
                  transform: isOpen ? 'rotate(90deg)' : 'none',
                  flexShrink: 0,
                }}>
                  ▶
                </div>
              </button>

              {/* Expanded discography */}
              {isOpen && (
                <ArtistDiscography
                  artistName={artistName}
                  collection={collection}
                  watchlist={watchlist}
                  onAddToWatchlist={onAddToWatchlist}
                />
              )}
            </div>
          );
        })}
      </div>

      {artists.length === 0 && search && (
        <div style={{ textAlign: 'center', padding: '24px', color: C.dim, ...MONO, fontSize: 12 }}>
          No artists matching "{search}"
        </div>
      )}
    </div>
  );
}
