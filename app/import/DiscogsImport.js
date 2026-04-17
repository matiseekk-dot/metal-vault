'use client';
import { useState } from 'react';
import { C, MONO, BEBAS, inputSt } from '@/lib/theme';



function PreviewRow({ item }) {
  return (
    <div style={{
      display:'flex', gap:10, alignItems:'center',
      padding:'8px 0', borderBottom:`1px solid ${C.border}`,
    }}>
      <div style={{
        width:36, height:36, borderRadius:4, flexShrink:0,
        overflow:'hidden', border:`1px solid ${C.border}`,
        background:'#1a0000',
      }}>
        {item.cover
          ? <img src={item.cover} alt="" style={{width:'100%',height:'100%',objectFit:'cover'}} />
          : <div style={{width:'100%',height:'100%',display:'flex',alignItems:'center',justifyContent:'center'}}>
              <span style={{...BEBAS,fontSize:14,color:'#ffffff22'}}>{(item.artist||'?')[0]}</span>
            </div>
        }
      </div>
      <div style={{flex:1,minWidth:0}}>
        <div style={{fontSize:12,color:C.text,...MONO,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
          {item.artist}
        </div>
        <div style={{fontSize:10,color:C.dim,...MONO,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
          {item.album} {item.year ? `· ${item.year}` : ''}
        </div>
      </div>
      {item.format && (
        <span style={{fontSize:9,color:C.dim,...MONO,flexShrink:0}}>{item.format}</span>
      )}
    </div>
  );
}

export default function DiscogsImport({ onImportCollection, onImportWatchlist, user }) {
  const [username,   setUsername]   = useState('');
  const [loading,    setLoading]    = useState(false);
  const [preview,    setPreview]    = useState(null);
  const [error,      setError]      = useState('');
  const [importing,  setImporting]  = useState(false);
  const [done,       setDone]       = useState(null);
  const [importType, setImportType] = useState('both');

  const fetchPreview = async () => {
    if (!username.trim()) return;
    setLoading(true); setError(''); setPreview(null); setDone(null);

    try {
      const r = await fetch(`/api/import?username=${encodeURIComponent(username.trim())}&type=${importType}`);
      const d = await r.json();
      if (!r.ok || d.error) throw new Error(d.error || 'Import failed');
      setPreview(d);
    } catch (e) {
      setError(e.message);
    }
    setLoading(false);
  };

  const doImport = async () => {
    if (!preview) return;
    setImporting(true);

    let collImported = 0;
    let wantImported = 0;

    // Import collection
    if (preview.collection?.length > 0 && (importType === 'collection' || importType === 'both')) {
      for (const item of preview.collection) {
        try {
          await onImportCollection({
            discogs_id:     item.discogs_id,
            artist:         item.artist,
            album:          item.album,
            cover:          item.cover,
            format:         item.format,
            label:          item.label,
            purchase_price: item.purchase_price ? parseFloat(item.purchase_price) : null,
          });
          collImported++;
        } catch {}
      }
    }

    // Import wantlist
    if (preview.wantlist?.length > 0 && (importType === 'wantlist' || importType === 'both')) {
      for (const item of preview.wantlist) {
        try {
          await onImportWatchlist({
            album_id:     String(item.discogs_id),
            artist:       item.artist,
            album:        item.album,
            cover:        item.cover,
            release_date: item.year ? String(item.year) : '',
            spotify_url:  '',
          });
          wantImported++;
        } catch {}
      }
    }

    setDone({ collImported, wantImported });
    setImporting(false);
    setPreview(null);
  };

  if (!user) return (
    <div style={{textAlign:'center',padding:'60px 24px',color:C.dim,...MONO}}>
      <div style={{fontSize:40,marginBottom:12}}>🔒</div>
      <div style={{fontSize:13,lineHeight:1.7}}>Sign in to import your Discogs collection</div>
    </div>
  );

  return (
    <div style={{padding:'16px'}}>
      {/* Header */}
      <div style={{marginBottom:20}}>
        <div style={{...BEBAS,fontSize:26,color:C.text,letterSpacing:'0.06em',lineHeight:1}}>
          IMPORT FROM DISCOGS
        </div>
        <div style={{fontSize:10,color:C.accent,...MONO,letterSpacing:'0.2em',marginTop:2}}>
          MIGRATE YOUR COLLECTION & WANTLIST
        </div>
      </div>

      {/* Info box */}
      <div style={{background:'#0d1a2e',border:'1px solid #1e40af44',borderRadius:8,padding:'12px 14px',marginBottom:16}}>
        <div style={{fontSize:12,color:'#93c5fd',...MONO,lineHeight:1.6}}>
          ℹ Your Discogs collection must be <strong>public</strong> for this to work.<br/>
          Discogs → Profile → Settings → Privacy → Collection visibility: Public
        </div>
      </div>

      {/* Import type selector */}
      <div style={{marginBottom:14}}>
        <div style={{fontSize:10,color:C.dim,...MONO,letterSpacing:'0.15em',textTransform:'uppercase',marginBottom:8}}>
          What to import
        </div>
        <div style={{display:'flex',gap:6}}>
          {[
            {id:'both',     label:'Both'},
            {id:'collection',label:'Collection only'},
            {id:'wantlist', label:'Wantlist only'},
          ].map(t => (
            <button key={t.id} onClick={() => setImportType(t.id)}
              style={{
                padding:'7px 12px',borderRadius:20,cursor:'pointer',
                background:importType===t.id?`${C.accent}22`:C.bg3,
                color:importType===t.id?C.accent:C.dim,
                border:`1px solid ${importType===t.id?C.accent+'66':C.border}`,
                fontSize:11,...MONO,
              }}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Username input */}
      <div style={{marginBottom:12}}>
        <div style={{fontSize:10,color:C.dim,...MONO,letterSpacing:'0.15em',textTransform:'uppercase',marginBottom:6}}>
          Discogs Username
        </div>
        <div style={{display:'flex',gap:8}}>
          <input
            value={username}
            onChange={e => setUsername(e.target.value)}
            onKeyDown={e => e.key==='Enter' && fetchPreview()}
            placeholder="e.g. metal_collector"
            style={inputSt}
            autoComplete="off"
            autoCapitalize="off"
          />
          <button onClick={fetchPreview} disabled={loading||!username.trim()}
            style={{
              padding:'11px 16px',background:loading?C.bg3:`linear-gradient(135deg,${C.accent},${C.accent2})`,
              border:'none',borderRadius:8,color:'#fff',cursor:loading?'default':'pointer',
              ...BEBAS,fontSize:16,letterSpacing:'0.06em',flexShrink:0,
              opacity:loading||!username.trim()?0.6:1,
            }}>
            {loading ? '⟳' : 'FETCH'}
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div style={{background:'#1a0000',border:`1px solid ${C.accent}44`,borderRadius:8,padding:'12px 14px',marginBottom:12,color:'#f87171',fontSize:12,...MONO}}>
          ⚠ {error}
        </div>
      )}

      {/* Preview */}
      {preview && !importing && (
        <div style={{background:C.bg2,border:`1px solid ${C.border}`,borderRadius:12,overflow:'hidden',marginBottom:12}}>
          {/* Summary */}
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:1,background:C.border}}>
            {[
              {label:'Collection',val:preview.collection_count,color:'#4ade80'},
              {label:'Wantlist',  val:preview.wantlist_count,  color:'#f5c842'},
            ].map(s => (
              <div key={s.label} style={{background:C.bg3,padding:'14px',textAlign:'center'}}>
                <div style={{...BEBAS,fontSize:32,color:s.color,lineHeight:1}}>{s.val}</div>
                <div style={{fontSize:9,color:C.dim,...MONO,letterSpacing:'0.12em',textTransform:'uppercase',marginTop:3}}>{s.label} items</div>
              </div>
            ))}
          </div>

          {/* Preview list - collection */}
          {preview.collection?.length > 0 && (importType==='collection'||importType==='both') && (
            <div style={{padding:'14px 14px 0'}}>
              <div style={{fontSize:10,color:'#4ade80',...MONO,letterSpacing:'0.15em',textTransform:'uppercase',marginBottom:8}}>
                Collection preview
              </div>
              {preview.collection.slice(0, 5).map((item,i) => (
                <PreviewRow key={i} item={item}/>
              ))}
              {preview.collection.length > 5 && (
                <div style={{fontSize:10,color:C.dim,...MONO,padding:'8px 0'}}>
                  +{preview.collection.length - 5} more…
                </div>
              )}
            </div>
          )}

          {/* Preview list - wantlist */}
          {preview.wantlist?.length > 0 && (importType==='wantlist'||importType==='both') && (
            <div style={{padding:'14px 14px 0'}}>
              <div style={{fontSize:10,color:'#f5c842',...MONO,letterSpacing:'0.15em',textTransform:'uppercase',marginBottom:8}}>
                Wantlist preview
              </div>
              {preview.wantlist.slice(0, 5).map((item,i) => (
                <PreviewRow key={i} item={item}/>
              ))}
              {preview.wantlist.length > 5 && (
                <div style={{fontSize:10,color:C.dim,...MONO,padding:'8px 0'}}>
                  +{preview.wantlist.length - 5} more…
                </div>
              )}
            </div>
          )}

          {/* Errors from API */}
          {preview.errors?.length > 0 && (
            <div style={{padding:'12px 14px'}}>
              {preview.errors.map((e,i) => (
                <div key={i} style={{fontSize:10,color:'#f87171',...MONO}}>⚠ {e.source}: {e.error}</div>
              ))}
            </div>
          )}

          {/* Import button */}
          <div style={{padding:'14px'}}>
            <button onClick={doImport}
              style={{
                width:'100%',padding:'14px',
                background:`linear-gradient(135deg,${C.accent},${C.accent2})`,
                border:'none',borderRadius:10,color:'#fff',cursor:'pointer',
                ...BEBAS,fontSize:18,letterSpacing:'0.1em',
              }}>
              IMPORT {(preview.collection_count + preview.wantlist_count)} ITEMS
            </button>
            <div style={{fontSize:10,color:C.dim,...MONO,textAlign:'center',marginTop:8}}>
              Duplicates will be skipped automatically
            </div>
          </div>
        </div>
      )}

      {/* Importing progress */}
      {importing && (
        <div style={{textAlign:'center',padding:'40px',color:C.dim,...MONO}}>
          <div style={{fontSize:32,marginBottom:12}}>⟳</div>
          <div style={{fontSize:13}}>Importing… this may take a moment</div>
        </div>
      )}

      {/* Done */}
      {done && (
        <div style={{background:'#001a00',border:'1px solid #166534',borderRadius:12,padding:'24px',textAlign:'center'}}>
          <div style={{fontSize:40,marginBottom:12}}>✅</div>
          <div style={{...BEBAS,fontSize:24,color:'#4ade80',marginBottom:8}}>IMPORT COMPLETE</div>
          <div style={{fontSize:12,color:'#6ee7b7',...MONO,lineHeight:1.8}}>
            {done.collImported > 0 && <div>📦 {done.collImported} items added to Collection</div>}
            {done.wantImported > 0 && <div>★ {done.wantImported} items added to Watchlist</div>}
          </div>
          <button onClick={() => { setDone(null); setUsername(''); setPreview(null); }}
            style={{marginTop:16,background:'none',border:`1px solid #166534`,borderRadius:8,
              color:'#4ade80',padding:'8px 20px',cursor:'pointer',...MONO,fontSize:12}}>
            Import more
          </button>
        </div>
      )}
    </div>
  );
}
