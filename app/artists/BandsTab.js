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

// ── Completion bar ─────────────────────────────────────────────
function CompletionBar({ have, total, isComplete }) {
  const filled = Math.round((have / Math.max(total, 1)) * 12);
  const bar    = '█'.repeat(filled) + '░'.repeat(12 - filled);
  const color  = isComplete ? C.gold : have / total >= 0.7 ? C.green : have / total >= 0.4 ? '#60a5fa' : C.muted;
  return (
    <div style={{ display:'flex', alignItems:'center', gap:8 }}>
      <span style={{ ...MONO, fontSize:12, color, letterSpacing:1 }}>{bar}</span>
      <span style={{ ...MONO, fontSize:12, color, fontWeight: isComplete ? 'bold' : 'normal' }}>
        {have}/{total}
      </span>
    </div>
  );
}

// ── Single artist discography (expanded) ──────────────────────
function ArtistDiscography({ artistName, collection, watchlist, onAddToWatchlist, onComplete }) {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);

  const load = useCallback(() => {
    setLoading(true); setError(null); setData(null);
    fetch('/api/artists/discography?artist=' + encodeURIComponent(artistName))
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(e => { setError(e.message); setLoading(false); });
  }, [artistName]);

  useEffect(() => { load(); }, [load]);

  // Notify parent when complete
  useEffect(() => {
    if (!data?.albums?.length) return;
    const normCol = collection
      .filter(i => norm(i.artist) === norm(artistName))
      .map(i => norm(i.album));
    const have = data.albums.filter(a => normCol.some(c => titleMatch(c, a.normTitle))).length;
    if (have === data.albums.length && data.albums.length > 0) onComplete(artistName);
  }, [data]);

  if (loading) return (
    <div style={{ padding:'16px', textAlign:'center', color:C.dim, ...MONO, fontSize:11 }}>
      Loading discography…
    </div>
  );

  const errMsg     = error || data?.error || '';
  const isRateLimit = errMsg.includes('429') || errMsg.includes('rate limit');

  if (errMsg || data?.notFound || !data?.albums?.length) return (
    <div style={{ padding:'12px 16px' }}>
      {data?.notFound ? (
        <div style={{ color:C.dim, ...MONO, fontSize:11 }}>⚠️ Artist not found on Discogs</div>
      ) : isRateLimit ? (
        <div>
          <div style={{ color:C.gold, ...MONO, fontSize:11, marginBottom:8 }}>
            ⏳ Discogs is busy — try again in a moment
          </div>
          <button onClick={load}
            style={{ background:'#1a1a00', border:'1px solid '+C.gold, borderRadius:6,
              color:C.gold, padding:'6px 12px', cursor:'pointer', fontSize:11, ...MONO }}>
            ↺ Retry
          </button>
        </div>
      ) : (
        <div style={{ color:C.dim, ...MONO, fontSize:11 }}>⚠️ {errMsg || 'No albums found'}</div>
      )}
    </div>
  );

  const normCollection = collection
    .filter(i => norm(i.artist) === norm(artistName))
    .map(i => norm(i.album));
  const watchlistTitles = (watchlist || [])
    .filter(i => norm(i.artist) === norm(artistName))
    .map(i => norm(i.album));

  const enriched = data.albums.map(album => ({
    ...album,
    inCollection: normCollection.some(c => titleMatch(c, album.normTitle)),
    inWatchlist:  watchlistTitles.some(w => titleMatch(w, album.normTitle)),
  }));

  const haveCount  = enriched.filter(a => a.inCollection).length;
  const isComplete = haveCount === enriched.length && enriched.length > 0;
  const missing    = enriched.filter(a => !a.inCollection);

  return (
    <div style={{ padding:'12px 16px 16px' }}>
      {/* Summary row */}
      <div style={{ marginBottom:14 }}>
        <CompletionBar have={haveCount} total={enriched.length} isComplete={isComplete}/>
        {isComplete ? (
          <div style={{ fontSize:11, color:C.gold, ...MONO, marginTop:6, display:'flex', alignItems:'center', gap:6 }}>
            🏆 Full discography collected!
          </div>
        ) : (
          <div style={{ fontSize:10, color:C.dim, ...MONO, marginTop:4 }}>
            {missing.length} album{missing.length !== 1 ? 's' : ''} missing
          </div>
        )}
      </div>

      {/* Album list */}
      <div style={{ display:'flex', flexDirection:'column', gap:5 }}>
        {enriched.map(album => {
          const statusColor = album.inCollection ? C.green : album.inWatchlist ? C.gold : C.dim;
          const statusIcon  = album.inCollection ? '✓' : album.inWatchlist ? '★' : '✗';
          return (
            <div key={album.id} style={{
              display:'flex', alignItems:'center', gap:10,
              padding:'8px 10px', borderRadius:8,
              background: album.inCollection ? '#0d1f0d' : album.inWatchlist ? '#1a1500' : C.bg3,
              border:'1px solid ' + (album.inCollection ? '#1a3d1a' : album.inWatchlist ? '#3d3000' : C.border),
            }}>
              {/* Cover */}
              <div style={{ width:36, height:36, borderRadius:4, flexShrink:0,
                background:C.bg2, overflow:'hidden', border:'1px solid '+C.border }}>
                {album.cover
                  ? <img src={album.cover} alt="" style={{ width:'100%', height:'100%', objectFit:'cover' }}/>
                  : <div style={{ width:'100%', height:'100%', display:'flex', alignItems:'center', justifyContent:'center', fontSize:16 }}>💿</div>
                }
              </div>
              {/* Title + year */}
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontSize:12, color: album.inCollection ? C.text : C.muted,
                  ...MONO, fontWeight: album.inCollection ? 'bold' : 'normal',
                  overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                  {album.title}
                </div>
                <div style={{ display:'flex', gap:5, alignItems:'center' }}>
                  <span style={{ fontSize:10, color:C.dim, ...MONO }}>{album.year}</span>
                  {album.format?.toLowerCase().includes('live') && (
                    <span style={{ fontSize:8, color:'#60a5fa', background:'#60a5fa22',
                      borderRadius:4, padding:'1px 5px', ...MONO, letterSpacing:'0.05em' }}>LIVE</span>
                  )}
                </div>
              </div>
              {/* Status + action */}
              <div style={{ display:'flex', alignItems:'center', gap:6, flexShrink:0 }}>
                <span style={{ fontSize:13, color:statusColor, ...MONO }}>{statusIcon}</span>
                {!album.inCollection && !album.inWatchlist && (
                  <button onClick={() => onAddToWatchlist(artistName, album)}
                    style={{ background:'#1a1a00', border:'1px solid '+C.gold, borderRadius:6,
                      color:C.gold, padding:'3px 8px', fontSize:10, cursor:'pointer', ...MONO,
                      whiteSpace:'nowrap' }}>
                    + Watch
                  </button>
                )}
                {album.inWatchlist && !album.inCollection && (
                  <span style={{ fontSize:9, color:C.gold, ...MONO }}>watching</span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ marginTop:10, textAlign:'right' }}>
        <a href={'https://www.discogs.com/artist/' + data.artistId}
          target="_blank" rel="noopener noreferrer"
          style={{ fontSize:9, color:C.dim, ...MONO, textDecoration:'none' }}>
          View on Discogs ↗
        </a>
      </div>
    </div>
  );
}

// ── Main BandsTab ──────────────────────────────────────────────
const LS_KEY = 'mv_complete_artists';

export default function BandsTab({ collection, watchlist, onAddToWatchlist }) {
  const [expanded,   setExpanded]   = useState(null);
  const [search,     setSearch]     = useState('');
  // Map: artistName → completion pct (loaded from localStorage)
  const [completion, setCompletion] = useState({});

  // Load saved completion from localStorage on mount
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
      setCompletion(saved);
    } catch {}
  }, []);

  // Called by ArtistDiscography when artist is 100% complete
  const handleComplete = useCallback((artistName) => {
    setCompletion(prev => {
      const next = { ...prev, [artistName]: 100 };
      try { localStorage.setItem(LS_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);

  // Group collection by artist
  const artistMap = {};
  collection.forEach(item => {
    const key = item.artist || 'Unknown';
    if (!artistMap[key]) artistMap[key] = [];
    artistMap[key].push(item);
  });

  // Sort: complete artists first (as a special category), then by record count
  let artists = Object.entries(artistMap).sort((a, b) => {
    const aComplete = completion[a[0]] === 100;
    const bComplete = completion[b[0]] === 100;
    if (aComplete !== bComplete) return aComplete ? -1 : 1;
    return b[1].length - a[1].length;
  });

  if (search.trim()) {
    const q = search.toLowerCase();
    artists = artists.filter(([name]) => name.toLowerCase().includes(q));
  }

  const completeCount = Object.values(completion).filter(v => v === 100).length;

  if (collection.length === 0) return (
    <div style={{ textAlign:'center', padding:'40px 16px', color:C.dim, ...MONO }}>
      <div style={{ fontSize:40, marginBottom:12 }}>🎸</div>
      <div style={{ fontSize:13, lineHeight:1.7 }}>Add records to your collection<br/>to track band discographies</div>
    </div>
  );

  return (
    <div style={{ padding:'12px 0 24px' }}>

      {/* Header */}
      <div style={{ padding:'0 16px 10px' }}>
        <div style={{ ...BEBAS, fontSize:20, color:C.text, letterSpacing:'0.06em' }}>
          BAND DISCOGRAPHIES
        </div>
        <div style={{ display:'flex', gap:12, alignItems:'center', marginTop:2, flexWrap:'wrap' }}>
          <span style={{ fontSize:10, color:C.dim, ...MONO }}>
            {artists.length} artists · tap to check completion
          </span>
          {completeCount > 0 && (
            <span style={{ fontSize:10, color:C.gold, ...MONO,
              background:'#2a2000', borderRadius:6, padding:'2px 8px',
              border:'1px solid #3d3000' }}>
              🏆 {completeCount} complete
            </span>
          )}
        </div>
      </div>

      {/* Search */}
      <div style={{ padding:'0 16px 10px' }}>
        <input type="text" placeholder="Search artist…" value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ width:'100%', boxSizing:'border-box',
            background:C.bg3, border:'1px solid '+C.border,
            borderRadius:8, color:C.text, padding:'8px 12px',
            fontSize:14, ...MONO, outline:'none' }}/>
      </div>

      {/* Artist list */}
      <div style={{ display:'flex', flexDirection:'column' }}>
        {artists.map(([artistName, items]) => {
          const isOpen     = expanded === artistName;
          const isComplete = completion[artistName] === 100;
          const displayName = artistName.replace(/\s*\(\d+\)$/, '');

          return (
            <div key={artistName} style={{
              borderBottom: '1px solid ' + (isComplete ? '#3d3000' : C.border),
              background: isComplete
                ? (isOpen ? '#1a1200' : 'linear-gradient(90deg,#1a120088,transparent)')
                : (isOpen ? C.bg2 : 'transparent'),
            }}>
              <button onClick={() => setExpanded(e => e === artistName ? null : artistName)}
                style={{ width:'100%', background:'none', border:'none', cursor:'pointer',
                  padding:'11px 16px', display:'flex', alignItems:'center', gap:12, textAlign:'left' }}>

                {/* Avatar */}
                <div style={{
                  width:38, height:38, borderRadius:8, flexShrink:0,
                  background: isComplete
                    ? 'linear-gradient(135deg,#3d300088,#1a120088)'
                    : 'linear-gradient(135deg,'+C.accent+'33,'+C.bg3+')',
                  border:'1px solid ' + (isComplete ? C.gold : (isOpen ? C.accent : C.border)),
                  display:'flex', alignItems:'center', justifyContent:'center',
                  ...BEBAS, fontSize:18,
                  color: isComplete ? C.gold : (isOpen ? C.accent : C.muted),
                  boxShadow: isComplete ? '0 0 12px #f5c84222' : 'none',
                }}>
                  {isComplete ? '🏆' : displayName[0]?.toUpperCase() || '?'}
                </div>

                {/* Name + info */}
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                    <div style={{ ...BEBAS, fontSize:16,
                      color: isComplete ? C.gold : (isOpen ? C.text : C.muted),
                      letterSpacing:'0.04em', lineHeight:1.2,
                      overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                      {displayName}
                    </div>
                    {isComplete && (
                      <span style={{ fontSize:9, color:C.gold, background:'#2a2000',
                        border:'1px solid #3d3000', borderRadius:4,
                        padding:'1px 6px', ...MONO, letterSpacing:'0.08em',
                        flexShrink:0 }}>
                        COMPLETE
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize:10, color:isComplete ? '#a08020' : C.dim, ...MONO, marginTop:1 }}>
                    {items.length} record{items.length !== 1 ? 's' : ''} in vault
                  </div>
                </div>

                {/* Chevron */}
                <div style={{ fontSize:12, color: isComplete ? C.gold : C.dim,
                  transition:'transform 0.2s', transform: isOpen ? 'rotate(90deg)' : 'none',
                  flexShrink:0 }}>
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
                  onComplete={handleComplete}
                />
              )}
            </div>
          );
        })}
      </div>

      {artists.length === 0 && search && (
        <div style={{ textAlign:'center', padding:'24px', color:C.dim, ...MONO, fontSize:12 }}>
          No artists matching "{search}"
        </div>
      )}
    </div>
  );
}
