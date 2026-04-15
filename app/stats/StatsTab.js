'use client';
import { useState, useEffect } from 'react';

const C = {
  bg:'#0a0a0a',bg2:'#141414',bg3:'#1e1e1e',
  border:'#2a2a2a',accent:'#dc2626',
  text:'#f0f0f0',muted:'#888',dim:'#555',
  green:'#4ade80',red:'#f87171',gold:'#f5c842',blue:'#60a5fa',
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
      Tracking market prices — chart appears after first sync
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
  const gainColor=gain>=0?C.green:C.red;
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
    </div>
  );
}

// ── Gain badge used in multiple places ──────────────────────────
function GainBadge({paid,current}){
  if(!paid||!current||paid<=0) return null;
  const gain=current-paid;
  const pct=((gain/paid)*100);
  // Cap display at ±999% for credibility
  const pctCapped=Math.max(-999,Math.min(999,pct));
  const color=gain>=0?C.green:C.red;
  const arrow=gain>=0?'▲':'▼';
  return(
    <span style={{fontSize:10,color,...MONO}}>
      {arrow} {gain>=0?'+':''}{gain.toFixed(0)} ({pctCapped>=0?'+':''}{pctCapped.toFixed(1)}%)
    </span>
  );
}

export default function StatsTab({collection,watchlist}){
  const [portfolio,setPortfolio]=useState(null);
  const [loading,setLoading]=useState(true);

  useEffect(()=>{
    fetch('/api/portfolio').then(r=>r.json()).then(d=>{setPortfolio(d);setLoading(false);}).catch(()=>setLoading(false));
  },[collection.length]);

  // ── Financial calculations ────────────────────────────────────
  const totalPaid    = collection.reduce((s,i)=>s+(Number(i.purchase_price)||0),0);
  const totalCurrent = collection.reduce((s,i)=>s+(Number(i.median_price||i.current_price)||0),0);
  // Fallback: if median price missing for an item, use purchase price
  const totalValue   = collection.reduce((s,i)=>{
    const market=Number(i.median_price||i.current_price);
    const bought=Number(i.purchase_price)||0;
    return s+(market>0?market:bought);
  },0);
  const priceCount   = collection.filter(i=>Number(i.median_price||i.current_price)>0).length;
  const gain         = totalValue - totalPaid;
  const gainPct      = totalPaid>0?((gain/totalPaid)*100):0;
  // Cap for display credibility
  const gainPctDisplay = Math.max(-999,Math.min(999,gainPct)).toFixed(1);
  const avgPrice     = collection.length>0?(totalPaid/collection.length).toFixed(0):0;

  // ── Top gainers / losers ──────────────────────────────────────
  const withGain = collection
    .filter(i=>Number(i.purchase_price)>0&&Number(i.median_price||i.current_price)>0)
    .map(i=>{
      const paid=Number(i.purchase_price);
      const now=Number(i.median_price||i.current_price);
      const gainAbs=now-paid;
      const gainPct=((gainAbs/paid)*100);
      return {...i,gainAbs,gainPct};
    });
  const topGainer  = withGain.length>0?[...withGain].sort((a,b)=>b.gainPct-a.gainPct)[0]:null;
  const topLoser   = withGain.length>1?[...withGain].sort((a,b)=>a.gainPct-b.gainPct)[0]:null;

  // Most valuable
  const mostValuable = [...collection].sort((a,b)=>(Number(b.median_price||b.current_price)||0)-(Number(a.median_price||a.current_price)||0))[0];
  const recentlyAdded = [...collection].sort((a,b)=>new Date(b.added_at||0)-new Date(a.added_at||0))[0];

  const artistMap={};
  collection.forEach(c=>{artistMap[c.artist]=(artistMap[c.artist]||0)+1;});
  const topArtist=Object.entries(artistMap).sort((a,b)=>b[1]-a[1])[0];

  const genreMap={};
  collection.forEach(c=>{const g=c.genre||'Metal';genreMap[g]=(genreMap[g]||0)+1;});
  const genreData=Object.entries(genreMap).sort((a,b)=>b[1]-a[1]).slice(0,6).map(([label,value])=>({label,value}));

  const fmtMap={};
  collection.forEach(c=>{const f=(c.format||'Vinyl').split('·')[0].trim();fmtMap[f]=(fmtMap[f]||0)+1;});
  const fmtData=Object.entries(fmtMap).sort((a,b)=>b[1]-a[1]).slice(0,5).map(([label,value])=>({label,value}));

  const topByValue=[...collection]
    .filter(i=>Number(i.median_price||i.current_price)>0)
    .sort((a,b)=>(Number(b.median_price||b.current_price)||0)-(Number(a.median_price||a.current_price)||0))
    .slice(0,5);

  const COLORS=['#dc2626','#f5c842','#4ade80','#60a5fa','#a78bfa','#f97316'];
  const priceDataAvailable = priceCount>0;

  return(
    <div style={{padding:'0 16px 16px'}}>
      <style>{`@keyframes shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}`}</style>

      {/* Header */}
      <div style={{padding:'16px 0 12px'}}>
        <div style={{...BEBAS,fontSize:28,color:C.text,letterSpacing:'0.06em',lineHeight:1}}>STATISTICS</div>
        <div style={{fontSize:10,color:C.accent,...MONO,letterSpacing:'0.2em',marginTop:2}}>YOUR METAL VAULT OVERVIEW</div>
      </div>

      {/* ═══ HERO: Collection Value Card ═══ */}
      <div style={{
        background:'linear-gradient(135deg,#1a0800 0%,#2a0a00 50%,#1a0800 100%)',
        border:'1px solid '+C.accent,borderRadius:16,padding:'20px',marginBottom:16,
        position:'relative',overflow:'hidden',
      }}>
        {/* decorative bg text */}
        <div style={{position:'absolute',right:-10,top:-10,fontSize:80,opacity:0.04,...BEBAS,userSelect:'none'}}>$</div>
        <div style={{fontSize:10,color:C.accent,...MONO,letterSpacing:'0.2em',textTransform:'uppercase',marginBottom:8}}>
          💰 Collection Value
        </div>
        {loading?(
          <Skeleton h={52} r={6}/>
        ):(
          <div style={{...BEBAS,fontSize:54,color:C.text,lineHeight:1,marginBottom:6}}>
            {totalValue>0?'$'+totalValue.toFixed(0):'—'}
          </div>
        )}
        <div style={{display:'flex',alignItems:'center',gap:12,flexWrap:'wrap'}}>
          {totalPaid>0&&!loading&&(
            <span style={{
              fontSize:15,
              color:gain>=0?C.green:C.red,
              ...MONO,fontWeight:'bold',
            }}>
              {gain>=0?'▲ +$':'▼ $'}{Math.abs(gain).toFixed(0)}
              <span style={{fontSize:11,marginLeft:4,opacity:0.8}}>({gain>=0?'+':''}{gainPctDisplay}%)</span>
            </span>
          )}
          {totalPaid>0&&!loading&&(
            <span style={{fontSize:10,color:C.dim,...MONO}}>vs ${totalPaid.toFixed(0)} paid</span>
          )}
        </div>
        {priceDataAvailable?(
          <div style={{fontSize:9,color:C.dim,...MONO,marginTop:6,letterSpacing:'0.08em'}}>
            Based on Discogs median prices · {priceCount}/{collection.length} records tracked
          </div>
        ):(
          <div style={{fontSize:9,color:'#f5c84299',...MONO,marginTop:6}}>
            Tracking market prices…
          </div>
        )}
      </div>

      {/* Secondary stats grid */}
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginBottom:16}}>
        <StatCard icon="📦" value={collection.length} label="Records" color={C.accent}/>
        <StatCard icon="★" value={watchlist.length} label="Watching" color={C.gold}/>
        <StatCard
          icon="💳"
          value={totalPaid>0?'$'+totalPaid.toFixed(0):'—'}
          label="Total paid"
          color={C.muted}
          loading={loading}
        />
        <StatCard
          icon="📊"
          value={avgPrice>0?'$'+avgPrice:'—'}
          label="Avg per record"
          color={C.blue}
          loading={loading}
        />
      </div>

      {/* Top Gainers / Losers */}
      {(topGainer||topLoser)&&(
        <div style={{background:C.bg2,border:'1px solid '+C.border,borderRadius:12,padding:'16px',marginBottom:16}}>
          <div style={{fontSize:10,color:C.accent,...MONO,letterSpacing:'0.15em',textTransform:'uppercase',marginBottom:12}}>
            📈 Market movers
          </div>
          {topGainer&&(
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:topLoser?10:0}}>
              <div>
                <div style={{fontSize:9,color:C.green,...MONO,letterSpacing:'0.1em',textTransform:'uppercase',marginBottom:2}}>▲ Top gainer</div>
                <div style={{fontSize:12,color:C.text,...MONO,maxWidth:160,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{topGainer.artist}</div>
                <div style={{fontSize:10,color:C.dim,...MONO,maxWidth:160,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{topGainer.album}</div>
              </div>
              <div style={{textAlign:'right'}}>
                <div style={{...BEBAS,fontSize:20,color:C.green,lineHeight:1}}>+{topGainer.gainPct.toFixed(0)}%</div>
                <div style={{fontSize:10,color:C.green,...MONO}}>+${topGainer.gainAbs.toFixed(0)}</div>
                <div style={{fontSize:9,color:C.dim,...MONO}}>${Number(topGainer.purchase_price).toFixed(0)} → ${Number(topGainer.median_price||topGainer.current_price).toFixed(0)}</div>
              </div>
            </div>
          )}
          {topLoser&&topLoser.gainPct<0&&(
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',borderTop:'1px solid '+C.border,paddingTop:10}}>
              <div>
                <div style={{fontSize:9,color:C.red,...MONO,letterSpacing:'0.1em',textTransform:'uppercase',marginBottom:2}}>▼ Biggest drop</div>
                <div style={{fontSize:12,color:C.text,...MONO,maxWidth:160,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{topLoser.artist}</div>
                <div style={{fontSize:10,color:C.dim,...MONO,maxWidth:160,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{topLoser.album}</div>
              </div>
              <div style={{textAlign:'right'}}>
                <div style={{...BEBAS,fontSize:20,color:C.red,lineHeight:1}}>{topLoser.gainPct.toFixed(0)}%</div>
                <div style={{fontSize:10,color:C.red,...MONO}}>${topLoser.gainAbs.toFixed(0)}</div>
                <div style={{fontSize:9,color:C.dim,...MONO}}>${Number(topLoser.purchase_price).toFixed(0)} → ${Number(topLoser.median_price||topLoser.current_price).toFixed(0)}</div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* No price data notice */}
      {collection.length>0&&!priceDataAvailable&&(
        <div style={{background:'#1a1a00',border:'1px solid #55550044',borderRadius:8,padding:'12px 14px',marginBottom:16}}>
          <div style={{fontSize:12,color:C.gold,...MONO,marginBottom:4}}>⏳ First price update in progress</div>
          <div style={{fontSize:10,color:C.dim,...MONO,lineHeight:1.6}}>
            Market values load automatically.<br/>Add records from the album modal to start tracking.
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

      {/* Top by value */}
      {topByValue.length>0&&(
        <div style={{background:C.bg2,border:'1px solid '+C.border,borderRadius:12,padding:'16px',marginBottom:16}}>
          <div style={{fontSize:10,color:C.accent,...MONO,letterSpacing:'0.15em',textTransform:'uppercase',marginBottom:12}}>
            💎 Top by market value
          </div>
          {topByValue.map((item,i)=>{
            const paid=Number(item.purchase_price)||0;
            const now=Number(item.median_price||item.current_price)||0;
            const g=paid>0?now-paid:null;
            const gPct=paid>0?((g/paid)*100).toFixed(0):null;
            return(
              <div key={item.id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'8px 0',borderBottom:i<topByValue.length-1?'1px solid '+C.border:'none'}}>
                <div style={{flex:1,minWidth:0,marginRight:12}}>
                  <div style={{fontSize:12,color:C.text,...MONO,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{item.artist}</div>
                  <div style={{fontSize:10,color:C.dim,...MONO,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{item.album}</div>
                  {paid>0&&<div style={{fontSize:10,color:C.dim,...MONO}}>paid ${paid.toFixed(0)}</div>}
                </div>
                <div style={{textAlign:'right',flexShrink:0}}>
                  <div style={{...BEBAS,fontSize:20,color:C.gold,lineHeight:1}}>${now.toFixed(0)}</div>
                  {g!==null&&(
                    <div style={{fontSize:10,color:g>=0?C.green:C.red,...MONO}}>
                      {g>=0?'+':''}{g.toFixed(0)} ({g>=0?'+':''}{gPct}%)
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Insights */}
      {(topArtist||mostValuable||recentlyAdded)&&(
        <div style={{background:C.bg2,border:'1px solid '+C.border,borderRadius:12,padding:'16px',marginBottom:16}}>
          <div style={{fontSize:10,color:C.accent,...MONO,letterSpacing:'0.15em',textTransform:'uppercase',marginBottom:12}}>Insights</div>
          <div style={{display:'flex',flexDirection:'column',gap:10}}>
            {topArtist&&(
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                <span style={{fontSize:11,color:C.dim,...MONO}}>🔥 Top artist</span>
                <div style={{textAlign:'right'}}>
                  <div style={{fontSize:13,color:C.text,...MONO}}>{topArtist[0]}</div>
                  <div style={{fontSize:10,color:C.dim,...MONO}}>{topArtist[1]} records</div>
                </div>
              </div>
            )}
            {recentlyAdded&&(
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',borderTop:'1px solid '+C.border,paddingTop:10}}>
                <span style={{fontSize:11,color:C.dim,...MONO}}>🆕 Recently added</span>
                <div style={{textAlign:'right'}}>
                  <div style={{fontSize:12,color:C.text,...MONO,maxWidth:150,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{recentlyAdded.artist}</div>
                  <div style={{fontSize:10,color:C.dim,...MONO}}>{(recentlyAdded.added_at||'').split('T')[0]}</div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 🔒 Premium teaser */}
      <div style={{
        background:'linear-gradient(135deg,#0a0a1a,#14142a)',
        border:'1px solid #3333aa55',borderRadius:12,padding:'16px',marginBottom:16,
        position:'relative',overflow:'hidden',
      }}>
        <div style={{position:'absolute',right:12,top:12,fontSize:20,opacity:0.3}}>🔒</div>
        <div style={{fontSize:10,color:'#818cf8',...MONO,letterSpacing:'0.15em',textTransform:'uppercase',marginBottom:8}}>
          Advanced Analytics
        </div>
        <div style={{display:'flex',flexDirection:'column',gap:6,marginBottom:12}}>
          {['📈 Price history per record','🔔 Smart price alerts','📊 30d / 90d portfolio change','🏆 Rarity score per pressing'].map((f,i)=>(
            <div key={i} style={{fontSize:11,color:'#6366f1',...MONO,opacity:0.8}}>{f}</div>
          ))}
        </div>
        <div style={{
          background:'#4f46e5',borderRadius:8,padding:'8px 14px',
          fontSize:11,color:'#fff',...BEBAS,letterSpacing:'0.1em',
          textAlign:'center',opacity:0.85,
        }}>
          Coming soon — Metal Vault Pro
        </div>
      </div>

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
          <BarChart data={fmtData} colorFn={()=>C.blue}/>
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
