'use client';
import { useState, useEffect } from 'react';
import { C, MONO, BEBAS } from '@/lib/theme';


const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DAYS   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

function AlbumCover({src,artist,size=40}){
  const [err,setErr]=useState(false);
  if(!src||err)return(
    <div style={{width:size,height:size,borderRadius:4,flexShrink:0,background:'linear-gradient(135deg,#1a0000,#0a0a0a)',display:'flex',alignItems:'center',justifyContent:'center',border:'1px solid '+C.border}}>
      <span style={{...BEBAS,fontSize:Math.round(size*0.45),color:'#ffffff33'}}>{(artist||'?')[0].toUpperCase()}</span>
    </div>
  );
  return(
    <div style={{width:size,height:size,borderRadius:4,flexShrink:0,overflow:'hidden',border:'1px solid '+C.border}}>
      <img src={src} alt={artist} loading="lazy" onError={()=>setErr(true)} style={{width:'100%',height:'100%',objectFit:'cover'}}/>
    </div>
  );
}

export default function CalendarTab({releases=[],followedArtists=[]}){
  const now   = new Date();
  const [year,setYear]   = useState(now.getFullYear());
  const [month,setMonth] = useState(now.getMonth());
  const [view,setView]   = useState('calendar'); // calendar | list

  // Filter releases to show: upcoming + recent (3 months back)
  const relevantReleases = releases.filter(r => {
    if (!r.releaseDate) return false;
    const d = new Date(r.releaseDate);
    const diff = (d - now) / (1000*60*60*24);
    return diff > -90 && diff < 365; // 3 months back, 1 year forward
  });

  // Group by date
  const byDate = {};
  relevantReleases.forEach(r => {
    const key = r.releaseDate;
    if (!byDate[key]) byDate[key] = [];
    byDate[key].push(r);
  });

  // Calendar grid
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month+1, 0).getDate();
  const cells = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const isToday = (d) => {
    return d && now.getFullYear()===year && now.getMonth()===month && now.getDate()===d;
  };
  const dateKey = (d) => {
    if (!d) return '';
    return year+'-'+String(month+1).padStart(2,'0')+'-'+String(d).padStart(2,'0');
  };
  const hasRelease = (d) => byDate[dateKey(d)]?.length > 0;

  const upcoming = relevantReleases
    .filter(r => new Date(r.releaseDate) >= now)
    .sort((a,b) => new Date(a.releaseDate)-new Date(b.releaseDate))
    .slice(0,20);

  const recent = relevantReleases
    .filter(r => new Date(r.releaseDate) < now)
    .sort((a,b) => new Date(b.releaseDate)-new Date(a.releaseDate))
    .slice(0,20);

  const [selected, setSelected] = useState(null);
  const selectedReleases = selected ? (byDate[selected]||[]) : [];

  return(
    <div style={{padding:'0 0 16px'}}>
      {/* Header */}
      <div style={{padding:'16px 16px 8px',display:'flex',justifyContent:'space-between',alignItems:'flex-end'}}>
        <div>
          <div style={{...BEBAS,fontSize:26,color:C.text,letterSpacing:'0.06em',lineHeight:1}}>RELEASE CALENDAR</div>
          <div style={{fontSize:10,color:C.accent,...MONO,letterSpacing:'0.2em',marginTop:2}}>UPCOMING & RECENT</div>
        </div>
        <div style={{display:'flex',gap:6}}>
          {['calendar','list'].map(v=>(
            <button key={v} onClick={()=>setView(v)}
              style={{padding:'5px 10px',borderRadius:20,background:view===v?C.accent+'22':C.bg3,
                color:view===v?C.accent:C.dim,border:'1px solid '+(view===v?C.accent+'44':C.border),
                cursor:'pointer',fontSize:10,...MONO}}>
              {v==='calendar'?'📅':'📋'} {v}
            </button>
          ))}
        </div>
      </div>

      {view==='calendar'&&(
        <div style={{padding:'0 16px'}}>
          {/* Month nav */}
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
            <button onClick={()=>{if(month===0){setMonth(11);setYear(y=>y-1);}else setMonth(m=>m-1);}}
              style={{background:C.bg3,border:'1px solid '+C.border,borderRadius:8,color:C.muted,padding:'6px 12px',cursor:'pointer',...MONO,fontSize:12}}>‹</button>
            <div style={{...BEBAS,fontSize:22,color:C.text,letterSpacing:'0.06em'}}>{MONTHS[month]} {year}</div>
            <button onClick={()=>{if(month===11){setMonth(0);setYear(y=>y+1);}else setMonth(m=>m+1);}}
              style={{background:C.bg3,border:'1px solid '+C.border,borderRadius:8,color:C.muted,padding:'6px 12px',cursor:'pointer',...MONO,fontSize:12}}>›</button>
          </div>

          {/* Day headers */}
          <div style={{display:'grid',gridTemplateColumns:'repeat(7,1fr)',gap:2,marginBottom:4}}>
            {DAYS.map(d=>(
              <div key={d} style={{textAlign:'center',fontSize:9,color:C.dim,...MONO,padding:'4px 0'}}>{d}</div>
            ))}
          </div>

          {/* Calendar grid */}
          <div style={{display:'grid',gridTemplateColumns:'repeat(7,1fr)',gap:2}}>
            {cells.map((d,i)=>{
              const dk = dateKey(d);
              const releases = d ? (byDate[dk]||[]) : [];
              const today = isToday(d);
              const isSelected = dk===selected;
              return(
                <div key={i} onClick={()=>d&&releases.length>0&&setSelected(isSelected?null:dk)}
                  style={{
                    minHeight:44,borderRadius:6,padding:'4px',
                    background:isSelected?C.accent+'22':today?'#1a0000':d?C.bg2:'transparent',
                    border:'1px solid '+(isSelected?C.accent:today?C.accent+'44':d?C.border:'transparent'),
                    cursor:d&&releases.length>0?'pointer':'default',
                    position:'relative',
                  }}>
                  {d&&(
                    <>
                      <div style={{fontSize:11,...MONO,color:today?C.accent:C.muted,fontWeight:today?'700':'400'}}>{d}</div>
                      {releases.length>0&&(
                        <div style={{marginTop:2}}>
                          {releases.slice(0,2).map((r,ri)=>(
                            <div key={ri} style={{fontSize:8,color:'#f5c842',...MONO,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',lineHeight:1.3}}>
                              {r.artist}
                            </div>
                          ))}
                          {releases.length>2&&<div style={{fontSize:8,color:C.dim,...MONO}}>+{releases.length-2}</div>}
                        </div>
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </div>

          {/* Selected day releases */}
          {selectedReleases.length>0&&(
            <div style={{marginTop:12,background:C.bg2,border:'1px solid '+C.border,borderRadius:10,padding:'12px 14px'}}>
              <div style={{fontSize:10,color:C.accent,...MONO,letterSpacing:'0.15em',textTransform:'uppercase',marginBottom:8}}>
                {selected}
              </div>
              {selectedReleases.map((r,i)=>(
                <div key={i} style={{display:'flex',gap:10,alignItems:'center',padding:'6px 0',borderTop:i>0?'1px solid '+C.border:'none'}}>
                  <AlbumCover src={r.cover} artist={r.artist} size={40}/>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{...BEBAS,fontSize:15,color:C.text,lineHeight:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{r.artist}</div>
                    <div style={{fontSize:11,color:C.muted,...MONO,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{r.album}</div>
                  </div>
                  {r.spotifyUrl&&(
                    <a href={r.spotifyUrl} target="_blank" rel="noopener noreferrer"
                      style={{fontSize:11,color:'#1db954',...MONO,textDecoration:'none',flexShrink:0}}>▶</a>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {view==='list'&&(
        <div style={{padding:'0 16px'}}>
          {upcoming.length>0&&(
            <>
              <div style={{fontSize:10,color:'#4ade80',...MONO,letterSpacing:'0.15em',textTransform:'uppercase',margin:'12px 0 8px'}}>
                ⏳ Upcoming ({upcoming.length})
              </div>
              <div style={{display:'flex',flexDirection:'column',gap:6}}>
                {upcoming.map((r,i)=>{
                  const d = new Date(r.releaseDate);
                  const daysLeft = Math.ceil((d-now)/(1000*60*60*24));
                  return(
                    <div key={i} style={{background:C.bg2,border:'1px solid '+C.border,borderRadius:10,padding:'10px 14px',display:'flex',gap:10,alignItems:'center'}}>
                      <AlbumCover src={r.cover} artist={r.artist} size={44}/>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{...BEBAS,fontSize:16,color:C.text,lineHeight:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{r.artist}</div>
                        <div style={{fontSize:11,color:C.muted,...MONO,marginTop:2,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{r.album}</div>
                      </div>
                      <div style={{textAlign:'right',flexShrink:0}}>
                        <div style={{fontSize:11,color:'#4ade80',...MONO}}>{daysLeft===0?'Today':daysLeft+'d'}</div>
                        <div style={{fontSize:9,color:C.dim,...MONO}}>{r.releaseDate}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {recent.length>0&&(
            <>
              <div style={{fontSize:10,color:C.accent,...MONO,letterSpacing:'0.15em',textTransform:'uppercase',margin:'16px 0 8px'}}>
                🔥 Recent ({recent.length})
              </div>
              <div style={{display:'flex',flexDirection:'column',gap:6}}>
                {recent.map((r,i)=>{
                  const d = new Date(r.releaseDate);
                  const daysAgo = Math.floor((now-d)/(1000*60*60*24));
                  return(
                    <div key={i} style={{background:C.bg2,border:'1px solid '+C.border,borderRadius:10,padding:'10px 14px',display:'flex',gap:10,alignItems:'center'}}>
                      <AlbumCover src={r.cover} artist={r.artist} size={44}/>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{...BEBAS,fontSize:16,color:C.text,lineHeight:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{r.artist}</div>
                        <div style={{fontSize:11,color:C.muted,...MONO,marginTop:2,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{r.album}</div>
                      </div>
                      <div style={{textAlign:'right',flexShrink:0}}>
                        <div style={{fontSize:11,color:C.dim,...MONO}}>{daysAgo===0?'Today':daysAgo+'d ago'}</div>
                        <div style={{fontSize:9,color:C.dim,...MONO}}>{r.releaseDate}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {upcoming.length===0&&recent.length===0&&(
            <div style={{textAlign:'center',padding:'50px 0',color:C.dim,...MONO}}>
              <div style={{fontSize:40,marginBottom:12}}>📅</div>
              <div style={{fontSize:13}}>No upcoming releases found</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
