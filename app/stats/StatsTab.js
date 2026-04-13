'use client';
import { useState, useEffect } from 'react';

const C = {
  bg:'#0a0a0a',bg2:'#141414',bg3:'#1e1e1e',
  border:'#2a2a2a',accent:'#dc2626',
  text:'#f0f0f0',muted:'#888',dim:'#555',
};
const MONO  = {fontFamily:"'Space Mono',monospace"};
const BEBAS = {fontFamily:"'Bebas Neue',sans-serif"};

function Skeleton({w='100%',h=20,r=4}){
  return <div style={{width:w,height:h,borderRadius:r,background:'linear-gradient(90deg,#1e1e1e 25%,#252525 50%,#1e1e1e 75%)',backgroundSize:'200% 100%',animation:'shimmer 1.5s infinite'}} />;
}

function StatCard({icon,value,label,color=C.accent,sub,badge,loading}){
  return(
    <div style={{background:C.bg2,border:'1px solid '+C.border,borderRadius:12,padding:'14px',textAlign:'center',position:'relative'}}>
      {badge&&<div style={{position:'absolute',top:8,right:8,fontSize:11}}>{badge}</div>}
      <div style={{fontSize:22,marginBottom:4}}>{icon}</div>
      {loading?<Skeleton h={28} r={4}/>:<div style={{...BEBAS,fontSize:28,color,lineHeight:1}}>{value}</div>}
      <div style={{fontSize:9,color:C.dim,...MONO,letterSpacing:'0.12em',textTransform:'uppercase',marginTop:4}}>{label}</div>
      {sub&&<div style={{fontSize:10,color:C.muted,...MONO,marginTop:3}}>{sub}</div>}
    </div>
  );
}

function BarChart({data,colorFn}){
  const max=Math.max(...data.map(d=>d.value),1);
  return(
    <div style={{display:'flex',flexDirection:'column',gap:7}}>
      {data.map((d,i)=>(
        <div key={i} style={{display:'flex',alignItems:'center',gap:8}}>
          <div style={{fontSize:11,color:C.muted,...MONO,width:110,flexShrink:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{d.label}</div>
          <div style={{flex:1,height:20,background:C.bg3,borderRadius:4,overflow:'hidden'}}>
            <div style={{height:'100%',borderRadius:4,width:(d.value/max*100)+'%',background:colorFn?colorFn(i):C.accent,transition:'width 0.6s ease',display:'flex',alignItems:'center',justifyContent:'flex-end',paddingRight:6}}>
              {d.value>0&&<span style={{fontSize:9,color:'#fff',...MONO}}>{d.value}</span>}
            </div>
          </div>
          {d.sub&&<div style={{fontSize:10,color:C.muted,...MONO,flexShrink:0}}>{d.sub}</div>}
        </div>
      ))}
    </div>
  );
}

function PortfolioChart({snapshots}){
  if(!snapshots||snapshots.length<2)return(
    <div style={{textAlign:'center',padding:'24px 0',color:C.dim,...MONO,fontSize:11}}>
      Add records to collection to see value history
    </div>
  );
  const vals=snapshots.map(s=>Number(s.total_value)||0);
  const max=Math.max(...vals,1);
  const W=300,H=90,PL=44,PR=8,PT=8,PB=20;
  const pts=snapshots.map((s,i)=>{
    const x=PL+(i/(snapshots.length-1))*(W-PL-PR);
    const y=PT+((max-(Number(s.total_value)||0))/max)*(H-PT-PB);
    return x+','+y;
  }).join(' ');
  const first=vals[0],last=vals[vals.length-1],gain=last-first;
  const gainColor=gain>=0?'#4ade80':'#f87171';
  return(
    <div>
      <div style={{display:'flex',justifyContent:'space-between',marginBottom:8}}>
        <span style={{fontSize:10,color:C.dim,...MONO}}>90 day trend</span>
        <span style={{fontSize:12,color:gainColor,...MONO}}>{gain>=0?'+$':'-$'}{Math.abs(gain).toFixed(0)}</span>
      </div>
      <svg viewBox={'0 0 '+W+' '+H} style={{width:'100%',height:'auto'}}>
        <defs>
          <linearGradient id="pg" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={C.accent} stopOpacity="0.3"/>
            <stop offset="100%" stopColor={C.accent} stopOpacity="0"/>
          </linearGradient>
        </defs>
        {[0,0.5,1].map((pct,pi)=>{
          const y=PT+pct*(H-PT-PB);const val=max-pct*max;
          return(
            <g key={pi}>
              <line x1={PL} x2={W-PR} y1={y} y2={y} stroke={C.border} strokeWidth="1"/>
              <text x={PL-3} y={y+3} textAnchor="end" fontSize="7" fill={C.dim}>{val.toFixed(0)}</text>
            </g>
          );
        })}
        <polygon points={PL+','+(H-PB)+' '+pts+' '+(W-PR)+','+(H-PB)} fill="url(#pg)"/>
        <polyline points={pts} fill="none" stroke={C.accent} strokeWidth="1.5"/>
        {snapshots.map((s,i)=>{
          const parts=pts.split(' ')[i].split(',');
          return<circle key={i} cx={parseFloat(parts[0])} cy={parseFloat(parts[1])} r="2.5" fill={C.accent}/>;
        })}
      </svg>
      <style>{`@keyframes shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}`}</style>
    </div>
  );
}

export default function StatsTab({collection,watchlist}){
  const [portfolio,setPortfolio]=useState(null);
  const [loading,setLoading]=useState(true);

  useEffect(()=>{
    fetch('/api/portfolio').then(r=>r.json()).then(d=>{setPortfolio(d);setLoading(false);}).catch(()=>setLoading(false));
  },[collection.length]);

  // ── Financial stats ──────────────────────────────────────────
  const totalPaid    = collection.reduce((s,i)=>s+(Number(i.purchase_price)||0),0);
  const totalCurrent = collection.reduce((s,i)=>s+(Number(i.median_price||i.current_price||i.purchase_price)||0),0);
  const gain         = totalCurrent - totalPaid;
  const gainPct      = totalPaid>0?((gain/totalPaid)*100).toFixed(1):0;
  const avgPrice     = collection.length>0?(totalPaid/collection.length).toFixed(0):0;

  // Most valuable
  const mostValuable = [...collection].sort((a,b)=>(Number(b.median_price||b.current_price)||0)-(Number(a.median_price||a.current_price)||0))[0];

  // Recently added
  const recentlyAdded = [...collection].sort((a,b)=>new Date(b.added_at||0)-new Date(a.added_at||0))[0];

  // Top artist
  const artistMap={};
  collection.forEach(c=>{artistMap[c.artist]=(artistMap[c.artist]||0)+1;});
  const topArtist=Object.entries(artistMap).sort((a,b)=>b[1]-a[1])[0];

  // Genre breakdown
  const genreMap={};
  collection.forEach(c=>{const g=c.genre||'Metal';genreMap[g]=(genreMap[g]||0)+1;});
  const genreData=Object.entries(genreMap).sort((a,b)=>b[1]-a[1]).slice(0,6).map(([label,value])=>({label,value}));

  // Format breakdown
  const fmtMap={};
  collection.forEach(c=>{const f=(c.format||'Vinyl').split('·')[0].trim();fmtMap[f]=(fmtMap[f]||0)+1;});
  const fmtData=Object.entries(fmtMap).sort((a,b)=>b[1]-a[1]).slice(0,5).map(([label,value])=>({label,value}));

  // Top 5 by value
  const topByValue=[...collection]
    .filter(i=>Number(i.median_price||i.current_price)>0)
    .sort((a,b)=>(Number(b.median_price||b.current_price)||0)-(Number(a.median_price||a.current_price)||0))
    .slice(0,5);

  const COLORS=['#dc2626','#f5c842','#4ade80','#60a5fa','#a78bfa','#f97316'];

  const priceDataAvailable = collection.some(i=>i.median_price||i.current_price);

  return(
    <div style={{padding:'0 16px 16px'}}>
      <style>{`@keyframes shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}`}</style>

      {/* Header */}
      <div style={{padding:'16px 0 12px'}}>
        <div style={{...BEBAS,fontSize:28,color:C.text,letterSpacing:'0.06em',lineHeight:1}}>STATISTICS</div>
        <div style={{fontSize:10,color:C.accent,...MONO,letterSpacing:'0.2em',marginTop:2}}>YOUR METAL VAULT OVERVIEW</div>
      </div>

      {/* Financial stats */}
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginBottom:16}}>
        <StatCard icon="📦" value={collection.length} label="Records" color={C.accent} loading={false}/>
        <StatCard icon="★" value={watchlist.length} label="Watching" color="#f5c842" loading={false}/>
        <StatCard
          icon="💰"
          value={totalPaid>0?'$'+totalPaid.toFixed(0):'—'}
          label="Total paid"
          color="#4ade80"
          loading={loading}
        />
        <StatCard
          icon={gain>=0?'📈':'📉'}
          value={totalCurrent>0?(gain>=0?'+':'')+'$'+gain.toFixed(0):'—'}
          label={'Est. gain '+gainPct+'%'}
          color={gain>=0?'#4ade80':'#f87171'}
          loading={loading}
        />
      </div>

      {/* Price notice if no data */}
      {collection.length>0&&!priceDataAvailable&&(
        <div style={{background:'#1a1a00',border:'1px solid #55550033',borderRadius:8,padding:'10px 14px',marginBottom:16}}>
          <div style={{fontSize:11,color:'#f5c842',...MONO,lineHeight:1.5}}>
            💡 Price data loads automatically when you add records from the album modal.<br/>
            <span style={{color:C.dim,fontSize:10}}>Current values show purchase prices only.</span>
          </div>
        </div>
      )}

      {/* Portfolio chart */}
      {portfolio?.snapshots?.length>=2&&(
        <div style={{background:C.bg2,border:'1px solid '+C.border,borderRadius:12,padding:'16px',marginBottom:16}}>
          <div style={{fontSize:10,color:C.accent,...MONO,letterSpacing:'0.15em',textTransform:'uppercase',marginBottom:12}}>Collection value over time</div>
          <PortfolioChart snapshots={portfolio.snapshots}/>
        </div>
      )}

      {/* Top insights */}
      {(topArtist||mostValuable||recentlyAdded||avgPrice>0)&&(
        <div style={{background:C.bg2,border:'1px solid '+C.border,borderRadius:12,padding:'16px',marginBottom:16}}>
          <div style={{fontSize:10,color:C.accent,...MONO,letterSpacing:'0.15em',textTransform:'uppercase',marginBottom:12}}>Insights</div>
          <div style={{display:'flex',flexDirection:'column',gap:10}}>
            {topArtist&&(
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                <div>
                  <span style={{fontSize:11,color:C.dim,...MONO}}>🔥 Top artist</span>
                  <span style={{fontSize:9,background:'#dc262622',color:C.accent,padding:'1px 6px',borderRadius:8,...MONO,marginLeft:6}}>Most owned</span>
                </div>
                <div style={{textAlign:'right'}}>
                  <div style={{fontSize:13,color:C.text,...MONO}}>{topArtist[0]}</div>
                  <div style={{fontSize:10,color:C.dim,...MONO}}>{topArtist[1]} records</div>
                </div>
              </div>
            )}
            {mostValuable&&(Number(mostValuable.median_price||mostValuable.current_price)>0)&&(
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',borderTop:'1px solid '+C.border,paddingTop:10}}>
                <div>
                  <span style={{fontSize:11,color:C.dim,...MONO}}>💎 Most valuable</span>
                </div>
                <div style={{textAlign:'right'}}>
                  <div style={{fontSize:13,color:'#f5c842',...MONO}}>{'$'+Number(mostValuable.median_price||mostValuable.current_price).toFixed(0)}</div>
                  <div style={{fontSize:10,color:C.dim,...MONO,maxWidth:150,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{mostValuable.artist}</div>
                </div>
              </div>
            )}
            {recentlyAdded&&(
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',borderTop:'1px solid '+C.border,paddingTop:10}}>
                <span style={{fontSize:11,color:C.dim,...MONO}}>🆕 Recently added</span>
                <div style={{textAlign:'right'}}>
                  <div style={{fontSize:13,color:C.text,...MONO,maxWidth:160,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{recentlyAdded.artist}</div>
                  <div style={{fontSize:10,color:C.dim,...MONO}}>{(recentlyAdded.added_at||'').split('T')[0]}</div>
                </div>
              </div>
            )}
            {avgPrice>0&&(
              <div style={{display:'flex',justifyContent:'space-between',borderTop:'1px solid '+C.border,paddingTop:10}}>
                <span style={{fontSize:11,color:C.dim,...MONO}}>📊 Avg. purchase price</span>
                <span style={{fontSize:13,color:C.text,...MONO}}>${avgPrice}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Top by value */}
      {topByValue.length>0&&(
        <div style={{background:C.bg2,border:'1px solid '+C.border,borderRadius:12,padding:'16px',marginBottom:16}}>
          <div style={{fontSize:10,color:C.accent,...MONO,letterSpacing:'0.15em',textTransform:'uppercase',marginBottom:12}}>Top by value</div>
          {topByValue.map((item,i)=>(
            <div key={item.id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'7px 0',borderBottom:i<topByValue.length-1?'1px solid '+C.border:'none'}}>
              <div style={{flex:1,minWidth:0,marginRight:12}}>
                <div style={{fontSize:12,color:C.text,...MONO,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{item.artist}</div>
                <div style={{fontSize:10,color:C.dim,...MONO,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{item.album}</div>
              </div>
              <div style={{textAlign:'right',flexShrink:0}}>
                <div style={{...BEBAS,fontSize:18,color:'#f5c842',lineHeight:1}}>{Number(item.median_price||item.current_price).toFixed(0)}</div>
                <div style={{fontSize:8,color:C.dim,...MONO}}>USD</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Genre chart */}
      {genreData.length>0&&(
        <div style={{background:C.bg2,border:'1px solid '+C.border,borderRadius:12,padding:'16px',marginBottom:16}}>
          <div style={{fontSize:10,color:C.accent,...MONO,letterSpacing:'0.15em',textTransform:'uppercase',marginBottom:12}}>Collection by genre</div>
          <BarChart data={genreData} colorFn={i=>COLORS[i%COLORS.length]}/>
        </div>
      )}

      {/* Format chart */}
      {fmtData.length>1&&(
        <div style={{background:C.bg2,border:'1px solid '+C.border,borderRadius:12,padding:'16px',marginBottom:16}}>
          <div style={{fontSize:10,color:C.accent,...MONO,letterSpacing:'0.15em',textTransform:'uppercase',marginBottom:12}}>Vinyl formats</div>
          <BarChart data={fmtData} colorFn={()=>'#60a5fa'}/>
        </div>
      )}

      {collection.length===0&&(
        <div style={{textAlign:'center',padding:'40px 0',color:C.dim,...MONO}}>
          <div style={{fontSize:40,marginBottom:12}}>📊</div>
          <div style={{fontSize:13,lineHeight:1.7}}>Add records to your collection<br/>to see statistics here</div>
        </div>
      )}
    </div>
  );
}
