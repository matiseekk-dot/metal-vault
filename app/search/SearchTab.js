'use client';
import { useState, useRef, useCallback } from 'react';
import { C, MONO, BEBAS, inputSt } from '@/lib/theme';


const inputSt = {
  width:'100%', background:C.bg3, border:`1px solid ${C.border}`,
  borderRadius:8, color:C.text, padding:'12px 14px', fontSize:16,
  ...MONO, outline:'none', boxSizing:'border-box',
};

function AlbumCover({ src, artist, size = 56 }) {
  const [err, setErr] = useState(false);
  if (!src || err) return (
    <div style={{ width:size, height:size, borderRadius:6, flexShrink:0,
      background:'linear-gradient(135deg,#1a0000,#0a0a0a)',
      display:'flex', alignItems:'center', justifyContent:'center',
      border:`1px solid ${C.border}` }}>
      <span style={{ ...BEBAS, fontSize:Math.round(size*0.45), color:'#ffffff33' }}>
        {(artist||'?')[0].toUpperCase()}
      </span>
    </div>
  );
  return (
    <div style={{ width:size, height:size, borderRadius:6, flexShrink:0,
      overflow:'hidden', border:`1px solid ${C.border}` }}>
      <img src={src} alt={artist} loading="lazy" onError={()=>setErr(true)}
        style={{ width:'100%', height:'100%', objectFit:'cover' }} />
    </div>
  );
}

function ResultCard({ item, onWatch, onAddCollection, isWatched, inCollection }) {
  const [expanded, setExpanded] = useState(false);
  const [vinylData, setVinylData] = useState(null);
  const [vinylLoading, setVinylLoading] = useState(false);

  const loadVinyl = async () => {
    if (vinylData || vinylLoading) { setExpanded(e=>!e); return; }
    setExpanded(true);
    setVinylLoading(true);
    try {
      const params = new URLSearchParams({ artist: item.artist, album: item.album });
      const r = await fetch(`/api/discogs?${params}`);
      const d = await r.json();
      setVinylData(d);
    } catch {}
    setVinylLoading(false);
  };

  return (
    <div style={{ background:C.bg2, border:`1px solid ${C.border}`, borderRadius:12, overflow:'hidden' }}>
      {/* Main row */}
      <div style={{ display:'flex', gap:12, padding:'12px 14px', alignItems:'flex-start' }}>
        <AlbumCover src={item.cover} artist={item.artist} size={56} />
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ ...BEBAS, fontSize:18, color:C.text, lineHeight:1,
            overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
            {item.artist}
          </div>
          <div style={{ fontSize:12, color:C.muted, ...MONO, marginTop:2,
            overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
            {item.album}
          </div>
          <div style={{ display:'flex', gap:8, marginTop:5, flexWrap:'wrap', alignItems:'center' }}>
            {item.year && <span style={{ fontSize:10, color:C.dim, ...MONO }}>{item.year}</span>}
            {item.source === 'spotify' && (
              <span style={{ fontSize:9, padding:'1px 6px', borderRadius:10,
                background:'#0d2a0d', color:'#1db954', border:'1px solid #166534', ...MONO }}>
                Spotify
              </span>
            )}
            {item.source === 'discogs' && (
              <span style={{ fontSize:9, padding:'1px 6px', borderRadius:10,
                background:'#1a1a2e', color:'#60a5fa', border:'1px solid #1e3a8a', ...MONO }}>
                Discogs
              </span>
            )}
          </div>
        </div>
        {/* Action buttons */}
        <div style={{ display:'flex', flexDirection:'column', gap:4, flexShrink:0 }}>
          <button onClick={() => onWatch(item)}
            style={{ background:'none', border:'none', cursor:'pointer', fontSize:20,
              color:isWatched?'#f5c842':'#444', padding:'2px' }}
            title={isWatched?'In watchlist':'Add to Watchlist'}>
            {isWatched ? '★' : '☆'}
          </button>
          <button onClick={loadVinyl}
            style={{ background:'none', border:'none', cursor:'pointer', fontSize:16,
              color:expanded?C.accent:'#444', padding:'2px' }}
            title="View vinyl details & prices">
            💿
          </button>
        </div>
      </div>

      {/* Vinyl variants panel */}
      {expanded && (
        <div style={{ borderTop:`1px solid ${C.border}`, padding:'12px 14px' }}>
          {vinylLoading && (
            <div style={{ textAlign:'center', color:C.dim, ...MONO, fontSize:11, padding:'8px 0' }}>
              ⟳ Loading Discogs variants…
            </div>
          )}
          {!vinylLoading && vinylData?.variants?.length === 0 && (
            <div style={{ color:C.dim, ...MONO, fontSize:11 }}>No vinyl variants found on Discogs</div>
          )}
          {!vinylLoading && vinylData?.variants?.length > 0 && (
            <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
              <div style={{ fontSize:10, color:C.accent, ...MONO, letterSpacing:'0.15em',
                textTransform:'uppercase', marginBottom:4 }}>
                {vinylData.count} vinyl variant{vinylData.count!==1?'s':''}
                {vinylData.hasLimited && ' · 💎 Limited editions available'}
              </div>
              {vinylData.variants.slice(0,4).map(v => (
                <div key={v.id} style={{ background:C.bg3, borderRadius:8, padding:'10px 12px',
                  display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:8 }}>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontSize:11, color:C.text, ...MONO,
                      overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                      {v.title}
                    </div>
                    <div style={{ display:'flex', gap:6, marginTop:4, flexWrap:'wrap' }}>
                      {v.format && <span style={{ fontSize:9, color:C.dim, ...MONO }}>{v.format}</span>}
                      {v.country && <span style={{ fontSize:9, color:C.dim, ...MONO }}>{v.country}</span>}
                      {v.isLimited && (
                        <span style={{ fontSize:9, padding:'1px 6px', borderRadius:8,
                          background:'#2a1800', color:'#f5c842', border:'1px solid #92400e', ...MONO }}>
                          💎 LIMITED
                        </span>
                      )}
                      {v.color && <span style={{ fontSize:9, color:'#aaa', ...MONO }}>🎨 {v.color}</span>}
                    </div>
                  </div>
                  <div style={{ textAlign:'right', flexShrink:0 }}>
                    {v.lowestPrice && (
                      <div style={{ ...BEBAS, fontSize:18, color:'#4ade80', lineHeight:1 }}>
                        ${v.lowestPrice.toFixed(0)}
                      </div>
                    )}
                    <a href={v.discogsUrl} target="_blank" rel="noopener noreferrer"
                      style={{ fontSize:9, color:C.dim, ...MONO, textDecoration:'none' }}>
                      Discogs →
                    </a>
                  </div>
                </div>
              ))}
              {!inCollection && (
                <button onClick={() => onAddCollection({
                    discogs_id: vinylData.bestMatch?.id,
                    artist: item.artist, album: item.album,
                    cover: item.cover, format: vinylData.bestMatch?.format,
                  })}
                  style={{ padding:'9px', background:'#001a00', border:'1px solid #166534',
                    borderRadius:8, color:'#4ade80', cursor:'pointer', fontSize:12, ...MONO }}>
                  + Add to Collection
                </button>
              )}
              {inCollection && (
                <div style={{ fontSize:11, color:'#4ade80', ...MONO, textAlign:'center' }}>✓ In your collection</div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function SearchTab({ onWatch, onAddCollection, watchlist, collection }) {
  const [query,   setQuery]   = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');
  const [searched,setSearched]= useState(false);
  const timer = useRef(null);

  const search = useCallback(async (q) => {
    if (!q.trim()) { setResults([]); setSearched(false); return; }
    setLoading(true); setError(''); setSearched(true);
    try {
      // Search Discogs directly
      const res = await fetch(
        `https://api.discogs.com/database/search?q=${encodeURIComponent(q)}&type=release&format=vinyl&per_page=15`
      );
      if (!res.ok) throw new Error('Search failed');
      const d = await res.json();
      const items = (d.results || []).map(r => {
        const parts = (r.title || '').split(' - ');
        return {
          id:     r.id,
          artist: parts[0]?.trim() || r.title,
          album:  parts.slice(1).join(' - ').trim() || '',
          cover:  r.thumb || null,
          year:   r.year,
          source: 'discogs',
        };
      });
      setResults(items);
    } catch (e) {
      setError(e.message);
    }
    setLoading(false);
  }, []);

  const handleInput = (v) => {
    setQuery(v);
    clearTimeout(timer.current);
    if (v.length >= 2) {
      timer.current = setTimeout(() => search(v), 600);
    } else {
      setResults([]); setSearched(false);
    }
  };

  const isWatched    = (id) => watchlist.some(w => (w.album_id||w.id) === String(id));
  const inCollection = (id) => collection.some(c => c.discogs_id === id);

  return (
    <div style={{ padding:'0 0 16px' }}>
      {/* Header */}
      <div style={{ padding:'16px 16px 12px' }}>
        <div style={{ ...BEBAS, fontSize:28, color:C.text, letterSpacing:'0.06em', lineHeight:1 }}>
          SEARCH VINYL
        </div>
        <div style={{ fontSize:10, color:C.accent, ...MONO, letterSpacing:'0.2em', marginTop:2 }}>
          SEARCH DISCOGS DATABASE
        </div>
      </div>

      {/* Search input */}
      <div style={{ padding:'0 16px 12px' }}>
        <div style={{ position:'relative' }}>
          <input
            value={query}
            onChange={e => handleInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && search(query)}
            placeholder="Artist or album name…"
            style={inputSt}
            autoComplete="off"
            autoCapitalize="off"
          />
          {loading && (
            <div style={{ position:'absolute', right:12, top:'50%', transform:'translateY(-50%)',
              color:C.dim, fontSize:14 }}>⟳</div>
          )}
          {query && !loading && (
            <button onClick={() => { setQuery(''); setResults([]); setSearched(false); }}
              style={{ position:'absolute', right:12, top:'50%', transform:'translateY(-50%)',
                background:'none', border:'none', color:C.dim, cursor:'pointer', fontSize:18 }}>
              ×
            </button>
          )}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div style={{ margin:'0 16px 12px', background:'#1a0000', border:`1px solid ${C.accent}44`,
          borderRadius:8, padding:'10px 12px', color:'#f87171', fontSize:12, ...MONO }}>
          ⚠ {error}
        </div>
      )}

      {/* Empty state */}
      {!searched && !loading && (
        <div style={{ textAlign:'center', padding:'50px 24px', color:C.dim, ...MONO }}>
          <div style={{ fontSize:40, marginBottom:12 }}>🔍</div>
          <div style={{ fontSize:13, lineHeight:1.7 }}>
            Search any artist or album<br/>
            <span style={{ fontSize:11, color:'#333' }}>Powered by Discogs database</span>
          </div>
        </div>
      )}

      {/* No results */}
      {searched && !loading && results.length === 0 && !error && (
        <div style={{ textAlign:'center', padding:'40px 24px', color:C.dim, ...MONO }}>
          <div style={{ fontSize:32, marginBottom:10 }}>🤷</div>
          <div style={{ fontSize:12 }}>No results for "{query}"</div>
        </div>
      )}

      {/* Results */}
      {results.length > 0 && (
        <div style={{ padding:'0 16px' }}>
          <div style={{ fontSize:10, color:C.dim, ...MONO, letterSpacing:'0.1em',
            textTransform:'uppercase', marginBottom:10 }}>
            {results.length} results
          </div>
          <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
            {results.map(item => (
              <ResultCard
                key={item.id}
                item={item}
                onWatch={onWatch}
                onAddCollection={onAddCollection}
                isWatched={isWatched(item.id)}
                inCollection={inCollection(item.id)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
