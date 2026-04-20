'use client';
import { useState, useEffect, useCallback } from 'react';
import { C, MONO, BEBAS } from '@/lib/theme';


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
function ArtistDiscography({ artistName, collection, watchlist, onAddToWatchlist, onComplete, isFollowed, onToggleFollow }) {
  const LS_WANTED = 'mv_wanted_v1';
  const [wanted,    setWanted]    = useState(() => {
    try { return JSON.parse(localStorage.getItem(LS_WANTED) || '{}'); } catch { return {}; }
  });
  const [vinylOnly, setVinylOnly] = useState(true);

  const wantKey = (title) => (artistName + '::' + title).toLowerCase();
  const isWanted = (title) => wanted[wantKey(title)] === true;
  const toggleWanted = (album) => {
    const k = wantKey(album.title);
    setWanted(prev => {
      const next = { ...prev };
      if (next[k]) { delete next[k]; } else { next[k] = true; }
      try {
        localStorage.setItem(LS_WANTED, JSON.stringify(next));
        // Notify BandsTab to re-check completion for all artists
        window.dispatchEvent(new CustomEvent('mv-wanted-changed'));
      } catch {}
      return next;
    });
  };
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);

  const load = useCallback(() => {
    setLoading(true); setError(null); setData(null);
    const url = '/api/artists/discography?artist=' + encodeURIComponent(artistName) + (vinylOnly ? '&vinyl=1' : '');
    fetch(url)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(e => { setError(e.message); setLoading(false); });
  }, [artistName, vinylOnly]);

  useEffect(() => { load(); }, [load]);

  // Notify parent complete/incomplete — treats ♥ wanted as target if user marked any
  useEffect(() => {
    if (!data?.albums?.length) return;
    const normCol = collection
      .filter(i => norm(i.artist) === norm(artistName))
      .map(i => norm(i.album));
    const wantedInDiscog = data.albums.filter(a => isWanted(a.title));
    const hasAnyWanted = wantedInDiscog.length > 0;
    const targetList = hasAnyWanted
      ? data.albums.filter(a => isWanted(a.title) || normCol.some(c => titleMatch(c, a.normTitle)))
      : data.albums;
    const have = targetList.filter(a => normCol.some(c => titleMatch(c, a.normTitle))).length;
    const done = have === targetList.length && targetList.length > 0;
    onComplete(artistName, done ? 100 : 0);
  }, [data, wanted, collection]);

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
    wanted:       isWanted(album.title),
  }));

  const wantedAlbums = enriched.filter(a => isWanted(a.title) || a.inCollection || a.inWatchlist);
  const hasAnyWanted = wantedAlbums.length > 0;
  // If user has marked any ♥ wants, use those for completion. Otherwise use full discography.
  const targetAlbums = hasAnyWanted ? wantedAlbums : enriched;
  const haveCount    = targetAlbums.filter(a => a.inCollection).length;
  const isComplete   = haveCount === targetAlbums.length && targetAlbums.length > 0;
  const missing      = targetAlbums.filter(a => !a.inCollection);

  return (
    <div style={{ padding:'12px 16px 16px' }}>
      {/* Summary row */}
      <div style={{ marginBottom:14 }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:6 }}>
          <div style={{ fontSize:10, color:C.dim, ...MONO }}>
            {enriched.length} release{enriched.length !== 1 ? 's' : ''}
          </div>
          <button onClick={() => setVinylOnly(v => !v)}
            style={{ background: vinylOnly ? C.accent+'22' : C.bg3,
              border:'1px solid '+(vinylOnly ? C.accent+'66' : C.border),
              borderRadius:20, color: vinylOnly ? C.accent : C.dim,
              padding:'3px 10px', cursor:'pointer', fontSize:10, ...MONO }}>
            💿 Vinyl only {vinylOnly ? '✓' : ''}
          </button>
        </div>
        <CompletionBar have={haveCount} total={targetAlbums.length} isComplete={isComplete}/>
        {isComplete ? (
          <div style={{ fontSize:11, color:C.gold, ...MONO, marginTop:6, display:'flex', alignItems:'center', gap:6 }}>
            🏆 {hasAnyWanted ? 'All wanted albums collected!' : 'Full discography collected!'}
          </div>
        ) : (
          <div style={{ fontSize:10, color:C.dim, ...MONO, marginTop:4 }}>
            {missing.length} album{missing.length !== 1 ? 's' : ''} missing
            {hasAnyWanted && <span style={{ color:C.accent, marginLeft:4 }}>· wanted only</span>}
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
              background: album.inCollection ? '#0d1f0d' : album.inWatchlist ? '#1a1500' : album.wanted ? '#1a0a0a' : C.bg3,
              border:'1px solid ' + (album.inCollection ? '#1a3d1a' : album.inWatchlist ? '#3d3000' : album.wanted ? '#7f1d1d' : C.border),
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
              {/* Want ♥ + status */}
              <div style={{ display:'flex', alignItems:'center', gap:4, flexShrink:0 }}>
                {/* ♥ Want toggle — marks album as personally wanted */}
                {!album.inCollection && (
                  <button onClick={() => toggleWanted(album)}
                    title={album.wanted ? 'Remove from wanted' : 'Mark as wanted'}
                    style={{ background:'none', border:'none', cursor:'pointer',
                      fontSize:17, padding:'4px 6px', lineHeight:1,
                      color: album.wanted ? '#f87171' : '#333' }}>
                    {album.wanted ? '♥' : '♡'}
                  </button>
                )}
                <span style={{ fontSize:13, color:statusColor, ...MONO }}>{statusIcon}</span>
                {!album.inCollection && !album.inWatchlist && album.wanted && (
                  <button onClick={() => onAddToWatchlist(artistName, album)}
                    style={{ background:'#1a0a0a', border:'1px solid #7f1d1d', borderRadius:6,
                      color:'#f87171', padding:'3px 8px', fontSize:10, cursor:'pointer', ...MONO,
                      whiteSpace:'nowrap' }}>
                    + Watch
                  </button>
                )}
                {!album.inCollection && !album.inWatchlist && !album.wanted && (
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

export default function BandsTab({ collection, watchlist, onAddToWatchlist, followedArtists = [], onToggleFollow, onBatchFollow }) {
  const [followingAll, setFollowingAll] = useState(false);
  const [manageMode,   setManageMode]   = useState(false);
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

  // Called by ArtistDiscography with 100 (complete) or 0 (incomplete)
  const handleComplete = useCallback((artistName, pct = 100) => {
    setCompletion(prev => {
      const next = { ...prev };
      if (pct >= 100) next[artistName] = 100;
      else delete next[artistName];
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

  // Auto-mark artists as complete when all ♥ wanted albums are in collection
  // Runs on mount, on collection change, and whenever ♥ toggle fires custom event
  const checkWantedCompletion = useCallback(() => {
    try {
      const wanted = JSON.parse(localStorage.getItem('mv_wanted_v1') || '{}');
      const wantedKeys = Object.keys(wanted);

      setCompletion(prev => {
        const next = { ...prev };
        let changed = false;

        for (const artistName of Object.keys(artistMap)) {
          const keyPrefix = artistName.toLowerCase() + '::';
          const artistWanted = wantedKeys.filter(k => k.startsWith(keyPrefix));
          if (artistWanted.length === 0) {
            // If artist previously marked via ♥ but no ♥ now → reset from cache
            // (but keep if it was marked via full discography check)
            continue;
          }

          const wantedTitles = artistWanted.map(k => k.replace(keyPrefix, ''));
          const ownedTitles = artistMap[artistName].map(i => (i.album || '').toLowerCase());
          const hasAll = wantedTitles.every(wt =>
            ownedTitles.some(ot => ot.includes(wt) || wt.includes(ot))
          );

          if (hasAll && next[artistName] !== 100) {
            next[artistName] = 100;
            changed = true;
          } else if (!hasAll && next[artistName] === 100) {
            delete next[artistName];
            changed = true;
          }
        }

        if (changed) {
          try { localStorage.setItem(LS_KEY, JSON.stringify(next)); } catch {}
          return next;
        }
        return prev;
      });
    } catch {}
  }, [artistMap]);

  useEffect(() => {
    checkWantedCompletion();
    const handler = () => checkWantedCompletion();
    window.addEventListener('mv-wanted-changed', handler);
    return () => window.removeEventListener('mv-wanted-changed', handler);
  }, [checkWantedCompletion]);

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
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
          <div style={{ ...BEBAS, fontSize:20, color:C.text, letterSpacing:'0.06em' }}>
            BAND DISCOGRAPHIES
          </div>
          {onToggleFollow && (() => {
            const allNames     = Object.keys(artistMap);
            const notFollowed  = allNames.filter(n => !followedArtists.some(a => a.artist_name === n));
            const anyFollowed  = allNames.some(n => followedArtists.some(a => a.artist_name === n));
            return (
              <div style={{ display:'flex', gap:6 }}>
                {notFollowed.length > 0 && (
                  <button
                    onClick={async () => {
                      setFollowingAll(true);
                      try {
                        const r = await fetch('/api/artists/follow-all', { method: 'POST' });
                        const d = await r.json();
                        if (d.artists?.length && onBatchFollow) onBatchFollow(d.artists);
                      } catch {}
                      setFollowingAll(false);
                    }}
                    disabled={followingAll}
                    style={{ background:C.accent+'22', border:'1px solid '+C.accent+'66',
                      borderRadius:8, color:C.accent, padding:'6px 10px', cursor:'pointer',
                      ...MONO, fontSize:10, whiteSpace:'nowrap', opacity:followingAll?0.6:1 }}>
                    {followingAll ? '⏳…' : `🔔 All (${notFollowed.length})`}
                  </button>
                )}
                {anyFollowed && (
                  <button
                    onClick={() => setManageMode(m => !m)}
                    style={{ background: manageMode ? '#1a0000' : C.bg3,
                      border:'1px solid '+(manageMode ? C.accent : C.border),
                      borderRadius:8, color: manageMode ? C.accent : C.dim,
                      padding:'6px 10px', cursor:'pointer', ...MONO, fontSize:10, whiteSpace:'nowrap' }}>
                    {manageMode ? '✕ Done' : '✏ Manage'}
                  </button>
                )}
              </div>
            );
          })()}
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

      {/* Manage following — shown when manageMode active */}
      {manageMode && onToggleFollow && (() => {
        const followedInCollection = followedArtists.filter(a =>
          Object.keys(artistMap).some(n => n === a.artist_name)
        );
        const followedOther = followedArtists.filter(a =>
          !Object.keys(artistMap).some(n => n === a.artist_name)
        );
        return (
          <div style={{ margin:'0 16px 10px', background:C.bg2, border:'1px solid '+C.border, borderRadius:10, padding:'10px 12px' }}>
            <div style={{ fontSize:9, color:C.accent, ...MONO, letterSpacing:'0.15em', textTransform:'uppercase', marginBottom:8 }}>
              Following ({followedArtists.length}) — tap to unfollow
            </div>
            <div style={{ display:'flex', flexWrap:'wrap', gap:6 }}>
              {[...followedInCollection, ...followedOther].map(a => (
                <button key={a.artist_name}
                  onClick={() => onToggleFollow(a.artist_name)}
                  style={{ background:'#1a0000', border:'1px solid '+C.accent+'44',
                    borderRadius:20, color:C.accent, padding:'5px 10px',
                    cursor:'pointer', fontSize:11, ...MONO,
                    display:'flex', alignItems:'center', gap:5 }}>
                  🔔 {a.artist_name}
                  <span style={{ fontSize:13, color:'#f87171', lineHeight:1 }}>×</span>
                </button>
              ))}
              {followedArtists.length === 0 && (
                <div style={{ fontSize:11, color:C.dim, ...MONO }}>No followed artists yet</div>
              )}
            </div>
            {followedArtists.length > 1 && (
              <button
                onClick={async () => {
                  if (!confirm('Unfollow all artists?')) return;
                  for (const a of followedArtists) await onToggleFollow(a.artist_name);
                  setManageMode(false);
                }}
                style={{ marginTop:10, background:'none', border:'1px solid #7f1d1d',
                  borderRadius:6, color:'#f87171', padding:'5px 12px',
                  cursor:'pointer', ...MONO, fontSize:10 }}>
                Unfollow all
              </button>
            )}
          </div>
        );
      })()}

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

                {/* Follow button */}
                {onToggleFollow && (
                  <button
                    onClick={e => { e.stopPropagation(); onToggleFollow(artistName); }}
                    title={followedArtists.some(a => a.artist_name === artistName) ? 'Unfollow' : 'Follow — get notified of new releases'}
                    style={{ background: 'none', border: 'none', cursor: 'pointer',
                      fontSize: 18, padding: '8px 6px', flexShrink: 0, lineHeight: 1,
                      color: followedArtists.some(a => a.artist_name === artistName) ? C.accent : C.ultra }}>
                    {followedArtists.some(a => a.artist_name === artistName) ? '🔔' : '🔕'}
                  </button>
                )}
                {/* Chevron */}
                <div style={{ fontSize:12, color: isComplete ? C.gold : C.dim,
                  transition:'transform 0.2s', transform: isOpen ? 'rotate(90deg)' : 'none',
                  flexShrink:0, padding:'8px 4px' }}>
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
                  isFollowed={followedArtists.some(a => a.artist_name === artistName)}
                  onToggleFollow={onToggleFollow ? () => onToggleFollow(artistName) : null}
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
