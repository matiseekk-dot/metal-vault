'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import { createClient } from '@/lib/supabase';
import dynamic from 'next/dynamic';
const ScannerTab    = dynamic(() => import('@/app/scanner/ScannerTab'),    { ssr: false });
const DiscogsImport = dynamic(() => import('@/app/import/DiscogsImport'),  { ssr: false });
const SearchTab     = dynamic(() => import('@/app/search/SearchTab'),       { ssr: false });
const StatsTab      = dynamic(() => import('@/app/stats/StatsTab'),         { ssr: false });
const ConcertsTab   = dynamic(() => import('@/app/concerts/ConcertsTab'),   { ssr: false });
const CalendarTab   = dynamic(() => import('@/app/calendar/CalendarTab'),   { ssr: false });

// ── Design tokens ─────────────────────────────────────────────
const C = {
  bg:'#0a0a0a',bg2:'#141414',bg3:'#1e1e1e',bg4:'#252525',
  border:'#2a2a2a',border2:'#333',
  accent:'#dc2626',accent2:'#991b1b',
  text:'#f0f0f0',muted:'#888',dim:'#555',ultra:'#333',
};
const MONO  = {fontFamily:"'Space Mono',monospace"};
const BEBAS = {fontFamily:"'Bebas Neue',sans-serif"};
const BADGE_STYLES = {
  VINYL:    {bg:'#0d1a2e',color:'#60a5fa',border:'#1e40af',icon:'💿'},
  LIMITED:  {bg:'#2a1800',color:'#f5c842',border:'#92400e',icon:'💎'},
  PREORDER: {bg:'#0d2a0d',color:'#4ade80',border:'#166534',icon:'⏳'},
  NEW:      {bg:'#2a0000',color:'#f87171',border:'#7f1d1d',icon:'🔥'},
};

const GENRE_COLOR = (g='') => {
  const s = g.toLowerCase();
  if(s.includes('death'))  return '#8b0000';
  if(s.includes('black'))  return '#1a1a1a';
  if(s.includes('doom'))   return '#2a1a0a';
  if(s.includes('thrash')) return '#2a1500';
  if(s.includes('prog'))   return '#1a2a3a';
  if(s.includes('sludge')) return '#1a1a0a';
  if(s.includes('grind'))  return '#0d2a0d';
  return '#1a0000';
};

const VINYL_GRADES = ['M','NM','VG+','VG','G+','G','F','P'];
const GRADE_COLOR = {'M':'#4ade80','NM':'#4ade80','VG+':'#f5c842','VG':'#f5c842','G+':'#f97316','G':'#f87171','F':'#f87171','P':'#888'};

const inputSt = {
  width:'100%',background:C.bg3,border:'1px solid '+C.border,
  borderRadius:8,color:C.text,padding:'11px 14px',fontSize:16,
  ...MONO,outline:'none',
};

// ── localStorage helpers (offline fallback) ───────────────────
const LS_WL = 'mv_watchlist_v2';
const LS_VC = 'mv_vinyl_cache_v2';
function loadLS(k,fb){try{const v=localStorage.getItem(k);return v?JSON.parse(v):fb;}catch{return fb;}}
function saveLS(k,v){try{localStorage.setItem(k,JSON.stringify(v));}catch{}}

// ── Small components ──────────────────────────────────────────
function Badge({type,small}){
  const s=BADGE_STYLES[type];if(!s)return null;
  return(
    <span style={{display:'inline-flex',alignItems:'center',gap:3,padding:small?'2px 6px':'3px 8px',
      borderRadius:20,whiteSpace:'nowrap',fontSize:small?9:10,
      background:s.bg,color:s.color,border:'1px solid '+s.border,...MONO,letterSpacing:'0.05em'}}>
      {s.icon} {type}
    </span>
  );
}

function AlbumCover({src,artist='',size=64}){
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
function StatsBar({releases}){
  const today=new Date();
  const newCount = releases.filter(r=>{
    const d=new Date(r.releaseDate);
    return !isNaN(d)&&(today-d)/(1000*60*60*24)<365&&d<=today;
  }).length;
  const preorders = releases.filter(r=>new Date(r.releaseDate)>today).length;
  return(
    <div style={{display:'flex',borderBottom:'1px solid '+C.border,background:C.bg2}}>
      {[{icon:'💿',val:releases.length,label:'releases'},{icon:'🆕',val:newCount,label:'← 365 days'},{icon:'⏳',val:preorders,label:'pre-order'}].map(s=>(
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
function AlbumCard({album,isWatched,onWatchToggle,onClick,vinylData,isFollowed,onFollowToggle,user}){
  const today=new Date();
  const rd=new Date(album.releaseDate);
  const isPreorder=rd>today;
  const isNew=(today-rd)/(1000*60*60*24)<45&&!isPreorder;
  const badges=[vinylData?.hasVinyl!==false&&'VINYL',vinylData?.hasLimited&&'LIMITED',isPreorder&&'PREORDER',isNew&&'NEW'].filter(Boolean);
  return(
    <div onClick={onClick} style={{background:C.bg2,border:'1px solid '+C.border,borderRadius:12,
      padding:'12px 14px',display:'flex',gap:12,alignItems:'flex-start',cursor:'pointer',WebkitTapHighlightColor:'transparent'}}
      onMouseEnter={e=>e.currentTarget.style.borderColor=C.border2}
      onMouseLeave={e=>e.currentTarget.style.borderColor=C.border}
      onTouchStart={e=>e.currentTarget.style.background=C.bg3}
      onTouchEnd={e=>e.currentTarget.style.background=C.bg2}>
      <AlbumCover src={album.cover} artist={album.artist} size={64}/>
      <div style={{flex:1,minWidth:0}}>
        <div style={{...BEBAS,fontSize:19,letterSpacing:'0.04em',color:C.text,lineHeight:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
          {album.artist}
        </div>
        <div style={{fontSize:12,color:C.muted,...MONO,marginTop:2,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
          {album.album}
        </div>
        <div style={{display:'flex',gap:4,marginTop:6,flexWrap:'wrap'}}>
          {badges.map(b=><Badge key={b} type={b} small/>)}
          {vinylData?.count>0&&(
            <span style={{fontSize:9,padding:'2px 6px',borderRadius:10,background:C.bg3,color:C.dim,border:'1px solid '+C.border,...MONO}}>
              {vinylData.count} variant{vinylData.count!==1?'s':''}
            </span>
          )}
        </div>
        <div style={{fontSize:10,color:C.dim,...MONO,marginTop:5}}>
          {isPreorder?('🗓 '+(album.releaseDate||'')):(album.releaseDate?.length===10&&album.releaseDate.endsWith('-06-01')?album.releaseDate.slice(0,4):album.releaseDate||'')}
        </div>
      </div>
      <div style={{display:'flex',flexDirection:'column',gap:4,flexShrink:0}}>
        <button onClick={e=>{e.stopPropagation();onWatchToggle(album);}}
          style={{background:'none',border:'none',cursor:'pointer',fontSize:20,padding:'2px 0',
            color:isWatched?'#f5c842':C.ultra,transition:'color 0.15s'}}
          title={isWatched?'Remove from watchlist':'Add to watchlist'}>
          {isWatched?'★':'☆'}
        </button>
        {user&&(
          <button onClick={e=>{e.stopPropagation();onFollowToggle(album.artist);}}
            style={{background:'none',border:'none',cursor:'pointer',fontSize:14,padding:'2px 0',
              color:isFollowed?C.accent:C.ultra,transition:'color 0.15s'}}
            title={isFollowed?'Unfollow artist':'Follow artist'}>
            {isFollowed?'🔔':'🔕'}
          </button>
        )}
      </div>
    </div>
  );
}

// ── VinylModal ────────────────────────────────────────────────
function VinylModal({album,onClose,onWatchToggle,isWatched,onAddToCollection,vinylData,loading,error}){
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
            <div style={{fontSize:11,color:C.dim,...MONO,marginTop:3}}>{album.releaseDate}</div>
          </div>
          <button onClick={()=>onWatchToggle(album)}
            style={{background:isWatched?'#2a2200':'none',border:'1px solid '+(isWatched?'#92400e':C.border),
              borderRadius:8,color:isWatched?'#f5c842':C.dim,cursor:'pointer',padding:'8px 10px',fontSize:18,flexShrink:0}}>
            {isWatched?'★':'☆'}
          </button>
        </div>
        {album.spotifyUrl&&(
          <div style={{padding:'10px 16px 0'}}>
            <a href={album.spotifyUrl} target="_blank" rel="noopener noreferrer"
              style={{fontSize:11,color:'#1db954',...MONO,textDecoration:'none'}}>▶ Listen on Spotify</a>
          </div>
        )}
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
                    <button onClick={()=>onAddToCollection({
                        discogs_id:v.id,artist:album.artist,album:album.album,
                        cover:album.cover,format:v.format,color:v.color,label:v.label,
                      })}
                      style={{flex:1,background:'#001a00',border:'1px solid #166534',borderRadius:7,
                        padding:'7px',fontSize:11,color:'#4ade80',...MONO,cursor:'pointer'}}>
                      + Collection
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Portfolio Chart (SVG) ─────────────────────────────────────
function PortfolioChart({snapshots}){
  if(!snapshots||snapshots.length<2)return(
    <div style={{textAlign:'center',padding:'30px 0',color:C.dim,...MONO,fontSize:11}}>
      No historical data — add records to your collection
    </div>
  );
  const vals=snapshots.map(s=>Number(s.total_value)||0);
  const maxV=Math.max(...vals,1);const minV=Math.min(...vals,0);const range=maxV-minV||1;
  const W=300,H=100,PL=36,PR=8,PT=8,PB=20;
  const pts=snapshots.map((s,i)=>{
    const x=PL+(i/(snapshots.length-1))*(W-PL-PR);
    const y=PT+((maxV-(Number(s.total_value)||0))/range)*(H-PT-PB);
    return`${x},${y}`;
  }).join(' ');
  const area=`${PL},${H-PB} ${pts} ${W-PR},${H-PB}`;
  return(
    <svg viewBox={'0 0 '+W+' '+H} style={{width:'100%',height:'auto'}}>
      <defs>
        <linearGradient id="cg" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={C.accent} stopOpacity="0.25"/>
          <stop offset="100%" stopColor={C.accent} stopOpacity="0"/>
        </linearGradient>
      </defs>
      {[0,0.5,1].map(pct=>{
        const y=PT+pct*(H-PT-PB);const val=maxV-pct*range;
        return(
          <g key={pct}>
            <line x1={PL} x2={W-PR} y1={y} y2={y} stroke={C.border} strokeWidth="1"/>
            <text x={PL-3} y={y+3} textAnchor="end" fontSize="7" fill={C.dim}>{val.toFixed(0)}</text>
          </g>
        );
      })}
      <polygon points={area} fill="url(#cg)"/>
      <polyline points={pts} fill="none" stroke={C.accent} strokeWidth="1.5"/>
      {snapshots.map((s,i)=>{
        const [x,y]=pts.split(' ')[i].split(',').map(Number);
        return<circle key={i} cx={x} cy={y} r="2.5" fill={C.accent}/>;
      })}
    </svg>
  );
}

// ── Collection Tab ────────────────────────────────────────────
function CollectionTab({user,collection,watchlist=[],onRemoveWatch,onRemove,onUpdate,portfolio,onAlbumClick}){
  const [view,setView]=useState('vinyl');
  if(!onUpdate)onUpdate=()=>{}; // safety
  const [showAlertForm,setShowAlertForm]=useState(null);
  const [targetPrice,setTargetPrice]=useState('');
  const [saving,setSaving]=useState(false);

  const createAlert=async(item)=>{
    if(!targetPrice||isNaN(targetPrice))return;
    setSaving(true);
    await fetch('/api/alerts',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        discogs_id:item.discogs_id,collection_id:item.id,
        artist:item.artist,album:item.album,
        target_price:parseFloat(targetPrice),
      }),
    });
    setSaving(false);setShowAlertForm(null);setTargetPrice('');
  };

  if(!user)return(
    <div style={{textAlign:'center',padding:'60px 24px',color:C.dim,...MONO}}>
      <div style={{fontSize:40,marginBottom:12}}>📦</div>
      <div style={{fontSize:13,lineHeight:1.7}}>Sign in to manage your collection</div>
    </div>
  );

  const summary=portfolio?.summary;

  return(
    <div style={{padding:'0 0 16px'}}>
      {/* Summary */}
      {summary&&summary.itemCount>0&&(
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:0,borderBottom:'1px solid '+C.border}}>
          {[
            {l:'Records',v:summary.itemCount},
            {l:'Paid',v:summary.totalPurchased>0?`${summary.totalPurchased.toFixed(0)} `:'—'},
            {l:'Gain',v:summary.gain!==0?`${summary.gain>0?'+':''}${summary.gain.toFixed(0)}`:'—',
              color:summary.gain>0?'#4ade80':summary.gain<0?'#f87171':C.muted},
          ].map(s=>(
            <div key={s.l} style={{textAlign:'center',padding:'14px 8px',borderRight:'1px solid '+C.border}}>
              <div style={{...BEBAS,fontSize:20,color:s.color||C.accent,lineHeight:1}}>{s.v}</div>
              <div style={{fontSize:9,color:C.dim,...MONO,letterSpacing:'0.1em',textTransform:'uppercase',marginTop:3}}>{s.l}</div>
            </div>
          ))}
        </div>
      )}

      {/* Portfolio chart */}
      {portfolio?.snapshots?.length>=2&&(
        <div style={{padding:'16px',borderBottom:'1px solid '+C.border}}>
          <div style={{fontSize:10,color:C.accent,letterSpacing:'0.2em',textTransform:'uppercase',...MONO,marginBottom:10}}>
            Collection value over time
          </div>
          <PortfolioChart snapshots={portfolio.snapshots}/>
        </div>
      )}

      {/* Subtabs */}
      <div style={{display:'flex',borderBottom:'1px solid '+C.border,padding:'0 16px',flexShrink:0}}>
        {[['vinyl',`💿 Vinyl (${collection.length})`],['watchlist',`★ Watchlist (${watchlist.length})`]].map(([k,l])=>(
          <button key={k} onClick={()=>setView(k)}
            style={{padding:'10px 14px',background:'none',border:'none',cursor:'pointer',
              borderBottom:view===k?'2px solid '+C.accent:'2px solid transparent',
              color:view===k?C.text:C.dim,...MONO,fontSize:11,marginBottom:-1}}>
            {l}
          </button>
        ))}
      </div>

      {view==='watchlist'&&(
        <WatchlistTab
          watchlist={watchlist}
          user={user}
          onRemove={onRemoveWatch}
          onAlbumClick={onAlbumClick}
        />
      )}

      {view==='vinyl'&&(
      <div style={{padding:'16px'}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
          <div style={{fontSize:10,color:C.accent,letterSpacing:'0.2em',textTransform:'uppercase',...MONO}}>
            My records ({collection.length})
          </div>
          <select onChange={e=>{
            const s=e.target.value;
            const sorted=[...collection].sort((a,b)=>{
              if(s==='artist')return(a.artist||'').localeCompare(b.artist||'');
              if(s==='price_asc') return(Number(a.purchase_price)||0)-(Number(b.purchase_price)||0);
              if(s==='price_desc')return(Number(b.purchase_price)||0)-(Number(a.purchase_price)||0);
              if(s==='added')return new Date(b.added_at||0)-new Date(a.added_at||0);
              return 0;
            });
            onUpdate(sorted);
          }}
            style={{background:C.bg3,border:'1px solid '+C.border,borderRadius:6,color:C.muted,
              padding:'5px 8px',fontSize:11,...MONO,cursor:'pointer',outline:'none'}}>
            <option value="added">Added order</option>
            <option value="artist">Artist A–Z</option>
            <option value="price_desc">Price ↓</option>
            <option value="price_asc">Price ↑</option>
          </select>
        </div>
        {collection.length>0&&(
          <div style={{display:'flex',gap:6,marginBottom:12}}>
            <button onClick={async()=>{
              if(!window.confirm('Remove duplicate entries? (keeps newest)'))return;
              const seen=new Set();const toDelete=[];
              [...collection].sort((a,b)=>new Date(b.added_at)-new Date(a.added_at)).forEach(i=>{
                const key=(i.discogs_id||'')+'::'+i.artist+'::'+i.album;
                if(seen.has(key))toDelete.push(i.id);else seen.add(key);
              });
              if(toDelete.length===0)return;
              // Batch delete — single request
              await fetch('/api/collection/batch',{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({ids:toDelete})});
              const fresh=await fetch('/api/collection').then(r=>r.json());
              if(fresh.items)onUpdate(fresh.items);
            }} style={{flex:1,padding:'7px',background:'#1a0a00',border:'1px solid #92400e',borderRadius:7,color:'#f97316',cursor:'pointer',fontSize:10,...MONO}}>
              🗑 Remove duplicates
            </button>
            <button onClick={async()=>{
              if(!window.confirm('Delete ALL records from collection? This cannot be undone.'))return;
              const ids=collection.map(i=>i.id);
              // Batch delete — single request
              await fetch('/api/collection/batch',{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({ids})});
              onUpdate([]);
            }} style={{flex:1,padding:'7px',background:'#1a0000',border:'1px solid #7f1d1d',borderRadius:7,color:'#f87171',cursor:'pointer',fontSize:10,...MONO}}>
              🗑 Clear all
            </button>
          </div>
        )}
        {collection.length===0?(
          <div style={{textAlign:'center',padding:'40px 0',color:C.dim,...MONO,fontSize:12}}>
            <div style={{fontSize:40,marginBottom:10}}>📦</div>
            Collection is empty — add records from album modal
          </div>
        ):(
          <div style={{display:'flex',flexDirection:'column',gap:8}}>
            {collection.map(item=>(
              <div key={item.id} style={{background:C.bg2,border:'1px solid '+C.border,borderRadius:10,padding:'12px 14px'}}>
                <div style={{display:'flex',gap:12,alignItems:'flex-start'}}>
                  <AlbumCover src={item.cover} artist={item.artist} size={48}/>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{...BEBAS,fontSize:17,color:C.text,lineHeight:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{item.artist}</div>
                    <div style={{fontSize:11,color:C.muted,...MONO,marginTop:2,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{item.album}</div>
                    <div style={{display:'flex',gap:6,marginTop:5,flexWrap:'wrap',alignItems:'center'}}>
                      {item.grade&&item.grade!=='NM'&&<span style={{fontSize:9,padding:'1px 6px',borderRadius:4,background:GRADE_COLOR[item.grade]+'22',color:GRADE_COLOR[item.grade],...MONO}}>{item.grade}</span>}
                      {item.format&&item.format!=='Vinyl'&&<span style={{fontSize:9,color:C.dim,...MONO,padding:'1px 5px',background:C.bg3,borderRadius:4}}>{item.format}</span>}
                      {item.purchase_price>0&&<span style={{fontSize:10,color:'#f5c842',...MONO}}>💰 ${Number(item.purchase_price).toFixed(0)}</span>}
                      {item.median_price>0&&<span style={{fontSize:10,color:'#4ade80',...MONO}}>📈 ${Number(item.median_price).toFixed(0)}</span>}
                      {item.current_price>0&&!item.median_price&&<span style={{fontSize:10,color:'#60a5fa',...MONO}}>🏷 ${Number(item.current_price).toFixed(0)}</span>}
                    </div>
                    {/* Purchase price edit */}
                    {showAlertForm===item.id+'_price'?(
                      <div style={{marginTop:8,display:'flex',gap:6,alignItems:'center'}}>
                        <span style={{fontSize:10,color:C.dim,...MONO,flexShrink:0}}>Paid ($)</span>
                        <input type="number" defaultValue={item.purchase_price||''} id={'pp_'+item.id}
                          placeholder="0.00" style={{flex:1,background:C.bg3,border:'1px solid '+C.border,borderRadius:6,color:C.text,padding:'6px 10px',fontSize:14,...MONO,outline:'none'}}/>
                        <button onClick={async()=>{
                          const val=document.getElementById('pp_'+item.id)?.value;
                          if(!val)return;
                          await fetch('/api/collection?id='+item.id,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({purchase_price:parseFloat(val)})});
                          const fresh=await fetch('/api/collection').then(r=>r.json());
                          if(fresh.items)onUpdate(fresh.items);
                          setShowAlertForm(null);
                        }} style={{background:C.accent,border:'none',borderRadius:6,color:'#fff',padding:'6px 12px',cursor:'pointer',...BEBAS,fontSize:14}}>OK</button>
                        <button onClick={()=>setShowAlertForm(null)} style={{background:'none',border:'1px solid '+C.border,borderRadius:6,color:C.dim,padding:'6px 8px',cursor:'pointer',...MONO,fontSize:10}}>✕</button>
                      </div>
                    ):(
                      !item.purchase_price&&(
                        <button onClick={()=>setShowAlertForm(item.id+'_price')}
                          style={{marginTop:6,background:'none',border:'1px solid '+C.border,borderRadius:6,color:C.dim,padding:'4px 10px',cursor:'pointer',...MONO,fontSize:9}}>
                          + Set purchase price
                        </button>
                      )
                    )}
                    {/* Grade selector */}
                    <div style={{display:'flex',gap:4,marginTop:6,flexWrap:'wrap'}}>
                      {VINYL_GRADES.map(g=>(
                        <button key={g} onClick={async()=>{
                          await fetch('/api/collection?id='+item.id,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({grade:g})});
                          const fresh=await fetch('/api/collection').then(r=>r.json());
                          if(fresh.items)onUpdate(fresh.items);
                        }}
                          style={{fontSize:9,padding:'2px 6px',borderRadius:4,cursor:'pointer',border:'1px solid '+(item.grade===g?GRADE_COLOR[g]:C.border),
                            background:item.grade===g?GRADE_COLOR[g]+'22':C.bg3,color:item.grade===g?GRADE_COLOR[g]:C.dim,...MONO}}>
                          {g}
                        </button>
                      ))}
                      <span style={{fontSize:9,color:C.dim,...MONO,alignSelf:'center',marginLeft:2}}>grade</span>
                    </div>
                  </div>
                  <button onClick={()=>onRemove(item.id)}
                    style={{background:'none',border:'none',color:C.ultra,cursor:'pointer',fontSize:18,padding:'0 2px'}}
                    onMouseEnter={e=>e.currentTarget.style.color=C.accent}
                    onMouseLeave={e=>e.currentTarget.style.color=C.ultra}>×</button>
                </div>
                {/* Alert button */}
                {item.discogs_id&&(
                  showAlertForm===item.id?(
                    <div style={{marginTop:10,display:'flex',gap:6,alignItems:'center'}}>
                      <span style={{fontSize:10,color:C.dim,...MONO,flexShrink:0}}>Alert when price ≤</span>
                      <input type="number" value={targetPrice} onChange={e=>setTargetPrice(e.target.value)}
                        placeholder="$" style={{...inputSt,padding:'6px 10px',fontSize:14,flex:1}}/>
                      <button onClick={()=>createAlert(item)} disabled={saving}
                        style={{background:C.accent,border:'none',borderRadius:6,color:'#fff',padding:'7px 12px',cursor:'pointer',...BEBAS,fontSize:14}}>
                        {saving?'…':'OK'}
                      </button>
                      <button onClick={()=>setShowAlertForm(null)}
                        style={{background:'none',border:'1px solid '+C.border,borderRadius:6,color:C.dim,padding:'7px 10px',cursor:'pointer',...MONO,fontSize:10}}>✕</button>
                    </div>
                  ):(
                    <button onClick={()=>setShowAlertForm(item.id)}
                      style={{marginTop:8,background:'none',border:'1px solid '+C.border,borderRadius:6,
                        color:C.dim,padding:'5px 10px',cursor:'pointer',...MONO,fontSize:10,width:'100%'}}>
                      🔔 Set price alert
                    </button>
                  )
                )}
              </div>
            ))}
          </div>
        )}
      </div>
      )}
    </div>
  );
}

// ── Profile Tab ───────────────────────────────────────────────
function ProfileTab({user,profile,followedArtists,onSignOut,onUpdateProfile,onShowImport,pushEnabled,pushLoading,onTogglePush,discogsConnected,onConnectDiscogs,shareToken,onGetShareToken}){
  const [username,setUsername]=useState(profile?.username||'');
  const [isPublic,setIsPublic]=useState(profile?.is_public||false);
  const [saving,setSaving]=useState(false);
  const [msg,setMsg]=useState('');

  const saveProfile=async()=>{
    setSaving(true);setMsg('');
    const r=await fetch('/api/profile',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({username,is_public:isPublic}),
    });
    const d=await r.json();
    setSaving(false);
    setMsg(d.error||'✓ Saved');
    if(!d.error)onUpdateProfile({username,is_public:isPublic});
  };

  if(!user)return(
    <div style={{textAlign:'center',padding:'60px 24px',color:C.dim,...MONO}}>
      <div style={{fontSize:40,marginBottom:12}}>👤</div>
      <div style={{fontSize:13,marginBottom:20,lineHeight:1.7}}>Sign in to manage your profile</div>
      <button onClick={()=>window.location.href='/login'}
        style={{background:'linear-gradient(135deg,'+C.accent+','+C.accent2+')',border:'none',borderRadius:10,
          color:'#fff',padding:'13px 24px',...BEBAS,fontSize:18,letterSpacing:'0.1em',cursor:'pointer'}}>
        SIGN IN
      </button>
    </div>
  );

  return(
    <div style={{padding:'16px'}}>
      {/* User info */}
      <div style={{display:'flex',gap:14,alignItems:'center',marginBottom:24,padding:'16px',
        background:C.bg2,border:'1px solid '+C.border,borderRadius:12}}>
        <div style={{width:52,height:52,borderRadius:'50%',background:'linear-gradient(135deg,'+C.accent+',#450a0a)',
          display:'flex',alignItems:'center',justifyContent:'center',fontSize:24,overflow:'hidden',flexShrink:0}}>
          {user.user_metadata?.avatar_url
            ?<img src={user.user_metadata.avatar_url} alt="" style={{width:'100%',height:'100%',objectFit:'cover'}}/>
            :<span style={{...BEBAS}}>{(user.email||'?')[0].toUpperCase()}</span>
          }
        </div>
        <div style={{flex:1,minWidth:0}}>
          <div style={{...BEBAS,fontSize:20,color:C.text,lineHeight:1}}>{user.user_metadata?.full_name||'Collector'}</div>
          <div style={{fontSize:11,color:C.dim,...MONO,marginTop:2,overflow:'hidden',textOverflow:'ellipsis'}}>{user.email}</div>
        </div>
      </div>

      {/* Profile settings */}
      <div style={{background:C.bg2,border:'1px solid '+C.border,borderRadius:12,padding:'16px',marginBottom:16}}>
        <div style={{fontSize:10,color:C.accent,letterSpacing:'0.2em',textTransform:'uppercase',...MONO,marginBottom:12}}>Profile settings</div>

        <label style={{fontSize:10,color:C.dim,...MONO,letterSpacing:'0.15em',textTransform:'uppercase',display:'block',marginBottom:4}}>
          Username (@)
        </label>
        <input value={username} onChange={e=>setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g,''))}
          placeholder="e.g. metal_collector" style={{...inputSt,marginBottom:12}}/>

        <div style={{display:'flex',alignItems:'center',gap:12,marginBottom:16}}>
          <button onClick={()=>setIsPublic(p=>!p)}
            style={{width:44,height:24,borderRadius:12,border:'none',cursor:'pointer',
              background:isPublic?C.accent:C.bg3,position:'relative',transition:'background 0.2s'}}>
            <span style={{position:'absolute',top:2,width:20,height:20,borderRadius:'50%',background:'#fff',
              transition:'left 0.2s',left:isPublic?'calc(100% - 22px)':'2px'}}/>
          </button>
          <span style={{fontSize:12,color:C.muted,...MONO}}>
            Public profile {username?`(metal-vault.app/p/${username})`:''} 
          </span>
        </div>

        {username&&isPublic&&(
          <div style={{background:'#001a00',border:'1px solid #166534',borderRadius:6,padding:'8px 12px',marginBottom:12,fontSize:10,color:'#4ade80',...MONO}}>
            🌐 {process.env.NEXT_PUBLIC_APP_URL||'https://your-app.vercel.app'}/p/{username}
          </div>
        )}

        <button onClick={saveProfile} disabled={saving}
          style={{width:'100%',padding:'11px',background:'linear-gradient(135deg,'+C.accent+','+C.accent2+')',
            border:'none',borderRadius:8,color:'#fff',cursor:'pointer',...BEBAS,fontSize:16,letterSpacing:'0.08em'}}>
          {saving?'SAVING…':'SAVE PROFILE'}
        </button>
        {msg&&<div style={{fontSize:11,color:msg.startsWith('✓')?'#4ade80':'#f87171',...MONO,marginTop:8,textAlign:'center'}}>{msg}</div>}
      </div>

      {/* Followed artists */}
      {followedArtists.length>0&&(
        <div style={{background:C.bg2,border:'1px solid '+C.border,borderRadius:12,padding:'16px',marginBottom:16}}>
          <div style={{fontSize:10,color:C.accent,letterSpacing:'0.2em',textTransform:'uppercase',...MONO,marginBottom:10}}>
            Followed artists ({followedArtists.length})
          </div>
          <div style={{display:'flex',flexWrap:'wrap',gap:6}}>
            {followedArtists.map(a=>(
              <span key={a.id} style={{fontSize:11,padding:'5px 10px',borderRadius:20,
                background:C.bg3,color:C.muted,border:'1px solid '+C.border,...MONO}}>
                {a.artist_name} 🔔
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Push notifications */}
      <div style={{background:C.bg2,border:'1px solid '+C.border,borderRadius:12,padding:'16px',marginBottom:12}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
          <div>
            <div style={{fontSize:10,color:C.accent,letterSpacing:'0.2em',textTransform:'uppercase',...MONO,marginBottom:4}}>Push Notifications</div>
            <div style={{fontSize:11,color:C.dim,...MONO}}>Price alerts on your phone</div>
          </div>
          <button onClick={onTogglePush} disabled={pushLoading}
            style={{width:52,height:28,borderRadius:14,border:'none',cursor:'pointer',flexShrink:0,
              background:pushEnabled?C.accent:'#333',position:'relative',transition:'background 0.2s',opacity:pushLoading?0.6:1}}>
            <span style={{position:'absolute',top:3,width:22,height:22,borderRadius:'50%',background:'#fff',
              transition:'left 0.2s',left:pushEnabled?'calc(100% - 25px)':'3px'}}/>
          </button>
        </div>
        {pushEnabled&&<div style={{fontSize:10,color:'#4ade80',...MONO,marginTop:6}}>✓ Enabled — you will receive price alerts</div>}
      </div>

      {/* Discogs OAuth */}
      <div style={{background:C.bg2,border:'1px solid '+C.border,borderRadius:12,padding:'16px',marginBottom:12}}>
        <div style={{fontSize:10,color:C.accent,letterSpacing:'0.2em',textTransform:'uppercase',...MONO,marginBottom:8}}>Discogs Account</div>
        {discogsConnected?(
          <div style={{fontSize:12,color:'#4ade80',...MONO}}>✓ Connected to Discogs</div>
        ):(
          <button onClick={onConnectDiscogs}
            style={{width:'100%',padding:'10px',background:'#1a1a00',border:'1px solid #555500',borderRadius:8,color:'#f5c842',cursor:'pointer',...MONO,fontSize:12}}>
            🔗 Connect Discogs (one-click import)
          </button>
        )}
      </div>

      {/* Import */}
      <div style={{background:C.bg2,border:'1px solid '+C.border,borderRadius:12,padding:'16px',marginBottom:12}}>
        <div style={{fontSize:10,color:C.accent,letterSpacing:'0.2em',textTransform:'uppercase',...MONO,marginBottom:8}}>Import from Discogs</div>
        <button onClick={onShowImport}
          style={{width:'100%',padding:'10px',background:C.accent+'22',border:'1px solid '+C.accent+'44',borderRadius:8,color:C.accent,cursor:'pointer',...MONO,fontSize:12}}>
          ⬇ Open Discogs Import
        </button>
      </div>

      {/* Export */}
      <div style={{background:C.bg2,border:'1px solid '+C.border,borderRadius:12,padding:'16px',marginBottom:12}}>
        <div style={{fontSize:10,color:C.accent,letterSpacing:'0.2em',textTransform:'uppercase',...MONO,marginBottom:8}}>Export Collection</div>
        <div style={{display:'flex',gap:8}}>
          <a href="/api/collection/export?format=csv" download
            style={{flex:1,padding:'9px',background:C.bg3,border:'1px solid '+C.border,borderRadius:7,color:C.muted,textDecoration:'none',textAlign:'center',fontSize:11,...MONO}}>
            📊 CSV / Excel
          </a>
          <a href="/api/collection/export?format=json" download
            style={{flex:1,padding:'9px',background:C.bg3,border:'1px solid '+C.border,borderRadius:7,color:C.muted,textDecoration:'none',textAlign:'center',fontSize:11,...MONO}}>
            {'{ }' } JSON
          </a>
        </div>
      </div>

      {/* Share */}
      <div style={{background:C.bg2,border:'1px solid '+C.border,borderRadius:12,padding:'16px',marginBottom:12}}>
        <div style={{fontSize:10,color:C.accent,letterSpacing:'0.2em',textTransform:'uppercase',...MONO,marginBottom:8}}>Share Collection</div>
        {shareToken?(
          <div>
            <div style={{fontSize:10,color:'#60a5fa',...MONO,wordBreak:'break-all',marginBottom:8,lineHeight:1.5}}>
              {typeof window!=='undefined'?window.location.origin:''}/share/{shareToken}
            </div>
            <button onClick={()=>navigator.clipboard?.writeText((typeof window!=='undefined'?window.location.origin:'')+'/share/'+shareToken).then(()=>alert('Copied!'))}
              style={{width:'100%',padding:'8px',background:C.bg3,border:'1px solid '+C.border,borderRadius:7,color:C.muted,cursor:'pointer',fontSize:11,...MONO}}>
              📋 Copy share link
            </button>
          </div>
        ):(
          <button onClick={onGetShareToken}
            style={{width:'100%',padding:'10px',background:C.bg3,border:'1px solid '+C.border,borderRadius:8,color:C.muted,cursor:'pointer',...MONO,fontSize:12}}>
            🔗 Generate share link
          </button>
        )}
      </div>

      {/* Sign out */}
      <button onClick={onSignOut}
        style={{width:'100%',padding:'12px',background:'none',border:'1px solid '+C.border,
          borderRadius:10,color:C.dim,cursor:'pointer',...MONO,fontSize:12}}>
        Sign out
      </button>
    </div>
  );
}

// ── Watchlist Tab ─────────────────────────────────────────────
function WatchlistTab({watchlist,onRemove,onAlbumClick,user}){
  const [sort,setSort]=useState('added');
  const [alertItem,setAlertItem]=useState(null);
  const [alertPrice,setAlertPrice]=useState('');
  const [alertSaving,setAlertSaving]=useState(false);
  const [alertDone,setAlertDone]=useState({});

  const sorted=[...watchlist].sort((a,b)=>{
    if(sort==='artist')return(a.artist||'').localeCompare(b.artist||'');
    if(sort==='year')  return(b.release_date||'0').localeCompare(a.release_date||'0');
    return 0; // added = original order
  });

  const saveAlert=async(album)=>{
    if(!alertPrice||isNaN(alertPrice)||!user)return;
    setAlertSaving(true);
    await fetch('/api/alerts',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        discogs_id:album.album_id||album.id,
        artist:album.artist, album:album.album,
        target_price:parseFloat(alertPrice),
      })
    });
    setAlertDone(d=>({...d,[album.album_id||album.id]:parseFloat(alertPrice)}));
    setAlertSaving(false);setAlertItem(null);setAlertPrice('');
  };

  if(watchlist.length===0)return(
    <div style={{textAlign:'center',padding:'80px 24px',color:C.dim,...MONO}}>
      <div style={{fontSize:48,marginBottom:16}}>☆</div>
      <div style={{fontSize:14,lineHeight:1.6}}>
        No watched albums yet.<br/>
        <span style={{color:C.accent}}>Click ☆</span> on any album.
        {!user&&<><br/><span style={{fontSize:11,color:C.dim}}>Sign in to sync across devices.</span></>}
      </div>
    </div>
  );
  return(
    <div style={{padding:'16px'}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
        <div style={{fontSize:10,color:C.dim,...MONO,letterSpacing:'0.15em',textTransform:'uppercase'}}>
          {watchlist.length} {watchlist.length===1?'album':'albums'}
          {user&&<span style={{color:'#4ade80'}}> · synced ✓</span>}
        </div>
        <select value={sort} onChange={e=>setSort(e.target.value)}
          style={{background:C.bg3,border:'1px solid '+C.border,borderRadius:6,color:C.muted,
            padding:'5px 8px',fontSize:11,...MONO,cursor:'pointer',outline:'none'}}>
          <option value="added">Added order</option>
          <option value="artist">Artist A–Z</option>
          <option value="year">Year</option>
        </select>
      </div>
      <div style={{display:'flex',flexDirection:'column',gap:8}}>
        {sorted.map(album=>{
          const id=album.id||album.album_id;
          const hasAlert=alertDone[id];
          return(
          <div key={id} style={{background:C.bg2,border:'1px solid '+C.border,borderRadius:12,overflow:'hidden'}}>
            <div style={{padding:'12px 14px',display:'flex',gap:12,alignItems:'center'}}>
              <div onClick={()=>onAlbumClick(album)} style={{display:'flex',gap:12,flex:1,alignItems:'center',cursor:'pointer'}}>
                <AlbumCover src={album.cover} artist={album.artist} size={52}/>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{...BEBAS,fontSize:17,color:C.text,lineHeight:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{album.artist}</div>
                  <div style={{fontSize:11,color:C.muted,...MONO,marginTop:2,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{album.album}</div>
                  <div style={{fontSize:10,color:C.dim,...MONO,marginTop:3}}>{album.release_date||album.releaseDate}</div>
                  {hasAlert&&<div style={{fontSize:10,color:'#f5c842',...MONO,marginTop:2}}>🔔 Alert: ≤${hasAlert}</div>}
                </div>
              </div>
              <div style={{display:'flex',flexDirection:'column',gap:4,flexShrink:0}}>
                <button onClick={()=>{setAlertItem(alertItem===id?null:id);setAlertPrice('');}}
                  style={{background:'none',border:'none',color:alertItem===id||hasAlert?'#f5c842':'#444',cursor:'pointer',fontSize:16,padding:'2px'}}
                  title="Set price alert">🔔</button>
                <button onClick={()=>onRemove(id)}
                  style={{background:'none',border:'none',color:'#333',cursor:'pointer',fontSize:18,padding:'2px'}}
                  onMouseEnter={e=>e.currentTarget.style.color=C.accent}
                  onMouseLeave={e=>e.currentTarget.style.color='#333'}>×</button>
              </div>
            </div>
            {alertItem===id&&(
              <div style={{borderTop:'1px solid '+C.border,padding:'10px 14px',background:'#1a0a00',borderRadius:'0 0 10px 10px'}}>
                <div style={{fontSize:10,color:'#f5c842',...MONO,marginBottom:6}}>
                  🔔 Alert when price drops below
                </div>
                <div style={{display:'flex',gap:6,alignItems:'center',marginBottom:6}}>
                  <span style={{...BEBAS,fontSize:18,color:C.muted}}>$</span>
                  <input type="number" value={alertPrice} onChange={e=>setAlertPrice(e.target.value)}
                    onKeyDown={e=>e.key==='Enter'&&saveAlert(album)}
                    placeholder="e.g. 25" autoFocus
                    style={{flex:1,background:C.bg3,border:'1px solid '+C.border,
                      borderRadius:8,color:C.text,padding:'10px 12px',fontSize:20,...MONO,outline:'none'}}/>
                  <button onClick={()=>saveAlert(album)} disabled={alertSaving||!user}
                    style={{padding:'10px 18px',background:!user||alertSaving?C.bg3:C.accent,
                      border:'none',borderRadius:8,color:'#fff',cursor:!user?'default':'pointer',
                      ...BEBAS,fontSize:17,flexShrink:0}}>
                    {alertSaving?'…':'SET'}
                  </button>
                </div>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                  <span style={{fontSize:10,...MONO,color:hasAlert?'#4ade80':'#f87171'}}>{hasAlert?'✓ Active: $'+hasAlert:!user?'Sign in required':''}</span>
                  <button onClick={()=>{setAlertItem(null);setAlertPrice('');}} style={{fontSize:10,color:C.dim,...MONO,background:'none',border:'none',cursor:'pointer'}}>Cancel</button>
                </div>
              </div>
            )}
          </div>
        )})}
      </div>
    </div>
  );
}

// ── Bottom Nav ────────────────────────────────────────────────
function BottomNav({tab,onChange,watchCount,user}){
  const tabs=[
    {id:'feed',      icon:'🔥', label:'Feed'},
    {id:'search',    icon:'🔍', label:'Search'},
    {id:'collection',icon:'📦', label:'Vault'},
    {id:'calendar',  icon:'📅', label:'Calendar'},
    {id:'concerts',  icon:'🎸', label:'Live'},
    {id:'stats',     icon:'📊', label:'Stats'},
    {id:'profile',   icon:'👤', label:user?'Me':'Login'},
  ];
  return(
    <div style={{position:'fixed',bottom:0,left:0,right:0,background:'#0d0d0d',
      borderTop:'1px solid '+C.border,display:'flex',zIndex:100,
      paddingBottom:'env(safe-area-inset-bottom,0px)',
      boxShadow:'0 -4px 20px #00000088'}}>
      {tabs.map(t=>(
        <button key={t.id} onClick={()=>onChange(t.id)}
          style={{flex:1,padding:'6px 1px 5px',background:'none',border:'none',cursor:'pointer',
            display:'flex',flexDirection:'column',alignItems:'center',gap:1,position:'relative',
            borderTop:tab===t.id?'2px solid '+C.accent:'2px solid transparent'}}>
          {t.badge&&(
            <div style={{position:'absolute',top:4,right:'18%',background:C.accent,borderRadius:10,
              minWidth:16,height:16,display:'flex',alignItems:'center',justifyContent:'center',
              fontSize:9,...MONO,color:'#fff',padding:'0 4px'}}>
              {t.badge}
            </div>
          )}
          <span style={{fontSize:tab===t.id?20:17,color:t.id==='watchlist'?'#f5c842':tab===t.id?'#fff':'#666',
            transition:'all 0.15s'}}>{t.icon}</span>
          <span style={{fontSize:8,color:tab===t.id?C.accent:'#444',...MONO,letterSpacing:'0.02em',
            fontWeight:tab===t.id?'700':'400'}}>{t.label}</span>
        </button>
      ))}
    </div>
  );
}

// ── Main App ──────────────────────────────────────────────────
const FILTERS=[
  {id:'all',     label:'⚡ All'},
  {id:'new',     label:'🔥 New'},
  {id:'preorder',label:'⏳ Pre-order'},
  {id:'limited', label:'💎 Limited'},
  {id:'vinyl',   label:'💿 Has Vinyl'},
];
const ALL_GENRES=['Heavy Metal','Death Metal','Black Metal','Thrash Metal','Doom Metal','Progressive Metal','Power Metal','Metalcore','Groove Metal','Nu-Metal','Symphonic Metal','Sludge Metal','Industrial Metal','Folk Metal','Post-Metal'];
const SORT_OPTIONS=[
  {id:'date_desc', label:'Newest first'},
  {id:'date_asc',  label:'Oldest first'},
  {id:'artist',    label:'Artist A–Z'},
];

export default function MetalVault(){
  const supabase=createClient();

  // Auth
  const [user,setUser]=useState(null);
  const [profile,setProfile]=useState(null);

  // Feed
  const [releases,setReleases]=useState([]);
  const [source,setSource]=useState('');
  const [feedLoading,setFeedLoading]=useState(true);
  const [feedError,setFeedError]=useState('');

  // Filters
  const [tab,setTab]=useState('feed');
  const [filter,setFilter]=useState('all');
  const [sort,setSort]=useState('date_desc');
  const [search,setSearch]=useState('');

  // Watchlist + Collection
  const [watchlist,setWatchlist]=useState([]);
  const [collection,setCollection]=useState([]);
  const [followedArtists,setFollowedArtists]=useState([]);
  const [portfolio,setPortfolio]=useState(null);

  const [showImportModal,setShowImportModal]=useState(false);
  const [showScanner,setShowScanner]=useState(false);
  const [genreInterests,setGenreInterests]=useState(()=>loadLS('mv_genre_interests',[]));
  const [showGenrePicker,setShowGenrePicker]=useState(false);
  const [collectionSummary,setCollectionSummary]=useState(null);
  const [pushEnabled,setPushEnabled]=useState(false);
  const [pushLoading,setPushLoading]=useState(false);
  const [shareToken,setShareToken]=useState(null);
  const [discogsConnected,setDiscogsConnected]=useState(false);

  // Vinyl data
  const [vinylCache,setVinylCache]=useState({});
  const [selected,setSelected]=useState(null);
  const [vinylLoading,setVinylLoading]=useState(false);
  const [vinylError,setVinylError]=useState('');

  // ── Auth listener ────────────────────────────────────────────
  useEffect(()=>{
    supabase.auth.getSession().then(({data:{session}})=>{
      setUser(session?.user||null);
      if(session?.user)loadUserData(session.user);
    });
    const {data:{subscription}}=supabase.auth.onAuthStateChange((_,session)=>{
      setUser(session?.user||null);
      if(session?.user)loadUserData(session.user);
      else{setWatchlist(loadLS(LS_WL,[]));setCollection([]);setFollowedArtists([]);}
    });
    return()=>subscription.unsubscribe();
  },[]);

  // ── Load offline cache ───────────────────────────────────────
  useEffect(()=>{
    setVinylCache(loadLS(LS_VC,{}));
    // Check push subscription status
    if('serviceWorker' in navigator&&'PushManager' in window){
      navigator.serviceWorker.ready.then(reg=>reg.pushManager.getSubscription()).then(sub=>setPushEnabled(!!sub)).catch(()=>{});
    }
    // Check URL params for OAuth callbacks
    const params=new URLSearchParams(window.location.search);
    if(params.get('discogs_connected')){setDiscogsConnected(true);window.history.replaceState({},'','/');} 
    if(!user)setWatchlist(loadLS(LS_WL,[]));
  },[]);

  // ── Load feed ────────────────────────────────────────────────
  useEffect(()=>{
    fetch('/api/releases')
      .then(r=>r.json())
      .then(d=>{setReleases(d.releases||[]);setSource(d.source||'');setFeedLoading(false);})
      .catch(e=>{setFeedError(e.message);setFeedLoading(false);});
  },[]);

  // ── Load user data from Supabase ─────────────────────────────
  async function loadUserData(u){
    try{
      const [wl,coll,arts,port,prof]=await Promise.all([
        fetch('/api/watchlist').then(r=>r.json()),
        fetch('/api/collection').then(r=>r.json()),
        fetch('/api/artists').then(r=>r.json()),
        fetch('/api/portfolio').then(r=>r.json()),
        supabase.from('profiles').select('*').eq('id',u.id).single(),
      ]);
      if(wl.items)setWatchlist(wl.items);
      if(coll.items)setCollection(coll.items);
      if(coll.summary)setCollectionSummary(coll.summary);
      if(arts.artists)setFollowedArtists(arts.artists);
      if(port.snapshots)setPortfolio(port);
      if(prof.data)setProfile(prof.data);
    }catch(e){console.error('loadUserData',e);}
  }

  // ── Fetch vinyl data ─────────────────────────────────────────
  const fetchVinyl=useCallback(async(album)=>{
    const cacheKey=album.id;
    if(vinylCache[cacheKey])return;
    setVinylLoading(true);setVinylError('');
    try{
      const params=new URLSearchParams({artist:album.artist,album:album.album});
      const r=await fetch(`/api/discogs?${params}`);
      const d=await r.json();
      if(!r.ok)throw new Error(d.error||'Discogs error');
      const updated={...vinylCache,[cacheKey]:d};
      setVinylCache(updated);saveLS(LS_VC,updated);
    }catch(e){setVinylError(e.message);}
    setVinylLoading(false);
  },[vinylCache]);

  const openAlbum=(album)=>{setSelected(album);setVinylError('');fetchVinyl(album);};

  // ── Watchlist ────────────────────────────────────────────────
  const toggleWatch=async(album)=>{
    const albumId=album.id||album.album_id;
    const exists=watchlist.some(w=>(w.id||w.album_id)===albumId);
    if(user){
      if(exists){
        await fetch(`/api/watchlist?album_id=${albumId}`,{method:'DELETE'});
        setWatchlist(w=>w.filter(x=>(x.album_id||x.id)!==albumId));
      }else{
        const r=await fetch('/api/watchlist',{method:'POST',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({album_id:albumId,artist:album.artist,album:album.album,cover:album.cover,release_date:album.releaseDate,spotify_url:album.spotifyUrl})});
        const d=await r.json();
        if(d.item)setWatchlist(w=>[d.item,...w]);
      }
    }else{
      const updated=exists?watchlist.filter(w=>w.id!==albumId):[...watchlist,{id:albumId,...album}];
      setWatchlist(updated);saveLS(LS_WL,updated);
    }
  };

  // ── Collection ───────────────────────────────────────────────
  const addToCollection=async(item)=>{
    if(!user){alert('Sign in to manage your collection');return;}
    const r=await fetch('/api/collection',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(item)});
    const d=await r.json();
    if(d.item){
      setCollection(c=>[d.item,...c]);
      // Refresh portfolio and collection to get updated prices
      const [port,coll]=await Promise.all([
        fetch('/api/portfolio').then(r=>r.json()),
        fetch('/api/collection').then(r=>r.json()),
      ]);
      setPortfolio(port);
      if(coll.items)setCollection(coll.items);
      if(coll.summary)setCollectionSummary(coll.summary);
    }
    setSelected(null);
  };
  // Batch import - no portfolio refresh per item, refresh once at end
  const batchImportCollection=async(item)=>{
    if(!user)return;
    const r=await fetch('/api/collection',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(item)});
    const d=await r.json();
    if(d.item)setCollection(c=>{
      if(c.some(x=>x.discogs_id===item.discogs_id))return c;
      return [d.item,...c];
    });
  };
  const batchImportWatchlist=async(item)=>{
    if(!user)return;
    const r=await fetch('/api/watchlist',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(item)});
    const d=await r.json();
    if(d.item)setWatchlist(w=>{
      if(w.some(x=>(x.album_id||x.id)===item.album_id))return w;
      return [d.item,...w];
    });
  };
  const removeFromCollection=async(id)=>{
    await fetch(`/api/collection?id=${id}`,{method:'DELETE'});
    setCollection(c=>c.filter(x=>x.id!==id));
    const port=await fetch('/api/portfolio').then(r=>r.json());setPortfolio(port);
  };

  // ── Artist follows ───────────────────────────────────────────
  const toggleFollow=async(artistName)=>{
    if(!user)return;
    const exists=followedArtists.some(a=>a.artist_name===artistName);
    if(exists){
      await fetch(`/api/artists?artist_name=${encodeURIComponent(artistName)}`,{method:'DELETE'});
      setFollowedArtists(a=>a.filter(x=>x.artist_name!==artistName));
    }else{
      const r=await fetch('/api/artists',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({artist_name:artistName})});
      const d=await r.json();
      if(d.artist)setFollowedArtists(a=>[d.artist,...a]);
    }
  };

  // ── Sign out ─────────────────────────────────────────────────
  const togglePush=async()=>{
    if(!user){alert('Sign in first');return;}
    setPushLoading(true);
    try{
      if(pushEnabled){
        const reg=await navigator.serviceWorker.ready;
        const sub=await reg.pushManager.getSubscription();
        if(sub){await sub.unsubscribe();await fetch('/api/push/subscribe',{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({endpoint:sub.endpoint})});}
        setPushEnabled(false);
      }else{
        const reg=await navigator.serviceWorker.ready;
        const {publicKey}=await fetch('/api/push/subscribe').then(r=>r.json());
        if(!publicKey){alert('Push not configured — add VAPID keys to Vercel');setPushLoading(false);return;}
        const perm=await Notification.requestPermission();
        if(perm!=='granted'){setPushLoading(false);return;}
        const sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:publicKey});
        await fetch('/api/push/subscribe',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({subscription:sub})});
        setPushEnabled(true);
      }
    }catch(e){console.error('Push error',e);}
    setPushLoading(false);
  };

  const getShareToken=async()=>{
    if(!user)return;
    const r=await fetch('/api/share');
    const d=await r.json();
    if(d.token)setShareToken(d.token);
    else{const cr=await fetch('/api/share',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({label:'My Collection'})});const cd=await cr.json();setShareToken(cd.token);}
  };

  const connectDiscogs=async()=>{
    const r=await fetch('/api/discogs/oauth');
    const d=await r.json();
    if(d.authorizeUrl){window.location.href=d.authorizeUrl;}
    else if(d.helpUrl){
      if(window.confirm(d.error+'\n\nOpen Discogs developers page?')){window.open(d.helpUrl,'_blank');}
    }
    else alert(d.error||'Failed to connect Discogs');
  };

  const signOut=async()=>{await supabase.auth.signOut();setUser(null);setWatchlist([]);setCollection([]);setFollowedArtists([]);setPortfolio(null);};

  // ── Filtered feed ────────────────────────────────────────────
  const today=new Date();
  const filtered=releases.filter(r=>{
    const rd=new Date(r.releaseDate);
    const isPreorder=rd>today;
    const isNew=(today-rd)/(1000*60*60*24)<45&&!isPreorder;
    const vinyl=vinylCache[r.id];
    if(filter==='new')     return isNew;
    if(filter==='preorder')return isPreorder;
    if(filter==='limited') return vinyl?.hasLimited===true;
    if(filter==='vinyl')   return vinyl?.hasVinyl===true;
    return true;
  }).filter(r=>!search||r.artist.toLowerCase().includes(search.toLowerCase())||r.album.toLowerCase().includes(search.toLowerCase()))
  .sort((a,b)=>{
    if(sort==='date_desc')return new Date(b.releaseDate)-new Date(a.releaseDate);
    if(sort==='date_asc') return new Date(a.releaseDate)-new Date(b.releaseDate);
    if(sort==='artist')   return a.artist.localeCompare(b.artist);
    return 0;
  });

  const isWatched=id=>watchlist.some(w=>(w.id||w.album_id)===id);
  const isFollowed=name=>followedArtists.some(a=>a.artist_name===name);

  return(
    <div style={{minHeight:'100vh',background:C.bg,maxWidth:600,margin:'0 auto'}}>

      {/* Header */}
      <div style={{background:C.bg,borderBottom:'1px solid '+C.border,padding:'14px 16px 12px',position:'sticky',top:0,zIndex:50}}>
        <div style={{display:'flex',alignItems:'baseline',justifyContent:'space-between'}}>
          <div>
            <div style={{...BEBAS,fontSize:30,letterSpacing:'0.08em',color:C.text,lineHeight:1}}>METAL VAULT</div>
            <div style={{fontSize:9,color:C.accent,...MONO,letterSpacing:'0.2em',textTransform:'uppercase'}}>
              {tab==='feed'?'RELEASES':tab==='watchlist'?'WATCHLIST':tab==='collection'?'COLLECTION':'PROFILE'}
            </div>
          </div>
          {user&&<div style={{fontSize:10,color:'#4ade80',...MONO}}>✓ {user.email?.split('@')[0]}</div>}
        </div>
        {source==='mock'&&<div style={{fontSize:9,color:'#555',...MONO,marginTop:2}}>⚠ Demo mode — configure SPOTIFY_CLIENT_ID</div>}
      </div>

      <div style={{paddingBottom:100}}>
        {/* FEED TAB */}
        {tab==='feed'&&(
          <>
            {!feedLoading&&releases.length>0&&<StatsBar releases={releases}/>}
            <div style={{display:'flex',gap:6,padding:'10px 16px',overflow:'auto',borderBottom:'1px solid '+C.border}}>
              {FILTERS.map(f=>(
                <button key={f.id} onClick={()=>setFilter(f.id)}
                  style={{padding:'6px 12px',borderRadius:20,whiteSpace:'nowrap',
                    background:filter===f.id?C.accent+'22':C.bg3,
                    color:filter===f.id?C.accent:C.dim,
                    border:'1px solid '+(filter===f.id?C.accent+'66':C.border),
                    cursor:'pointer',fontSize:11,...MONO}}>
                  {f.label}
                </button>
              ))}
            </div>
            <div style={{padding:'10px 16px 0',display:'flex',gap:8}}>
              <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search artist, album…" style={{...inputSt,flex:1}}/>
              <select value={sort} onChange={e=>setSort(e.target.value)}
                style={{background:C.bg3,border:'1px solid '+C.border,borderRadius:8,color:C.muted,
                  padding:'0 10px',fontSize:13,...MONO,cursor:'pointer',outline:'none',flexShrink:0}}>
                <option value="date_desc">Newest</option>
                <option value="date_asc">Oldest</option>
                <option value="artist">A–Z</option>
              </select>
            </div>
            {!feedLoading&&(
              <div style={{padding:'4px 16px 4px',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                <div style={{fontSize:10,color:C.dim,...MONO}}>{filtered.length} release{filtered.length!==1?'s':''}{genreInterests.length>0?' · filtered':''}</div>
                <button onClick={()=>setShowGenrePicker(p=>!p)}
                  style={{fontSize:10,color:genreInterests.length>0?C.accent:C.dim,...MONO,background:'none',border:'none',cursor:'pointer',padding:'2px 4px'}}>
                  🎸 {genreInterests.length>0?genreInterests.length+' genres':'genres'}
                </button>
              </div>
            )}
            {showGenrePicker&&(
              <div style={{padding:'8px 16px 12px',borderBottom:'1px solid '+C.border,background:C.bg2}}>
                <div style={{fontSize:9,color:C.dim,...MONO,letterSpacing:'0.12em',textTransform:'uppercase',marginBottom:6}}>Tap to filter by genre</div>
                <div style={{display:'flex',flexWrap:'wrap',gap:5}}>
                  {ALL_GENRES.map(g=>{
                    const active=genreInterests.includes(g);
                    return(
                      <button key={g} onClick={()=>{
                        const next=active?genreInterests.filter(x=>x!==g):[...genreInterests,g];
                        setGenreInterests(next);
                        try{localStorage.setItem('mv_genre_interests',JSON.stringify(next));}catch{}
                      }}
                        style={{fontSize:10,padding:'4px 9px',borderRadius:20,...MONO,cursor:'pointer',
                          background:active?C.accent+'22':C.bg3,
                          color:active?C.accent:C.dim,
                          border:'1px solid '+(active?C.accent+'66':C.border)}}>
                        {g}
                      </button>
                    );
                  })}
                  {genreInterests.length>0&&(
                    <button onClick={()=>{setGenreInterests([]);try{localStorage.removeItem('mv_genre_interests');}catch{}}}
                      style={{fontSize:10,padding:'4px 9px',borderRadius:20,...MONO,cursor:'pointer',background:'#1a0000',color:'#f87171',border:'1px solid #7f1d1d'}}>
                      ✕ Clear all
                    </button>
                  )}
                </div>
              </div>
            )}
            {feedLoading&&<div style={{textAlign:'center',padding:'80px 24px',color:C.dim,...MONO}}><div style={{fontSize:32,marginBottom:12}}>⟳</div>Loading…</div>}
            {feedError&&<div style={{margin:'16px',background:'#1a0000',border:'1px solid '+C.accent+'44',borderRadius:8,padding:'12px 14px',color:'#f87171',fontSize:12,...MONO}}>⚠ {feedError}</div>}
            {!feedLoading&&!feedError&&(
              <div style={{display:'flex',flexDirection:'column',gap:8,padding:'10px 16px 16px'}}>
                {filtered.map(album=>(
                  <AlbumCard key={album.id} album={album}
                    isWatched={isWatched(album.id)}
                    onWatchToggle={toggleWatch}
                    onClick={()=>openAlbum(album)}
                    vinylData={vinylCache[album.id]||null}
                    isFollowed={isFollowed(album.artist)}
                    onFollowToggle={toggleFollow}
                    user={user}/>
                ))}
              </div>
            )}
          </>
        )}

        {/* WATCHLIST TAB */}
        {tab==='watchlist'&&( /* legacy - now in Vault */
          <WatchlistTab watchlist={watchlist} onRemove={async(id)=>{
            if(user)await fetch('/api/watchlist?album_id='+id,{method:'DELETE'});
            setWatchlist(w=>w.filter(x=>(x.album_id||x.id)!==id));
          }} onAlbumClick={openAlbum} user={user}/>
        )}

        {/* COLLECTION TAB */}
        {tab==='collection'&&(
          <CollectionTab user={user} collection={collection} watchlist={watchlist}
            onRemoveWatch={async(id)=>{
              if(user)await fetch('/api/watchlist?album_id='+id,{method:'DELETE'});
              setWatchlist(w=>w.filter(x=>(x.album_id||x.id)!==id));
            }}
            onAlbumClick={openAlbum} onRemove={removeFromCollection} onUpdate={setCollection} portfolio={portfolio}/>
        )}

        {/* SEARCH TAB */}
        {tab==='search'&&(
          <SearchTab
            onWatch={toggleWatch}
            onAddCollection={addToCollection}
            watchlist={watchlist}
            collection={collection}
          />
        )}

        {/* CALENDAR TAB */}
        {tab==='calendar'&&(
          <CalendarTab releases={releases} followedArtists={followedArtists}/>
        )}

        {/* CONCERTS TAB */}
        {tab==='concerts'&&(
          <ConcertsTab/>
        )}

        {/* STATS TAB */}
        {tab==='stats'&&(
          <StatsTab
            collection={collection}
            watchlist={watchlist}
            collectionSummary={collectionSummary}
          />
        )}

        {/* SCANNER TAB */}
        {tab==='scan'&&(
          <ScannerTab
            onAddToCollection={addToCollection}
            onAddToWatchlist={toggleWatch}
            collection={collection}
            watchlist={watchlist}
          />
        )}

        {/* PROFILE TAB */}
        {tab==='profile'&&(
          user?(
            <ProfileTab user={user} profile={profile} followedArtists={followedArtists}
              onSignOut={signOut} onUpdateProfile={setProfile} onShowImport={()=>setShowImportModal(true)}
              pushEnabled={pushEnabled} pushLoading={pushLoading} onTogglePush={togglePush}
              discogsConnected={discogsConnected} onConnectDiscogs={connectDiscogs}
              shareToken={shareToken} onGetShareToken={getShareToken}/>
          ):(
            <div style={{textAlign:'center',padding:'80px 24px'}}>
              <div style={{...BEBAS,fontSize:40,color:C.text,marginBottom:8,lineHeight:1}}>METAL VAULT</div>
              <div style={{fontSize:12,color:C.dim,...MONO,marginBottom:32,lineHeight:1.7}}>
                Sign in to sync your watchlist,<br/>manage your collection and get price alerts.
              </div>
              <button onClick={()=>window.location.href='/login'}
                style={{background:'linear-gradient(135deg,'+C.accent+','+C.accent2+')',border:'none',borderRadius:12,
                  color:'#fff',padding:'15px 32px',...BEBAS,fontSize:22,letterSpacing:'0.1em',cursor:'pointer'}}>
                SIGN IN
              </button>
            </div>
          )
        )}
      </div>

      <BottomNav tab={tab} onChange={setTab} watchCount={watchlist.length} user={user}/>

      {/* Floating scan button */}
      {(tab==='feed'||tab==='search'||tab==='collection')&&(
        <button onClick={()=>setShowScanner(true)}
          style={{position:'fixed',bottom:80,right:16,zIndex:90,
            width:52,height:52,borderRadius:'50%',
            background:'linear-gradient(135deg,'+C.accent+','+C.accent2+')',
            border:'none',color:'#fff',cursor:'pointer',fontSize:22,
            boxShadow:'0 4px 20px rgba(220,38,38,0.4)',
            display:'flex',alignItems:'center',justifyContent:'center'}}>
          📷
        </button>
      )}

      {showScanner&&(
        <div style={{position:'fixed',inset:0,background:'#000000cc',zIndex:200,display:'flex',flexDirection:'column',justifyContent:'flex-end'}}
          onClick={e=>e.target===e.currentTarget&&setShowScanner(false)}>
          <div style={{background:C.bg2,borderRadius:'16px 16px 0 0',maxHeight:'92vh',overflow:'auto',paddingBottom:'env(safe-area-inset-bottom,24px)'}}>
            <div style={{width:40,height:4,background:'#333',borderRadius:2,margin:'12px auto 0'}}/>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'12px 16px 0'}}>
              <div style={{...BEBAS,fontSize:22,color:C.text,letterSpacing:'0.06em'}}>BARCODE SCANNER</div>
              <button onClick={()=>setShowScanner(false)}
                style={{background:'none',border:'none',color:C.muted,cursor:'pointer',fontSize:24,padding:'0 4px'}}>×</button>
            </div>
            <ScannerTab
              onAddToCollection={addToCollection}
              onAddToWatchlist={toggleWatch}
              collection={collection}
              watchlist={watchlist}
            />
          </div>
        </div>
      )}

      {showImportModal&&(
        <div style={{position:'fixed',inset:0,background:'#000000cc',zIndex:200,display:'flex',flexDirection:'column',justifyContent:'flex-end'}}
          onClick={e=>e.target===e.currentTarget&&setShowImportModal(false)}>
          <div style={{background:C.bg2,borderRadius:'16px 16px 0 0',maxHeight:'92vh',overflow:'auto',paddingBottom:'env(safe-area-inset-bottom,24px)'}}>
            <div style={{width:40,height:4,background:'#333',borderRadius:2,margin:'12px auto 0'}}/>
            <DiscogsImport user={user} onImportCollection={batchImportCollection} onImportWatchlist={batchImportWatchlist}/>
          </div>
        </div>
      )}

      {selected&&(
        <VinylModal album={selected}
          onClose={()=>{setSelected(null);setVinylError('');}}
          onWatchToggle={toggleWatch}
          isWatched={isWatched(selected.id)}
          onAddToCollection={addToCollection}
          vinylData={vinylCache[selected.id]||null}
          loading={vinylLoading} error={vinylError}/>
      )}
    </div>
  );
}
