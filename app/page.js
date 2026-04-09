'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import { createClient } from '@/lib/supabase';

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

const inputSt = {
  width:'100%',background:C.bg3,border:`1px solid ${C.border}`,
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
      background:s.bg,color:s.color,border:`1px solid ${s.border}`,...MONO,letterSpacing:'0.05em'}}>
      {s.icon} {type}
    </span>
  );
}

function AlbumCover({src,artist='',size=64}){
  const [err,setErr]=useState(false);
  const bg=GENRE_COLOR(artist);
  if(!src||err)return(
    <div style={{width:size,height:size,borderRadius:6,flexShrink:0,
      background:`linear-gradient(135deg,${bg},#0a0a0a)`,
      display:'flex',alignItems:'center',justifyContent:'center',border:`1px solid ${C.border}`}}>
      <span style={{...BEBAS,fontSize:Math.round(size*0.45),color:'#ffffff55'}}>{(artist[0]||'?').toUpperCase()}</span>
    </div>
  );
  return(
    <div style={{width:size,height:size,borderRadius:6,flexShrink:0,overflow:'hidden',border:`1px solid ${C.border}`}}>
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
    return !isNaN(d)&&(today-d)/(1000*60*60*24)<30&&d<=today;
  }).length;
  const preorders = releases.filter(r=>new Date(r.releaseDate)>today).length;
  return(
    <div style={{display:'flex',borderBottom:`1px solid ${C.border}`,background:C.bg2}}>
      {[{icon:'🔥',val:releases.length,label:'in db'},{icon:'🆕',val:newCount,label:'← 30 days'},{icon:'⏳',val:preorders,label:'pre-order'}].map(s=>(
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
    <div onClick={onClick} style={{background:C.bg2,border:`1px solid ${C.border}`,borderRadius:12,
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
            <span style={{fontSize:9,padding:'2px 6px',borderRadius:10,background:C.bg3,color:C.dim,border:`1px solid ${C.border}`,...MONO}}>
              {vinylData.count} variant{vinylData.count!==1?'s':''}
            </span>
          )}
        </div>
        <div style={{fontSize:10,color:C.dim,...MONO,marginTop:5}}>
          {isPreorder?`🗓 Release: ${album.releaseDate}`:album.releaseDate}
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
            style={{background:isWatched?'#2a2200':'none',border:`1px solid ${isWatched?'#92400e':C.border}`,
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
        <div style={{margin:'14px 16px 0',borderTop:`1px solid ${C.border}`}}/>
        <div style={{padding:'14px 16px 16px'}}>
          <div style={{fontSize:10,color:C.accent,letterSpacing:'0.2em',textTransform:'uppercase',...MONO,marginBottom:12}}>
            Vinyl releases · Discogs
          </div>
          {loading&&<div style={{textAlign:'center',padding:'30px 0',color:C.dim,...MONO,fontSize:12}}>⟳ Searching releases…</div>}
          {error&&<div style={{background:'#1a0000',border:`1px solid ${C.accent}44`,borderRadius:8,padding:'12px 14px',color:'#f87171',fontSize:12,...MONO}}>
            {error.includes('not configured')?'⚙ Configure DISCOGS_KEY in Vercel → Environment Variables':`⚠ ${error}`}
          </div>}
          {!loading&&!error&&vinylData?.variants?.length===0&&(
            <div style={{textAlign:'center',padding:'24px 0',color:C.dim,...MONO,fontSize:12}}>No vinyl releases found on Discogs</div>
          )}
          {!loading&&!error&&vinylData?.variants?.length>0&&(
            <div style={{display:'flex',flexDirection:'column',gap:10}}>
              {vinylData.variants.map(v=>(
                <div key={v.id} style={{background:C.bg3,border:`1px solid ${C.border}`,borderRadius:10,padding:'12px 14px'}}>
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
                      style={{flex:1,display:'block',background:C.bg4,border:`1px solid ${C.border}`,
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
    <svg viewBox={`0 0 ${W} ${H}`} style={{width:'100%',height:'auto'}}>
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
function CollectionTab({user,collection,onRemove,onUpdate,portfolio}){
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
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:0,borderBottom:`1px solid ${C.border}`}}>
          {[
            {l:'Records',v:summary.itemCount},
            {l:'Paid',v:summary.totalPurchased>0?`${summary.totalPurchased.toFixed(0)} PLN`:'—'},
            {l:'Gain',v:summary.gain!==0?`${summary.gain>0?'+':''}${summary.gain.toFixed(0)} PLN`:'—',
              color:summary.gain>0?'#4ade80':summary.gain<0?'#f87171':C.muted},
          ].map(s=>(
            <div key={s.l} style={{textAlign:'center',padding:'14px 8px',borderRight:`1px solid ${C.border}`}}>
              <div style={{...BEBAS,fontSize:20,color:s.color||C.accent,lineHeight:1}}>{s.v}</div>
              <div style={{fontSize:9,color:C.dim,...MONO,letterSpacing:'0.1em',textTransform:'uppercase',marginTop:3}}>{s.l}</div>
            </div>
          ))}
        </div>
      )}

      {/* Portfolio chart */}
      {portfolio?.snapshots?.length>=2&&(
        <div style={{padding:'16px',borderBottom:`1px solid ${C.border}`}}>
          <div style={{fontSize:10,color:C.accent,letterSpacing:'0.2em',textTransform:'uppercase',...MONO,marginBottom:10}}>
            Collection value over time
          </div>
          <PortfolioChart snapshots={portfolio.snapshots}/>
        </div>
      )}

      {/* Items */}
      <div style={{padding:'16px'}}>
        <div style={{fontSize:10,color:C.accent,letterSpacing:'0.2em',textTransform:'uppercase',...MONO,marginBottom:12}}>
          My vinyl ({collection.length})
        </div>
        {collection.length===0?(
          <div style={{textAlign:'center',padding:'40px 0',color:C.dim,...MONO,fontSize:12}}>
            <div style={{fontSize:40,marginBottom:10}}>📦</div>
            Collection is empty — add records from album modal
          </div>
        ):(
          <div style={{display:'flex',flexDirection:'column',gap:8}}>
            {collection.map(item=>(
              <div key={item.id} style={{background:C.bg2,border:`1px solid ${C.border}`,borderRadius:10,padding:'12px 14px'}}>
                <div style={{display:'flex',gap:12,alignItems:'flex-start'}}>
                  <AlbumCover src={item.cover} artist={item.artist} size={48}/>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{...BEBAS,fontSize:17,color:C.text,lineHeight:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{item.artist}</div>
                    <div style={{fontSize:11,color:C.muted,...MONO,marginTop:2,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{item.album}</div>
                    <div style={{display:'flex',gap:8,marginTop:5,flexWrap:'wrap',alignItems:'center'}}>
                      {item.format&&<span style={{fontSize:9,color:C.dim,...MONO}}>{item.format}</span>}
                      {item.color&&<span style={{fontSize:9,color:'#aaa',...MONO}}>🎨 {item.color}</span>}
                      {item.purchase_price&&<span style={{fontSize:11,color:'#f5c842',...MONO}}>💰 {Number(item.purchase_price).toFixed(0)} PLN</span>}
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
                        style={{background:'none',border:`1px solid ${C.border}`,borderRadius:6,color:C.dim,padding:'7px 10px',cursor:'pointer',...MONO,fontSize:10}}>✕</button>
                    </div>
                  ):(
                    <button onClick={()=>setShowAlertForm(item.id)}
                      style={{marginTop:8,background:'none',border:`1px solid ${C.border}`,borderRadius:6,
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
    </div>
  );
}

// ── Profile Tab ───────────────────────────────────────────────
function ProfileTab({user,profile,followedArtists,onSignOut,onUpdateProfile}){
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
        style={{background:`linear-gradient(135deg,${C.accent},${C.accent2})`,border:'none',borderRadius:10,
          color:'#fff',padding:'13px 24px',...BEBAS,fontSize:18,letterSpacing:'0.1em',cursor:'pointer'}}>
        SIGN IN
      </button>
    </div>
  );

  return(
    <div style={{padding:'16px'}}>
      {/* User info */}
      <div style={{display:'flex',gap:14,alignItems:'center',marginBottom:24,padding:'16px',
        background:C.bg2,border:`1px solid ${C.border}`,borderRadius:12}}>
        <div style={{width:52,height:52,borderRadius:'50%',background:`linear-gradient(135deg,${C.accent},#450a0a)`,
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
      <div style={{background:C.bg2,border:`1px solid ${C.border}`,borderRadius:12,padding:'16px',marginBottom:16}}>
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
          style={{width:'100%',padding:'11px',background:`linear-gradient(135deg,${C.accent},${C.accent2})`,
            border:'none',borderRadius:8,color:'#fff',cursor:'pointer',...BEBAS,fontSize:16,letterSpacing:'0.08em'}}>
          {saving?'SAVING…':'SAVE PROFILE'}
        </button>
        {msg&&<div style={{fontSize:11,color:msg.startsWith('✓')?'#4ade80':'#f87171',...MONO,marginTop:8,textAlign:'center'}}>{msg}</div>}
      </div>

      {/* Followed artists */}
      {followedArtists.length>0&&(
        <div style={{background:C.bg2,border:`1px solid ${C.border}`,borderRadius:12,padding:'16px',marginBottom:16}}>
          <div style={{fontSize:10,color:C.accent,letterSpacing:'0.2em',textTransform:'uppercase',...MONO,marginBottom:10}}>
            Followed artists ({followedArtists.length})
          </div>
          <div style={{display:'flex',flexWrap:'wrap',gap:6}}>
            {followedArtists.map(a=>(
              <span key={a.id} style={{fontSize:11,padding:'5px 10px',borderRadius:20,
                background:C.bg3,color:C.muted,border:`1px solid ${C.border}`,...MONO}}>
                {a.artist_name} 🔔
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Sign out */}
      <button onClick={onSignOut}
        style={{width:'100%',padding:'12px',background:'none',border:`1px solid ${C.border}`,
          borderRadius:10,color:C.dim,cursor:'pointer',...MONO,fontSize:12}}>
        Sign out
      </button>
    </div>
  );
}

// ── Watchlist Tab ─────────────────────────────────────────────
function WatchlistTab({watchlist,onRemove,onAlbumClick,user}){
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
      <div style={{fontSize:10,color:C.dim,...MONO,letterSpacing:'0.15em',textTransform:'uppercase',marginBottom:12}}>
        {watchlist.length} {watchlist.length===1?'album':'albums'}
        {user&&<span style={{color:'#4ade80'}}> · cloud sync ✓</span>}
      </div>
      <div style={{display:'flex',flexDirection:'column',gap:8}}>
        {watchlist.map(album=>(
          <div key={album.id||album.album_id} style={{background:C.bg2,border:`1px solid ${C.border}`,borderRadius:12,padding:'12px 14px',display:'flex',gap:12,alignItems:'center'}}>
            <div onClick={()=>onAlbumClick(album)} style={{display:'flex',gap:12,flex:1,alignItems:'center',cursor:'pointer'}}>
              <AlbumCover src={album.cover} artist={album.artist} size={52}/>
              <div style={{flex:1,minWidth:0}}>
                <div style={{...BEBAS,fontSize:17,color:C.text,lineHeight:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{album.artist}</div>
                <div style={{fontSize:11,color:C.muted,...MONO,marginTop:2,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{album.album}</div>
                <div style={{fontSize:10,color:C.dim,...MONO,marginTop:3}}>{album.release_date||album.releaseDate}</div>
              </div>
            </div>
            <button onClick={()=>onRemove(album.id||album.album_id||album.albumId)}
              style={{background:'none',border:'none',color:C.ultra,cursor:'pointer',fontSize:20,padding:'2px 4px'}}
              onMouseEnter={e=>e.currentTarget.style.color=C.accent}
              onMouseLeave={e=>e.currentTarget.style.color=C.ultra}>×</button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Bottom Nav ────────────────────────────────────────────────
function BottomNav({tab,onChange,watchCount,user}){
  const tabs=[
    {id:'feed',icon:'🔥',label:'Feed'},
    {id:'watchlist',icon:'★',label:`Watchlist${watchCount>0?` (${watchCount})`:''}`,color:'#f5c842'},
    {id:'collection',icon:'📦',label:'Collection'},
    {id:'profile',icon:'👤',label:user?'Profile':'Login'},
  ];
  return(
    <div style={{position:'fixed',bottom:0,left:0,right:0,background:C.bg,borderTop:`1px solid ${C.border}`,
      display:'flex',zIndex:100,paddingBottom:'env(safe-area-inset-bottom,0px)'}}>
      {tabs.map(t=>(
        <button key={t.id} onClick={()=>onChange(t.id)}
          style={{flex:1,padding:'10px 4px 8px',background:'none',border:'none',cursor:'pointer',
            display:'flex',flexDirection:'column',alignItems:'center',gap:2,
            borderTop:tab===t.id?`2px solid ${C.accent}`:'2px solid transparent'}}>
          <span style={{fontSize:20,color:t.color||undefined}}>{t.icon}</span>
          <span style={{fontSize:9,color:tab===t.id?C.accent:C.dim,...MONO,letterSpacing:'0.04em'}}>{t.label}</span>
        </button>
      ))}
    </div>
  );
}

// ── Main App ──────────────────────────────────────────────────
const FILTERS=[
  {id:'all',label:'⚡ All'},
  {id:'new',label:'🔥 New'},
  {id:'preorder',label:'⏳ Pre-order'},
  {id:'limited',label:'💎 Limited'},
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
  const [search,setSearch]=useState('');

  // Watchlist + Collection
  const [watchlist,setWatchlist]=useState([]);
  const [collection,setCollection]=useState([]);
  const [followedArtists,setFollowedArtists]=useState([]);
  const [portfolio,setPortfolio]=useState(null);

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
    if(d.item){setCollection(c=>[d.item,...c]);const port=await fetch('/api/portfolio').then(r=>r.json());setPortfolio(port);}
    setSelected(null);
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
  const signOut=async()=>{await supabase.auth.signOut();setUser(null);setWatchlist([]);setCollection([]);setFollowedArtists([]);setPortfolio(null);};

  // ── Filtered feed ────────────────────────────────────────────
  const today=new Date();
  const filtered=releases.filter(r=>{
    const rd=new Date(r.releaseDate);
    const isPreorder=rd>today;
    const isNew=(today-rd)/(1000*60*60*24)<45&&!isPreorder;
    const vinyl=vinylCache[r.id];
    if(filter==='preorder')return isPreorder;
    if(filter==='new')return isNew;
    if(filter==='limited')return vinyl?.hasLimited===true;
    return true;
  }).filter(r=>!search||r.artist.toLowerCase().includes(search.toLowerCase())||r.album.toLowerCase().includes(search.toLowerCase()));

  const isWatched=id=>watchlist.some(w=>(w.id||w.album_id)===id);
  const isFollowed=name=>followedArtists.some(a=>a.artist_name===name);

  return(
    <div style={{minHeight:'100vh',background:C.bg,maxWidth:600,margin:'0 auto'}}>

      {/* Header */}
      <div style={{background:C.bg,borderBottom:`1px solid ${C.border}`,padding:'14px 16px 12px',position:'sticky',top:0,zIndex:50}}>
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

      <div style={{paddingBottom:80}}>
        {/* FEED TAB */}
        {tab==='feed'&&(
          <>
            {!feedLoading&&releases.length>0&&<StatsBar releases={releases}/>}
            <div style={{display:'flex',gap:6,padding:'10px 16px',overflow:'auto',borderBottom:`1px solid ${C.border}`}}>
              {FILTERS.map(f=>(
                <button key={f.id} onClick={()=>setFilter(f.id)}
                  style={{padding:'6px 12px',borderRadius:20,whiteSpace:'nowrap',
                    background:filter===f.id?`${C.accent}22`:C.bg3,
                    color:filter===f.id?C.accent:C.dim,
                    border:`1px solid ${filter===f.id?C.accent+'66':C.border}`,
                    cursor:'pointer',fontSize:11,...MONO}}>
                  {f.label}
                </button>
              ))}
            </div>
            <div style={{padding:'10px 16px 0'}}>
              <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search artist, album…" style={inputSt}/>
            </div>
            {!feedLoading&&<div style={{padding:'8px 16px 4px',fontSize:10,color:C.dim,...MONO}}>{filtered.length} album{filtered.length!==1?'s':''}</div>}
            {feedLoading&&<div style={{textAlign:'center',padding:'80px 24px',color:C.dim,...MONO}}><div style={{fontSize:32,marginBottom:12}}>⟳</div>Loading…</div>}
            {feedError&&<div style={{margin:'16px',background:'#1a0000',border:`1px solid ${C.accent}44`,borderRadius:8,padding:'12px 14px',color:'#f87171',fontSize:12,...MONO}}>⚠ {feedError}</div>}
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
        {tab==='watchlist'&&(
          <WatchlistTab watchlist={watchlist} onRemove={async id=>{
            if(user)await fetch(`/api/watchlist?album_id=${id}`,{method:'DELETE'});
            setWatchlist(w=>w.filter(x=>(x.album_id||x.id)!==id));
          }} onAlbumClick={openAlbum} user={user}/>
        )}

        {/* COLLECTION TAB */}
        {tab==='collection'&&(
          <CollectionTab user={user} collection={collection} onRemove={removeFromCollection} portfolio={portfolio}/>
        )}

        {/* PROFILE TAB */}
        {tab==='profile'&&(
          user?(
            <ProfileTab user={user} profile={profile} followedArtists={followedArtists}
              onSignOut={signOut} onUpdateProfile={setProfile}/>
          ):(
            <div style={{textAlign:'center',padding:'80px 24px'}}>
              <div style={{...BEBAS,fontSize:40,color:C.text,marginBottom:8,lineHeight:1}}>METAL VAULT</div>
              <div style={{fontSize:12,color:C.dim,...MONO,marginBottom:32,lineHeight:1.7}}>
                Sign in to sync your watchlist,<br/>manage your collection and get price alerts.
              </div>
              <button onClick={()=>window.location.href='/login'}
                style={{background:`linear-gradient(135deg,${C.accent},${C.accent2})`,border:'none',borderRadius:12,
                  color:'#fff',padding:'15px 32px',...BEBAS,fontSize:22,letterSpacing:'0.1em',cursor:'pointer'}}>
                SIGN IN
              </button>
            </div>
          )
        )}
      </div>

      <BottomNav tab={tab} onChange={setTab} watchCount={watchlist.length} user={user}/>

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
