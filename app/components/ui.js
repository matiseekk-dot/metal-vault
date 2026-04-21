// ── Shared UI components — extracted from app/page.js ────────────
'use client';
import { useState } from 'react';
import { C, MONO, BEBAS, BADGE_STYLES, GENRE_COLOR } from '@/lib/theme';

// ── formatDate helper ─────────────────────────────────────────
function formatDate(dateStr) {
  if (!dateStr) return '';
  const s = String(dateStr).trim();
  if (/^\d{4}$/.test(s)) return s;  // just year
  try {
    const d = new Date(s + (s.length === 7 ? '-01' : ''));  // handle YYYY-MM
    if (isNaN(d)) return s;
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
      return d.getDate() + ' ' + months[d.getMonth()] + ' ' + d.getFullYear();
    }
    if (/^\d{4}-\d{2}$/.test(s)) {
      return months[d.getMonth()] + ' ' + d.getFullYear();
    }
  } catch {}
  return s;
}

// ── Badge ─────────────────────────────────────────────────────
export function Badge({type,small}){
  const s=BADGE_STYLES[type];if(!s)return null;
  return(
    <span style={{display:'inline-flex',alignItems:'center',gap:3,padding:small?'2px 6px':'3px 8px',
      borderRadius:20,whiteSpace:'nowrap',fontSize:small?9:10,
      background:s.bg,color:s.color,border:'1px solid '+s.border,...MONO,letterSpacing:'0.05em'}}>
      {s.icon} {type}
    </span>
  );
}


// ── AlbumCover ────────────────────────────────────────────────
export function AlbumCover({src,artist='',size=64}){
  const [err,setErr]=useState(false);
  const bg=GENRE_COLOR(artist);
  if(!src||err)return(
    <div style={{width:size,height:size,borderRadius:6,flexShrink:0,
      background:'linear-gradient(135deg,'+bg+',#0a0a0a)',
      display:'flex',alignItems:'center',justifyContent:'center',border:'1px solid '+C.border}}>
      <span style={{...BEBAS,fontSize:Math.round(size*0.45),color:'#ffffff55'}}>{(artist[0]||'?').toUpperCase()}</span>
    </div>
  );
  return(
    <div style={{width:size,height:size,borderRadius:6,flexShrink:0,overflow:'hidden',border:'1px solid '+C.border}}>
      <img src={src} alt={artist} loading="lazy" onError={()=>setErr(true)}
        style={{width:'100%',height:'100%',objectFit:'cover'}}/>
    </div>
  );
}


// ── StatsBar ──────────────────────────────────────────────────
export function StatsBar({releases}){
  const today=new Date();
  const upcoming = releases.filter(r=>r.preorder===true||(r.releaseDate&&new Date(r.releaseDate)>today)).length;
  const recent   = releases.filter(r=>{
    const d=new Date(r.releaseDate);
    return !isNaN(d)&&(today-d)/(1000*60*60*24)<=60&&d<=today;
  }).length;
  return(
    <div style={{display:'flex',borderBottom:'1px solid '+C.border,background:C.bg2}}>
      {[{icon:'🔥',val:releases.length,label:'releases'},{icon:'⏳',val:upcoming,label:'upcoming'},{icon:'🆕',val:recent,label:'released'}].map(s=>(
        <div key={s.label} style={{flex:1,textAlign:'center',padding:'10px 4px'}}>
          <div style={{fontSize:11,...MONO,color:C.dim}}>{s.icon}</div>
          <div style={{...BEBAS,fontSize:22,color:C.accent,lineHeight:1}}>{s.val}</div>
          <div style={{fontSize:9,color:C.dim,...MONO,letterSpacing:'0.1em',textTransform:'uppercase'}}>{s.label}</div>
        </div>
      ))}
    </div>
  );
}


// ── AlbumCard ─────────────────────────────────────────────────
export function AlbumCard({album,isWatched,onWatchToggle,onClick,vinylData,isFollowed,onFollowToggle,user}){
  const today=new Date();
  const rd=new Date(album.releaseDate);
  const isPreorder=(rd>today)||album.preorder===true;
  const isNew=(today-rd)/(1000*60*60*24)<180&&!isPreorder;  // 6 months
  const isLimited=album.limited===true||vinylData?.hasLimited===true;
  // Compact vertical card for 2-column grid
  return(
    <div onClick={onClick} style={{
        background:C.bg2,
        border:'1px solid '+(isFollowed ? C.accent+'55' : C.border),
        borderRadius:12, overflow:'hidden', cursor:'pointer',
        WebkitTapHighlightColor:'transparent', position:'relative',
        boxShadow: isFollowed ? '0 0 0 1px '+C.accent+'22' : 'none',
      }}
      onTouchStart={e=>e.currentTarget.style.background=C.bg3}
      onTouchEnd={e=>e.currentTarget.style.background=C.bg2}
      onTouchCancel={e=>e.currentTarget.style.background=C.bg2}>
      {/* Cover — full width */}
      <div style={{position:'relative',paddingTop:'100%',background:'#111'}}>
        <div style={{position:'absolute',inset:0}}>
          <AlbumCover src={album.cover} artist={album.artist} size='100%'/>
        </div>
        {/* Badges overlay */}
        <div style={{position:'absolute',top:6,left:6,display:'flex',gap:3,flexWrap:'wrap'}}>
          {isPreorder&&<span style={{fontSize:8,padding:'2px 5px',borderRadius:4,background:'#dc262688',color:'#fff',...MONO}}>PRE</span>}
          {isLimited&&<span style={{fontSize:8,padding:'2px 5px',borderRadius:4,background:'#f5c84288',color:'#fff',...MONO}}>LTD</span>}
          {isNew&&<span style={{fontSize:8,padding:'2px 5px',borderRadius:4,background:'#4ade8088',color:'#fff',...MONO}}>NEW</span>}
        </div>
        {/* Watch button */}
        <button onClick={e=>{e.stopPropagation();onWatchToggle(album);}}
          style={{position:'absolute',top:4,right:4,background:'#00000066',border:'none',
            borderRadius:6,cursor:'pointer',fontSize:16,padding:'3px 5px',
            color:isWatched?'#f5c842':'#ffffff88',lineHeight:1}}>
          {isWatched?'★':'☆'}
        </button>
      </div>
      {/* Text */}
      <div style={{padding:'8px 10px 10px'}}>
        <div style={{...BEBAS,fontSize:14,letterSpacing:'0.04em',color:C.text,lineHeight:1.1,
          overflow:'hidden',display:'-webkit-box',WebkitLineClamp:2,WebkitBoxOrient:'vertical'}}>
          {album.artist}
        </div>
        <div style={{fontSize:10,color:C.muted,...MONO,marginTop:2,
          overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
          {album.album}
        </div>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginTop:6}}>
          <div style={{fontSize:9,color:isPreorder?C.accent:C.dim,...MONO}}>
            {isPreorder?'🗓 '+formatDate(album.releaseDate||''):formatDate(album.releaseDate||'')}
          </div>
          {album.lowest_price>0&&(
            <span style={{fontSize:10,color:'#4ade80',...MONO}}>${Number(album.lowest_price).toFixed(0)}</span>
          )}
        </div>
        {user&&(
          <button onClick={e=>{e.stopPropagation();onFollowToggle(album.artist);}}
            style={{marginTop:4,background:'none',border:'none',cursor:'pointer',fontSize:10,padding:0,
              color:isFollowed?C.accent:C.dim,...MONO,display:'flex',alignItems:'center',gap:3}}>
            {isFollowed?'🔔 following':'+ follow'}
          </button>
        )}
      </div>
    </div>
  );
}


// ── VinylModal ────────────────────────────────────────────────
export function VinylModal({album,onClose,onWatchToggle,isWatched,onAddToCollection,vinylData,loading,error,premium}){
  const [history, setHistory] = useState(null);
  const [histLoading, setHistLoading] = useState(false);

  const loadHistory = async (discogsId) => {
    if (!premium) return;
    setHistLoading(true);
    try {
      const r = await fetch('/api/price-history?discogs_id=' + discogsId);
      const d = await r.json();
      if (d.history) setHistory(d.history);
    } catch {}
    setHistLoading(false);
  };

  return(
    <div style={{position:'fixed',inset:0,background:'#000000bb',zIndex:200,display:'flex',flexDirection:'column',justifyContent:'flex-end'}}
      onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div style={{background:C.bg2,borderRadius:'16px 16px 0 0',maxHeight:'92vh',overflow:'auto',paddingBottom:'env(safe-area-inset-bottom,24px)'}}>
        <div style={{width:40,height:4,background:C.border2,borderRadius:2,margin:'12px auto 0'}}/>
        <div style={{display:'flex',gap:14,padding:'16px 16px 0',alignItems:'flex-start'}}>
          <AlbumCover src={album.cover} artist={album.artist} size={72}/>
          <div style={{flex:1,minWidth:0}}>
            <div style={{...BEBAS,fontSize:24,letterSpacing:'0.04em',color:C.text,lineHeight:1.1}}>{album.artist}</div>
            <div style={{fontSize:13,color:C.muted,...MONO,marginTop:3}}>{album.album}</div>
            <div style={{fontSize:11,color:C.dim,...MONO,marginTop:3}}>{formatDate(album.releaseDate)}</div>
          </div>
          <button onClick={()=>onWatchToggle(album)}
            style={{background:isWatched?'#2a2200':'none',border:'1px solid '+(isWatched?'#92400e':C.border),
              borderRadius:8,color:isWatched?'#f5c842':C.dim,cursor:'pointer',padding:'8px 10px',fontSize:18,flexShrink:0}}>
            {isWatched?'★':'☆'}
          </button>
        </div>
        {/* External listen/buy links — Spotify stream + Bandcamp search for buying */}
        <div style={{padding:'10px 16px 0',display:'flex',gap:14,flexWrap:'wrap'}}>
          {album.spotifyUrl&&(
            <a href={album.spotifyUrl} target="_blank" rel="noopener noreferrer"
              style={{fontSize:11,color:'#1db954',...MONO,textDecoration:'none'}}>▶ Listen on Spotify</a>
          )}
          {/* Bandcamp search — indie/underground metal usually on Bandcamp even when no Discogs listing */}
          <a href={'https://bandcamp.com/search?q=' + encodeURIComponent((album.artist||'') + ' ' + (album.album||''))}
            target="_blank" rel="noopener noreferrer"
            style={{fontSize:11,color:'#629aa9',...MONO,textDecoration:'none'}}>🎵 Buy on Bandcamp</a>
          {album.discogs_url&&(
            <a href={album.discogs_url} target="_blank" rel="noopener noreferrer"
              style={{fontSize:11,color:C.dim,...MONO,textDecoration:'none'}}>⬡ Discogs</a>
          )}
        </div>
        <div style={{margin:'14px 16px 0',borderTop:'1px solid '+C.border}}/>
        <div style={{padding:'14px 16px 16px'}}>
          <div style={{fontSize:10,color:C.accent,letterSpacing:'0.2em',textTransform:'uppercase',...MONO,marginBottom:12}}>
            Vinyl releases · Discogs
          </div>
          {loading&&<div style={{textAlign:'center',padding:'30px 0',color:C.dim,...MONO,fontSize:12}}>⟳ Searching releases…</div>}
          {error&&<div style={{background:'#1a0000',border:'1px solid '+C.accent+'44',borderRadius:8,padding:'12px 14px',color:'#f87171',fontSize:12,...MONO}}>
            {error.includes('not configured')?'⚙ Configure DISCOGS_TOKEN in Vercel → Environment Variables':`⚠ ${error}`}
          </div>}
          {!loading&&!error&&vinylData?.variants?.length===0&&(
            <div style={{textAlign:'center',padding:'24px 0',color:C.dim,...MONO,fontSize:12}}>No vinyl releases found on Discogs</div>
          )}
          {!loading&&!error&&vinylData?.variants?.length>0&&(
            <div style={{display:'flex',flexDirection:'column',gap:10}}>
              {vinylData.variants.map(v=>(
                <div key={v.id} style={{background:C.bg3,border:'1px solid '+C.border,borderRadius:10,padding:'12px 14px'}}>
                  <div style={{display:'flex',justifyContent:'space-between',gap:8,marginBottom:8}}>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:12,color:C.text,...MONO,lineHeight:1.3,marginBottom:4}}>{v.title}</div>
                      <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
                        {v.isLimited&&<Badge type="LIMITED" small/>}
                        <span style={{fontSize:9,color:C.dim,...MONO}}>{v.format}</span>
                        {v.country&&<span style={{fontSize:9,color:C.dim,...MONO}}>{v.country}</span>}
                        {v.color&&<span style={{fontSize:9,color:'#aaa',...MONO}}>🎨 {v.color}</span>}
                      </div>
                    </div>
                    {v.lowestPrice&&(
                      <div style={{textAlign:'right',flexShrink:0}}>
                        <div style={{...BEBAS,fontSize:20,color:C.accent,lineHeight:1}}>${v.lowestPrice.toFixed(0)}</div>
                        <div style={{fontSize:8,color:C.dim,...MONO}}>lowest</div>
                      </div>
                    )}
                  </div>
                  <div style={{display:'flex',gap:8}}>
                    <a href={v.discogsUrl} target="_blank" rel="noopener noreferrer"
                      onClick={e=>e.stopPropagation()}
                      style={{flex:1,display:'block',background:C.bg4,border:'1px solid '+C.border,
                        borderRadius:7,padding:'7px',fontSize:11,color:C.muted,...MONO,textDecoration:'none',textAlign:'center'}}>
                      🔗 Discogs
                    </a>
                    <button onClick={()=>onWatchToggle({
                        id: album.id + '_' + v.id,
                        artist: album.artist, album: album.album,
                        cover: album.cover,
                        format: v.format, color: v.color, label: v.label,
                        releaseDate: album.releaseDate,
                      })}
                      style={{flex:1,background:C.bg4,border:'1px solid '+C.border,borderRadius:7,
                        padding:'7px',fontSize:11,color:C.muted,...MONO,cursor:'pointer'}}>
                      ☆ Watch
                    </button>
                    <button onClick={()=>onAddToCollection({
                        discogs_id:v.id,artist:album.artist,album:album.album,
                        cover:album.cover,format:v.format,color:v.color,label:v.label,
                      })}
                      style={{flex:1,background:'#001a00',border:'1px solid #166534',borderRadius:7,
                        padding:'7px',fontSize:11,color:'#4ade80',...MONO,cursor:'pointer'}}>
                      + Vault
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Price History — Pro feature */}
          {/* Use album.id as the Discogs release ID for price history lookup */}
          {album?.id && !String(album.id).startsWith('m') && (
            <div style={{padding:'0 16px 16px'}}>
              {!premium ? (
                <div style={{background:'linear-gradient(135deg,#0a0a1a,#14142a)',border:'1px solid #3333aa55',borderRadius:10,padding:'12px 14px'}}>
                  <div style={{fontSize:10,color:'#818cf8',...MONO,letterSpacing:'0.12em',textTransform:'uppercase',marginBottom:4}}>📈 Price History</div>
                  <div style={{fontSize:11,color:'#6366f1',...MONO,marginBottom:8}}>See how this vinyl's value changed over time.</div>
                  <div style={{fontSize:10,color:'#4f46e5',...MONO}}>🔒 Metal Vault Pro feature</div>
                </div>
              ) : history === null && !histLoading ? (
                <button onClick={()=>loadHistory(album.id)}
                  style={{width:'100%',background:C.bg3,border:'1px solid '+C.border,borderRadius:10,padding:'10px',color:C.dim,cursor:'pointer',...MONO,fontSize:11}}>
                  📈 Load price history
                </button>
              ) : histLoading ? (
                <div style={{textAlign:'center',padding:'16px',color:C.dim,...MONO,fontSize:11}}>⏳ Loading history…</div>
              ) : history && history.length >= 2 ? (
                <div style={{background:C.bg3,border:'1px solid '+C.border,borderRadius:10,padding:'12px 14px'}}>
                  <div style={{fontSize:10,color:C.accent,...MONO,letterSpacing:'0.12em',textTransform:'uppercase',marginBottom:10}}>📈 Price History ({history.length} days)</div>
                  {(() => {
                    const vals = history.map(h => Number(h.median_price || h.lowest_price) || 0).filter(v=>v>0);
                    if (!vals.length) return null;
                    const max = Math.max(...vals);
                    const min = Math.min(...vals);
                    const range = max - min || 1;
                    const W=280, H=70, PL=32, PR=8, PT=6, PB=16;
                    const pts = history
                      .map(h => Number(h.median_price || h.lowest_price) || 0)
                      .filter(v=>v>0)
                      .map((v,i,arr) => {
                        const x = PL + (i/(arr.length-1||1))*(W-PL-PR);
                        const y = PT + ((max-v)/range)*(H-PT-PB);
                        return x+','+y;
                      }).join(' ');
                    const first = vals[0], last = vals[vals.length-1];
                    const change = last - first;
                    return (
                      <div>
                        <div style={{display:'flex',justifyContent:'space-between',marginBottom:6}}>
                          <span style={{fontSize:11,color:C.dim,...MONO}}>${min.toFixed(0)} – ${max.toFixed(0)}</span>
                          <span style={{fontSize:12,color:change>=0?'#4ade80':'#f87171',...MONO,fontWeight:'bold'}}>
                            {change>=0?'+':''}{change.toFixed(0)} ({change>=0?'+':''}{((change/first)*100).toFixed(0)}%)
                          </span>
                        </div>
                        <svg viewBox={'0 0 '+W+' '+H} style={{width:'100%',height:'auto'}}>
                          <defs>
                            <linearGradient id="phg" x1="0" x2="0" y1="0" y2="1">
                              <stop offset="0%" stopColor={change>=0?'#4ade80':'#f87171'} stopOpacity="0.3"/>
                              <stop offset="100%" stopColor={change>=0?'#4ade80':'#f87171'} stopOpacity="0"/>
                            </linearGradient>
                          </defs>
                          <polygon points={PL+','+(H-PB)+' '+pts+' '+(W-PR)+','+(H-PB)} fill="url(#phg)"/>
                          <polyline points={pts} fill="none" stroke={change>=0?'#4ade80':'#f87171'} strokeWidth="1.5"/>
                        </svg>
                      </div>
                    );
                  })()}
                </div>
              ) : history && history.length < 2 ? (
                <div style={{fontSize:10,color:C.dim,...MONO,textAlign:'center',padding:'8px'}}>📈 Not enough history yet — check back after the daily cron runs</div>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}


// ── BottomNav ─────────────────────────────────────────────────
export function BottomNav({tab,onChange,watchCount,user}){
  const tabs=[
    {id:'feed',      icon:'🔥', label:'Feed'},
    {id:'search',    icon:'🔍', label:'Search'},
    {id:'collection',icon:'📦', label:'Vault'},
    {id:'calendar',  icon:'📅', label:'Cal'},
    {id:'concerts',  icon:'🎸', label:'Live'},
    {id:'stats',     icon:'📊', label:'Stats'},
    {id:'profile',   icon:'👤', label:'Me'},
  ];
  return(
    <div style={{
      position:'fixed',bottom:0,left:0,right:0,background:'#0d0d0d',
      borderTop:'1px solid '+C.border,zIndex:100,
      paddingBottom:'env(safe-area-inset-bottom,0px)',
      boxShadow:'0 -4px 20px #00000088',
      display:'grid',gridTemplateColumns:'repeat(7,1fr)',
      overflow:'hidden',
    }}>
      {tabs.map(t=>(
        <button key={t.id} onClick={()=>onChange(t.id)}
          style={{
            background:'none',border:'none',cursor:'pointer',
            display:'flex',flexDirection:'column',alignItems:'center',
            justifyContent:'center',padding:'6px 0 5px',
            borderTop:tab===t.id?'2px solid '+C.accent:'2px solid transparent',
            overflow:'hidden',minWidth:0,
          }}>
          <span style={{
            fontSize:tab===t.id?18:15,
            lineHeight:1,
            color:tab===t.id?'#fff':'#555',
            transition:'font-size 0.15s',
            display:'block',
          }}>{t.icon}</span>
          <span style={{
            fontSize:'8px',
            color:tab===t.id?C.accent:'#444',
            fontFamily:'system-ui,-apple-system,sans-serif',
            fontWeight:tab===t.id?'600':'400',
            lineHeight:1.3,
            marginTop:2,
            display:'block',
            width:'100%',
            textAlign:'center',
            overflow:'hidden',
            textOverflow:'ellipsis',
            whiteSpace:'nowrap',
            letterSpacing:'-0.01em',
          }}>{t.label}</span>
        </button>
      ))}
    </div>
  );
}

