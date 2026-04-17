// ── Shared UI components — extracted from app/page.js ────────────
'use client';
import { useState } from 'react';
import { C, MONO, BEBAS, BADGE_STYLES, GENRE_COLOR } from '@/lib/theme';

// ── formatDate helper ─────────────────────────────────────────
function formatDate(dateStr) {
  if (!dateStr) return '';
  if (/^\d{4}$/.test(dateStr)) return dateStr;
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
  return dateStr;
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
  const newCount = releases.filter(r=>{
    const d=new Date(r.releaseDate);
    return !isNaN(d)&&(today-d)/(1000*60*60*24)<365&&d<=today;
  }).length;
  const preorders = releases.filter(r=>r.preorder===true||(r.releaseDate&&new Date(r.releaseDate)>today)).length;
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
export function AlbumCard({album,isWatched,onWatchToggle,onClick,vinylData,isFollowed,onFollowToggle,user}){
  const today=new Date();
  const rd=new Date(album.releaseDate);
  const isPreorder=(rd>today)||album.preorder===true;
  const isNew=(today-rd)/(1000*60*60*24)<365&&!isPreorder;
  const isLimited=album.limited===true||vinylData?.hasLimited===true;
  const badges=[vinylData?.hasVinyl!==false&&'VINYL',isLimited&&'LIMITED',isPreorder&&'PREORDER',isNew&&'NEW'].filter(Boolean);
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
          {isPreorder?('🗓 '+formatDate(album.releaseDate||'')):formatDate(album.releaseDate||'')}
        </div>
        {(album.lowest_price||album.median_price)?(
          <div style={{display:'flex',gap:6,alignItems:'center',marginTop:4,flexWrap:'wrap'}}>
            {album.lowest_price>0&&(
              <span style={{fontSize:10,color:'#4ade80',...MONO}}>from ${Number(album.lowest_price).toFixed(0)}</span>
            )}
            {album.median_price>0&&(
              <span style={{fontSize:10,color:'#aaa',...MONO}}>median ${Number(album.median_price).toFixed(0)}</span>
            )}
          </div>
        ):(
          <div style={{fontSize:9,color:'#444',...MONO,marginTop:3}}>price unknown</div>
        )}
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
export function VinylModal({album,onClose,onWatchToggle,isWatched,onAddToCollection,vinylData,loading,error}){
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


// ── BottomNav ─────────────────────────────────────────────────
export function BottomNav({tab,onChange,watchCount,user}){
  const tabs=[
    {id:'feed',      icon:'🔥', label:'Feed'},
    {id:'search',    icon:'🔍', label:'Search'},
    {id:'collection',icon:'📦', label:'Vault'},
    {id:'calendar',  icon:'📅', label:'Cal'},
    {id:'concerts',  icon:'🎸', label:'Live'},
    {id:'stats',     icon:'📊', label:'Stats'},
    {id:'profile',   icon:'👤', label:user?'Me':'Me'},
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

