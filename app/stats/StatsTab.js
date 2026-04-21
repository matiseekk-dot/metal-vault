'use client';
import { useState, useEffect } from 'react';
import { C, MONO, BEBAS } from '@/lib/theme';

const GRADE_COLORS = {M:'#a78bfa',NM:'#4ade80','VG+':'#60a5fa',VG:'#f5c842','G+':'#f97316',G:'#f87171',F:'#888',P:'#555'};
const GRADE_ORDER  = ['M','NM','VG+','VG','G+','G','F','P'];

function Skeleton({w='100%',h=20,r=4}){
  return <div style={{width:w,height:h,borderRadius:r,background:'linear-gradient(90deg,#1e1e1e 25%,#252525 50%,#1e1e1e 75%)',backgroundSize:'200% 100%',animation:'shimmer 1.5s infinite'}}/>;
}

function StatCard({icon,value,label,color=C.accent,sub,loading}){
  return(
    <div style={{background:C.bg2,border:'1px solid '+C.border,borderRadius:12,padding:'14px',textAlign:'center'}}>
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
            <div style={{height:'100%',borderRadius:4,width:(d.value/max*100)+'%',background:colorFn?colorFn(i,d):C.accent,transition:'width 0.6s ease',display:'flex',alignItems:'center',justifyContent:'flex-end',paddingRight:6}}>
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
          return(<g key={pi}><line x1={PL} x2={W-PR} y1={y} y2={y} stroke={C.border} strokeWidth="1"/><text x={PL-3} y={y+3} textAnchor="end" fontSize="7" fill={C.dim}>{val.toFixed(0)}</text></g>);
        })}
        <polygon points={PL+','+(H-PB)+' '+pts+' '+(W-PR)+','+(H-PB)} fill="url(#pg)"/>
        <polyline points={pts} fill="none" stroke={C.accent} strokeWidth="1.5"/>
        {snapshots.map((s,i)=>{const parts=pts.split(' ')[i].split(',');return<circle key={i} cx={parseFloat(parts[0])} cy={parseFloat(parts[1])} r="2.5" fill={C.accent}/>;  })}
      </svg>
    </div>
  );
}

// ── Badges ────────────────────────────────────────────────────
function BadgesSection({ collection, watchlist }) {
  const count = collection.length;
  const hasLimited = collection.some(i => i.grade === 'M' || (i.format||'').toLowerCase().includes('limited'));
  const hasVariant = collection.some(i => i.format && i.format.split(',').length > 2);
  const artistMap = {};
  collection.forEach(i => { artistMap[i.artist] = (artistMap[i.artist]||0)+1; });
  const maxArtist = Object.values(artistMap).reduce((m,v)=>Math.max(m,v),0);

  const all = [
    { id:'first',   icon:'🎵', label:'First Vinyl',     desc:'Added your first record',            earned: count>=1 },
    { id:'ten',     icon:'📦', label:'10 Records',      desc:'Collection of 10',                   earned: count>=10 },
    { id:'fifty',   icon:'🔥', label:'50 Records',      desc:'Serious collector',                  earned: count>=50 },
    { id:'hundred', icon:'💯', label:'100 Records',     desc:'Century club',                       earned: count>=100 },
    { id:'double',  icon:'🏆', label:'200 Records',     desc:'Elite collection',                   earned: count>=200 },
    { id:'limited', icon:'💎', label:'Limited Edition', desc:'First limited pressing',             earned: hasLimited },
    { id:'variant', icon:'🎭', label:'Variant Hunter',  desc:'Multi-format release owned',         earned: hasVariant },
    { id:'fan',     icon:'⭐', label:'Super Fan',       desc:'5+ albums of one artist',            earned: maxArtist>=5 },
    { id:'watch',   icon:'👀', label:'Wantlist 10',     desc:'10 items on watchlist',              earned: watchlist.length>=10 },
    { id:'watcher', icon:'🔭', label:'Wantlist 50',     desc:'50 items on watchlist',              earned: watchlist.length>=50 },
  ];

  const earned = all.filter(b=>b.earned);
  const locked = all.filter(b=>!b.earned);
  const pct    = Math.round((earned.length/all.length)*100);

  return (
    <div style={{background:C.bg2,border:'1px solid '+C.border,borderRadius:12,padding:'16px',marginBottom:16}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
        <div style={{fontSize:10,color:C.accent,...MONO,letterSpacing:'0.15em',textTransform:'uppercase'}}>
          🏅 Badges
        </div>
        <div style={{fontSize:10,color:C.dim,...MONO}}>{earned.length}/{all.length} · {pct}%</div>
      </div>
      {/* Progress bar */}
      <div style={{height:4,background:C.bg3,borderRadius:2,marginBottom:12,overflow:'hidden'}}>
        <div style={{height:'100%',background:'linear-gradient(90deg,'+C.accent+','+C.gold+')',
          width:pct+'%',borderRadius:2,transition:'width 0.6s'}}/>
      </div>
      {/* Earned */}
      <div style={{display:'flex',flexWrap:'wrap',gap:6,marginBottom:earned.length&&locked.length?10:0}}>
        {earned.map(b=>(
          <div key={b.id} title={b.desc}
            style={{background:'#1a0800',border:'1px solid '+C.accent+'44',
              borderRadius:8,padding:'6px 10px',display:'flex',alignItems:'center',gap:6}}>
            <span style={{fontSize:14}}>{b.icon}</span>
            <span style={{fontSize:10,color:C.text,...MONO}}>{b.label}</span>
          </div>
        ))}
      </div>
      {/* Locked */}
      {locked.length>0&&(
        <div style={{display:'flex',flexWrap:'wrap',gap:6}}>
          {locked.slice(0,4).map(b=>(
            <div key={b.id} title={b.desc}
              style={{background:C.bg3,border:'1px solid '+C.border,
                borderRadius:8,padding:'6px 10px',display:'flex',alignItems:'center',gap:6,
                opacity:0.5}}>
              <span style={{fontSize:14,filter:'grayscale(1)'}}>{b.icon}</span>
              <span style={{fontSize:10,color:C.dim,...MONO}}>{b.label}</span>
            </div>
          ))}
          {locked.length>4&&<div style={{fontSize:10,color:C.dim,...MONO,padding:'6px 4px'}}>+{locked.length-4} more</div>}
        </div>
      )}
    </div>
  );
}

// ── Sell suggestions ──────────────────────────────────────────
function SellSuggestions({ collection }) {
  const candidates = collection
    .filter(i => {
      const paid = Number(i.purchase_price);
      const now  = Number(i.median_price||i.current_price);
      if (!paid || !now) return false;
      const gain = (now-paid)/paid*100;
      return gain >= 50; // 50%+ gain
    })
    .map(i => {
      const paid = Number(i.purchase_price);
      const now  = Number(i.median_price||i.current_price);
      const gainAbs = now - paid;
      const gainPct = ((gainAbs/paid)*100);
      return { ...i, gainAbs, gainPct };
    })
    .sort((a,b) => b.gainPct - a.gainPct)
    .slice(0, 5);

  if (!candidates.length) return null;

  return (
    <div style={{background:C.bg2,border:'1px solid #1a3d1a',borderRadius:12,padding:'16px',marginBottom:16}}>
      <div style={{fontSize:10,color:C.green,...MONO,letterSpacing:'0.15em',textTransform:'uppercase',marginBottom:12}}>
        💸 Consider Selling
      </div>
      {candidates.map((item,i) => (
        <div key={item.id} style={{
          display:'flex',justifyContent:'space-between',alignItems:'center',
          padding:'8px 0',borderBottom:i<candidates.length-1?'1px solid '+C.border:'none',
        }}>
          <div style={{flex:1,minWidth:0,marginRight:12}}>
            <div style={{fontSize:12,color:C.text,...MONO,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{item.artist}</div>
            <div style={{fontSize:10,color:C.dim,...MONO,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{item.album}</div>
            <div style={{fontSize:10,color:C.dim,...MONO,marginTop:1}}>
              paid ${Number(item.purchase_price).toFixed(0)} → now ${Number(item.median_price||item.current_price).toFixed(0)}
            </div>
          </div>
          <div style={{textAlign:'right',flexShrink:0}}>
            <div style={{...BEBAS,fontSize:20,color:C.green,lineHeight:1}}>+{item.gainPct.toFixed(0)}%</div>
            <div style={{fontSize:10,color:C.green,...MONO}}>+${item.gainAbs.toFixed(0)}</div>
          </div>
        </div>
      ))}
      <div style={{fontSize:9,color:C.dim,...MONO,marginTop:8,lineHeight:1.5}}>
        Based on Discogs median prices. Sell on Discogs Marketplace.
      </div>
    </div>
  );
}

// ── Grade distribution ────────────────────────────────────────
function GradeChart({ collection }) {
  const gradeMap = {};
  collection.forEach(i => {
    const g = i.grade || 'NM'; // default NM if unset
    gradeMap[g] = (gradeMap[g]||0)+1;
  });
  const graded = collection.filter(i=>i.grade).length;
  const data = GRADE_ORDER
    .filter(g => gradeMap[g])
    .map(g => ({ label:g, value:gradeMap[g], pct:Math.round(gradeMap[g]/collection.length*100) }));

  if (!data.length) return null;

  return (
    <div style={{background:C.bg2,border:'1px solid '+C.border,borderRadius:12,padding:'16px',marginBottom:16}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
        <div style={{fontSize:10,color:C.accent,...MONO,letterSpacing:'0.15em',textTransform:'uppercase'}}>
          📊 Condition Breakdown
        </div>
        <div style={{fontSize:9,color:C.dim,...MONO}}>{graded}/{collection.length} graded</div>
      </div>
      {/* Stacked bar */}
      <div style={{display:'flex',height:12,borderRadius:6,overflow:'hidden',marginBottom:12}}>
        {data.map(d=>(
          <div key={d.label} title={d.label+': '+d.value}
            style={{flex:d.value,background:GRADE_COLORS[d.label]||C.dim,transition:'flex 0.4s'}}/>
        ))}
      </div>
      {/* Legend */}
      <div style={{display:'flex',flexWrap:'wrap',gap:8}}>
        {data.map(d=>(
          <div key={d.label} style={{display:'flex',alignItems:'center',gap:4}}>
            <div style={{width:8,height:8,borderRadius:2,background:GRADE_COLORS[d.label]||C.dim,flexShrink:0}}/>
            <span style={{fontSize:10,color:C.muted,...MONO}}>{d.label}</span>
            <span style={{fontSize:10,color:C.dim,...MONO}}>({d.value})</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Label tracking (from followed labels in collection) ───────
function TopLabels({ collection }) {
  const labelMap = {};
  collection.forEach(i => {
    const l = i.label;
    if (l) labelMap[l] = (labelMap[l]||0)+1;
  });
  const data = Object.entries(labelMap)
    .sort((a,b)=>b[1]-a[1]).slice(0,8)
    .map(([label,value])=>({label,value}));
  if (!data.length) return null;

  return (
    <div style={{background:C.bg2,border:'1px solid '+C.border,borderRadius:12,padding:'16px',marginBottom:16}}>
      <div style={{fontSize:10,color:C.accent,...MONO,letterSpacing:'0.15em',textTransform:'uppercase',marginBottom:12}}>
        🏷 Top Labels
      </div>
      <BarChart data={data} colorFn={()=>'#a78bfa'}/>
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────
// ── PersonaCard — shareable metal identity card ──
function PersonaCard() {
  const [persona, setPersona] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sharing, setSharing] = useState(false);

  useEffect(() => {
    fetch('/api/persona')
      .then(r => r.json())
      .then(d => { setPersona(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  // Render the persona as PNG for sharing — draws on offscreen canvas
  const sharePersona = async () => {
    if (!persona || persona.empty || sharing) return;
    setSharing(true);
    try {
      const canvas = document.createElement('canvas');
      const W = 1080, H = 1350; // Instagram Story / portrait
      canvas.width = W; canvas.height = H;
      const ctx = canvas.getContext('2d');

      // Background gradient (dark red → black, matching app aesthetic)
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, '#2a0a0a'); g.addColorStop(0.5, '#1a0505'); g.addColorStop(1, '#0a0a0a');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

      // Subtle red top bar
      ctx.fillStyle = '#dc2626'; ctx.fillRect(0, 0, W, 12);

      // Header
      ctx.fillStyle = '#dc2626';
      ctx.font = 'bold 32px Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('METAL VAULT PERSONA', W/2, 100);

      // Persona title (BIG)
      ctx.fillStyle = '#f0f0f0';
      ctx.font = 'bold 72px Arial, sans-serif';
      // Wrap long titles
      const words = persona.title.toUpperCase().split(' ');
      if (words.length > 2) {
        ctx.fillText(words.slice(0, Math.ceil(words.length/2)).join(' '), W/2, 260);
        ctx.fillText(words.slice(Math.ceil(words.length/2)).join(' '), W/2, 340);
      } else {
        ctx.fillText(persona.title.toUpperCase(), W/2, 300);
      }

      // Stats block
      ctx.fillStyle = '#888'; ctx.font = '26px monospace';
      ctx.fillText(persona.stats.recordCount + ' RECORDS · ' + persona.stats.uniqueArtists + ' ARTISTS',
                   W/2, 440);
      ctx.fillStyle = '#f5c842'; ctx.font = 'bold 96px Arial, sans-serif';
      ctx.fillText('$' + persona.stats.totalValue, W/2, 560);
      ctx.fillStyle = persona.stats.gain >= 0 ? '#4ade80' : '#f87171';
      ctx.font = '28px monospace';
      const gainStr = (persona.stats.gain >= 0 ? '+' : '') + '$' + persona.stats.gain
                    + ' (' + (persona.stats.gainPct >= 0 ? '+' : '') + persona.stats.gainPct + '%)';
      ctx.fillText(gainStr, W/2, 610);

      // Top genres block
      ctx.fillStyle = '#dc2626'; ctx.font = 'bold 22px monospace';
      ctx.textAlign = 'left';
      ctx.fillText('TOP GENRES', 100, 760);
      ctx.fillStyle = '#f0f0f0'; ctx.font = '28px Arial, sans-serif';
      let y = 810;
      for (const g of persona.top3Genres.slice(0, 3)) {
        ctx.fillText(g.name, 100, y);
        ctx.fillStyle = '#888'; ctx.font = '24px monospace';
        ctx.fillText(g.pct + '%', W - 180, y);
        ctx.fillStyle = '#f0f0f0'; ctx.font = '28px Arial, sans-serif';
        y += 55;
      }

      // Era + label block
      ctx.fillStyle = '#dc2626'; ctx.font = 'bold 22px monospace';
      ctx.fillText('ERA', 100, 1020);
      ctx.fillStyle = '#f0f0f0'; ctx.font = 'bold 36px Arial, sans-serif';
      ctx.fillText(persona.topEra, 100, 1075);

      if (persona.topLabel) {
        ctx.fillStyle = '#dc2626'; ctx.font = 'bold 22px monospace';
        ctx.fillText('TOP LABEL', W/2 + 50, 1020);
        ctx.fillStyle = '#f0f0f0'; ctx.font = 'bold 32px Arial, sans-serif';
        const labelText = persona.topLabel.name.length > 18
          ? persona.topLabel.name.substring(0, 18) + '…'
          : persona.topLabel.name;
        ctx.fillText(labelText, W/2 + 50, 1070);
      }

      // Footer
      ctx.fillStyle = '#555'; ctx.font = '22px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('metal-vault-six.vercel.app', W/2, 1290);

      // Convert to blob and share
      canvas.toBlob(async blob => {
        if (!blob) { setSharing(false); return; }
        const file = new File([blob], 'metal-persona.png', { type: 'image/png' });
        // Prefer native share (iOS/Android support this)
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          try {
            await navigator.share({
              files: [file],
              title: 'My Metal Vault Persona',
              text: 'I\'m a ' + persona.title + ' — built with Metal Vault',
            });
          } catch {} // user canceled
        } else {
          // Fallback: download
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url; a.download = 'metal-persona.png'; a.click();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        }
        setSharing(false);
      }, 'image/png');
    } catch (e) {
      console.error('Share error:', e);
      setSharing(false);
    }
  };

  if (loading) {
    return (
      <div style={{ background: 'linear-gradient(135deg,#1a0505,#0a0a0a)', border: '1px solid #3a0a0a',
        borderRadius: 14, padding: 20, marginBottom: 16 }}>
        <Skeleton h={120} r={8}/>
      </div>
    );
  }
  if (!persona || persona.empty) return null;

  return (
    <div style={{
      background: 'linear-gradient(135deg,#2a0808,#1a0404 40%,#0a0a0a)',
      border: '2px solid #7f1d1d',
      borderRadius: 14, padding: 20, marginBottom: 16, position: 'relative', overflow: 'hidden',
    }}>
      {/* Diagonal stripe accent */}
      <div style={{ position:'absolute', top:0, right:-30, width:80, height:8, background:'#dc2626', transform:'rotate(-3deg)', opacity:0.4 }}/>

      <div style={{ fontSize: 9, color: '#dc2626', letterSpacing: '0.25em', ...MONO, marginBottom: 4 }}>
        YOUR METAL PERSONA
      </div>
      <div style={{ ...BEBAS, fontSize: 32, color: '#f0f0f0', letterSpacing: '0.03em', lineHeight: 1.1, marginBottom: 12 }}>
        {persona.title}
      </div>

      {/* Stats row */}
      <div style={{ display: 'flex', gap: 14, marginBottom: 14, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 10, color: '#888', ...MONO }}>Records</div>
          <div style={{ ...BEBAS, fontSize: 20, color: '#f0f0f0' }}>{persona.stats.recordCount}</div>
        </div>
        <div>
          <div style={{ fontSize: 10, color: '#888', ...MONO }}>Value</div>
          <div style={{ ...BEBAS, fontSize: 20, color: '#f5c842' }}>${persona.stats.totalValue}</div>
        </div>
        <div>
          <div style={{ fontSize: 10, color: '#888', ...MONO }}>Era</div>
          <div style={{ ...BEBAS, fontSize: 20, color: '#f0f0f0' }}>{persona.topEra}</div>
        </div>
        {persona.topLabel && (
          <div style={{ flex: 1, minWidth: 100 }}>
            <div style={{ fontSize: 10, color: '#888', ...MONO }}>Top label</div>
            <div style={{ fontSize: 13, color: '#f0f0f0', ...MONO, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
              {persona.topLabel.name}
            </div>
          </div>
        )}
      </div>

      {/* Top 3 genres */}
      <div style={{ marginBottom: 12 }}>
        {persona.top3Genres.map((g, idx) => (
          <div key={g.name} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
            <div style={{ fontSize: 11, color: idx === 0 ? '#dc2626' : '#888', ...MONO, width: 16 }}>
              {idx + 1}.
            </div>
            <div style={{ fontSize: 12, color: '#f0f0f0', flex: 1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
              {g.name}
            </div>
            <div style={{ width: 60, height: 4, background: '#222', borderRadius: 2, overflow: 'hidden' }}>
              <div style={{ width: g.pct + '%', height: '100%', background: idx === 0 ? '#dc2626' : '#7f1d1d' }}/>
            </div>
            <div style={{ fontSize: 10, color: '#888', ...MONO, width: 32, textAlign: 'right' }}>{g.pct}%</div>
          </div>
        ))}
      </div>

      {/* Crown jewel */}
      {persona.crownJewel && (
        <div style={{ background: '#0a0a0a', border: '1px solid #3a2a00', borderRadius: 8, padding: 10, marginBottom: 12 }}>
          <div style={{ fontSize: 9, color: '#f5c842', letterSpacing: '0.2em', ...MONO }}>👑 CROWN JEWEL</div>
          <div style={{ fontSize: 13, color: '#f0f0f0', ...BEBAS, letterSpacing: '0.03em', marginTop: 3 }}>
            {persona.crownJewel.artist}
          </div>
          <div style={{ fontSize: 11, color: '#888', ...MONO, display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', flex: 1 }}>{persona.crownJewel.album}</span>
            <span style={{ color: '#f5c842', flexShrink: 0, marginLeft: 8 }}>${Math.round(persona.crownJewel.value)}</span>
          </div>
        </div>
      )}

      <button onClick={sharePersona} disabled={sharing}
        style={{ width: '100%', background: '#dc2626', border: 'none', borderRadius: 8,
          color: '#fff', padding: '12px', cursor: 'pointer', ...BEBAS, fontSize: 15,
          letterSpacing: '0.1em', opacity: sharing ? 0.6 : 1 }}>
        {sharing ? 'GENERATING…' : '📤 SHARE PERSONA'}
      </button>
    </div>
  );
}

export default function StatsTab({collection,watchlist}){
  const [portfolio,setPortfolio]=useState(null);
  const [loading,setLoading]=useState(true);

  useEffect(()=>{
    fetch('/api/portfolio').then(r=>r.json()).then(d=>{setPortfolio(d);setLoading(false);}).catch(()=>setLoading(false));
  },[collection.length]);

  const totalPaid    = collection.reduce((s,i)=>s+(Number(i.purchase_price)||0),0);
  const marketVal    = collection.reduce((s,i)=>s+(Number(i.median_price||i.current_price)||0),0);
  const totalValue   = collection.reduce((s,i)=>{
    const m=Number(i.median_price||i.current_price);
    return s+(m>0?m:(Number(i.purchase_price)||0));
  },0);
  const priceCount   = collection.filter(i=>Number(i.median_price||i.current_price)>0).length;
  const gain         = totalValue-totalPaid;
  const gainPct      = totalPaid>0?Math.max(-999,Math.min(999,(gain/totalPaid)*100)):0;

  const withGain=collection.filter(i=>Number(i.purchase_price)>0&&Number(i.median_price||i.current_price)>0)
    .map(i=>{const paid=Number(i.purchase_price),now=Number(i.median_price||i.current_price);return{...i,gainAbs:now-paid,gainPct:(now-paid)/paid*100};});
  const topGainer=withGain.length?[...withGain].sort((a,b)=>b.gainPct-a.gainPct)[0]:null;
  const topLoser=withGain.length>1?[...withGain].sort((a,b)=>a.gainPct-b.gainPct)[0]:null;

  const mostValuable=[...collection].sort((a,b)=>(Number(b.median_price||b.current_price)||0)-(Number(a.median_price||a.current_price)||0))[0];
  const recentlyAdded=[...collection].sort((a,b)=>new Date(b.added_at||0)-new Date(a.added_at||0))[0];
  const artistMap={};collection.forEach(c=>{artistMap[c.artist]=(artistMap[c.artist]||0)+1;});
  const topArtist=Object.entries(artistMap).sort((a,b)=>b[1]-a[1])[0];

  const genreMap={};collection.forEach(c=>{const g=c.genre||(c.genres||[])[0]||c.styles?.[0]||'Metal';genreMap[g]=(genreMap[g]||0)+1;});
  const genreData=Object.entries(genreMap).sort((a,b)=>b[1]-a[1]).slice(0,6).map(([label,value])=>({label,value}));

  const COLORS=['#dc2626','#f5c842','#4ade80','#60a5fa','#a78bfa','#f97316'];

  const topByValue=[...collection].filter(i=>Number(i.median_price||i.current_price)>0)
    .sort((a,b)=>(Number(b.median_price||b.current_price)||0)-(Number(a.median_price||a.current_price)||0)).slice(0,5);

  return(
    <div style={{padding:'0 16px 16px'}}>
      <style>{`@keyframes shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}`}</style>

      <div style={{padding:'16px 0 12px'}}>
        <div style={{...BEBAS,fontSize:28,color:C.text,letterSpacing:'0.06em',lineHeight:1}}>STATISTICS</div>
        <div style={{fontSize:10,color:C.accent,...MONO,letterSpacing:'0.2em',marginTop:2}}>YOUR METAL VAULT OVERVIEW</div>

      {/* Persona Card — algorithmic metal identity, shareable as PNG */}
      <PersonaCard/>
      </div>

      {/* Hero value card */}
      <div style={{background:'linear-gradient(135deg,#1a0800,#2a0a00,#1a0800)',
        border:'1px solid '+C.accent,borderRadius:16,padding:'20px',marginBottom:16,
        position:'relative',overflow:'hidden'}}>
        <div style={{position:'absolute',right:-10,top:-10,fontSize:80,opacity:0.04,...BEBAS,userSelect:'none'}}>$</div>
        <div style={{fontSize:10,color:C.accent,...MONO,letterSpacing:'0.2em',textTransform:'uppercase',marginBottom:8}}>
          💰 Collection Value
        </div>
        {loading?<Skeleton h={52} r={6}/>:(
          <div style={{...BEBAS,fontSize:54,color:C.text,lineHeight:1,marginBottom:6}}>
            {totalValue>0?'$'+totalValue.toFixed(0):'—'}
          </div>
        )}
        <div style={{display:'flex',alignItems:'center',gap:12,flexWrap:'wrap'}}>
          {totalPaid>0&&!loading&&(
            <span style={{fontSize:15,color:gain>=0?C.green:C.red,...MONO,fontWeight:'bold'}}>
              {gain>=0?'▲ +$':'▼ -$'}{Math.abs(gain).toFixed(0)}
              <span style={{fontSize:11,marginLeft:4,opacity:0.8}}>({gain>=0?'+':''}{gainPct.toFixed(1)}%)</span>
            </span>
          )}
          {totalPaid>0&&!loading&&<span style={{fontSize:10,color:C.dim,...MONO}}>vs ${totalPaid.toFixed(0)} paid</span>}
        </div>
        <div style={{fontSize:9,color:priceCount>0?C.dim:'#f5c84299',...MONO,marginTop:6}}>
          {priceCount>0?'Based on Discogs median · '+priceCount+'/'+collection.length+' tracked':'⏳ Tracking market prices…'}
        </div>
      </div>

      {/* Secondary stats */}
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginBottom:16}}>
        <StatCard icon="📦" value={collection.length} label="Records" color={C.accent}/>
        <StatCard icon="★"  value={watchlist.length}  label="Watching" color={C.gold}/>
        <StatCard icon="💳" value={totalPaid>0?'$'+totalPaid.toFixed(0):'—'} label="Total paid" color={C.muted} loading={loading}/>
        <StatCard icon="📊" value={collection.length>0?'$'+(totalPaid/collection.length).toFixed(0):'—'} label="Avg record" color={C.blue}/>
      </div>

      {/* Badges */}
      <BadgesSection collection={collection} watchlist={watchlist}/>

      {/* Sell suggestions */}
      <SellSuggestions collection={collection}/>

      {/* Market movers */}
      {(topGainer||topLoser)&&(
        <div style={{background:C.bg2,border:'1px solid '+C.border,borderRadius:12,padding:'16px',marginBottom:16}}>
          <div style={{fontSize:10,color:C.accent,...MONO,letterSpacing:'0.15em',textTransform:'uppercase',marginBottom:12}}>📈 Market movers</div>
          {topGainer&&(
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:topLoser&&topLoser.gainPct<0?10:0}}>
              <div>
                <div style={{fontSize:9,color:C.green,...MONO,letterSpacing:'0.1em',textTransform:'uppercase',marginBottom:2}}>▲ Top gainer</div>
                <div style={{fontSize:12,color:C.text,...MONO,maxWidth:160,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{topGainer.artist}</div>
                <div style={{fontSize:10,color:C.dim,...MONO}}>{topGainer.album}</div>
              </div>
              <div style={{textAlign:'right'}}>
                <div style={{...BEBAS,fontSize:20,color:C.green,lineHeight:1}}>+{topGainer.gainPct.toFixed(0)}%</div>
                <div style={{fontSize:10,color:C.green,...MONO}}>+${topGainer.gainAbs.toFixed(0)}</div>
              </div>
            </div>
          )}
          {topLoser&&topLoser.gainPct<0&&(
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',borderTop:'1px solid '+C.border,paddingTop:10}}>
              <div>
                <div style={{fontSize:9,color:C.red,...MONO,letterSpacing:'0.1em',textTransform:'uppercase',marginBottom:2}}>▼ Biggest drop</div>
                <div style={{fontSize:12,color:C.text,...MONO,maxWidth:160,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{topLoser.artist}</div>
                <div style={{fontSize:10,color:C.dim,...MONO}}>{topLoser.album}</div>
              </div>
              <div style={{textAlign:'right'}}>
                <div style={{...BEBAS,fontSize:20,color:C.red,lineHeight:1}}>{topLoser.gainPct.toFixed(0)}%</div>
                <div style={{fontSize:10,color:C.red,...MONO}}>${topLoser.gainAbs.toFixed(0)}</div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* No price data notice */}
      {collection.length>0&&!priceCount&&(
        <div style={{background:'#1a1a00',border:'1px solid #55550044',borderRadius:8,padding:'12px 14px',marginBottom:16}}>
          <div style={{fontSize:12,color:C.gold,...MONO,marginBottom:4}}>⏳ First price update in progress</div>
          <div style={{fontSize:10,color:C.dim,...MONO,lineHeight:1.6}}>Market values load automatically. Add records from the album modal to start tracking.</div>
        </div>
      )}

      {/* Portfolio chart */}
      {portfolio?.snapshots?.length>=2&&(
        <div style={{background:C.bg2,border:'1px solid '+C.border,borderRadius:12,padding:'16px',marginBottom:16}}>
          <div style={{fontSize:10,color:C.accent,...MONO,letterSpacing:'0.15em',textTransform:'uppercase',marginBottom:12}}>Collection value over time</div>
          <PortfolioChart snapshots={portfolio.snapshots}/>
        </div>
      )}

      {/* Grade distribution */}
      <GradeChart collection={collection}/>

      {/* Top by value */}
      {topByValue.length>0&&(
        <div style={{background:C.bg2,border:'1px solid '+C.border,borderRadius:12,padding:'16px',marginBottom:16}}>
          <div style={{fontSize:10,color:C.accent,...MONO,letterSpacing:'0.15em',textTransform:'uppercase',marginBottom:12}}>💎 Top by market value</div>
          {topByValue.map((item,i)=>{
            const paid=Number(item.purchase_price)||0,now=Number(item.median_price||item.current_price)||0;
            const g=paid>0?now-paid:null,gPct=g!==null?((g/paid)*100).toFixed(0):null;
            return(
              <div key={item.id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'8px 0',borderBottom:i<topByValue.length-1?'1px solid '+C.border:'none'}}>
                <div style={{flex:1,minWidth:0,marginRight:12}}>
                  <div style={{fontSize:12,color:C.text,...MONO,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{item.artist}</div>
                  <div style={{fontSize:10,color:C.dim,...MONO,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{item.album}</div>
                  {paid>0&&<div style={{fontSize:9,color:C.dim,...MONO}}>paid ${paid.toFixed(0)}</div>}
                </div>
                <div style={{textAlign:'right',flexShrink:0}}>
                  <div style={{...BEBAS,fontSize:20,color:C.gold,lineHeight:1}}>${now.toFixed(0)}</div>
                  {g!==null&&<div style={{fontSize:10,color:g>=0?C.green:C.red,...MONO}}>{g>=0?'+':''}{g.toFixed(0)} ({g>=0?'+':''}{gPct}%)</div>}
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

      {/* Label tracking */}
      <TopLabels collection={collection}/>

      {/* Genre */}
      {genreData.length>0&&(
        <div style={{background:C.bg2,border:'1px solid '+C.border,borderRadius:12,padding:'16px',marginBottom:16}}>
          <div style={{fontSize:10,color:C.accent,...MONO,letterSpacing:'0.15em',textTransform:'uppercase',marginBottom:12}}>Collection by genre</div>
          <BarChart data={genreData} colorFn={i=>COLORS[i%COLORS.length]}/>
        </div>
      )}


      {/* Yearly spending */}
      {collection.length > 0 && (() => {
        const byYear = {};
        collection.forEach(i => {
          const y = i.date_added
            ? new Date(i.date_added).getFullYear()
            : i.added_at
              ? new Date(i.added_at).getFullYear()
              : null;
          if (!y) return;
          if (!byYear[y]) byYear[y] = { spent: 0, count: 0 };
          byYear[y].spent += Number(i.purchase_price) || 0;
          byYear[y].count++;
        });
        const years = Object.entries(byYear)
          .sort((a, b) => b[0] - a[0])
          .filter(([, v]) => v.count > 0);
        if (!years.length) return null;
        const maxSpent = Math.max(...years.map(([, v]) => v.spent), 1);
        return (
          <div style={{ background: C.bg2, border: '1px solid ' + C.border, borderRadius: 12, padding: '16px', marginBottom: 16 }}>
            <div style={{ fontSize: 10, color: C.accent, ...MONO, letterSpacing: '0.15em', textTransform: 'uppercase', marginBottom: 14 }}>
              📅 Spending by year
            </div>
            {years.map(([year, data]) => (
              <div key={year} style={{ marginBottom: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ fontSize: 12, color: C.text, ...MONO }}>{year}</span>
                  <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                    <span style={{ fontSize: 10, color: C.dim, ...MONO }}>{data.count} record{data.count !== 1 ? 's' : ''}</span>
                    <span style={{ fontSize: 13, color: C.gold, ...MONO, fontWeight: 'bold' }}>
                      {data.spent > 0 ? '$' + data.spent.toFixed(0) : '—'}
                    </span>
                  </div>
                </div>
                <div style={{ height: 8, background: C.bg3, borderRadius: 4, overflow: 'hidden' }}>
                  <div style={{
                    height: '100%', borderRadius: 4,
                    width: data.spent > 0 ? (data.spent / maxSpent * 100) + '%' : '0%',
                    background: 'linear-gradient(90deg, ' + C.accent + ', ' + C.gold + ')',
                    transition: 'width 0.6s ease',
                  }} />
                </div>
              </div>
            ))}
            <div style={{ fontSize: 9, color: C.dim, ...MONO, marginTop: 4, textAlign: 'right' }}>
              Total all time: ${collection.reduce((s, i) => s + (Number(i.purchase_price) || 0), 0).toFixed(0)}
            </div>
          </div>
        );
      })()}

      {/* Pro teaser */}
      <div style={{background:'linear-gradient(135deg,#0a0a1a,#14142a)',
        border:'1px solid #3333aa55',borderRadius:12,padding:'16px',marginBottom:16,position:'relative',overflow:'hidden'}}>
        <div style={{position:'absolute',right:12,top:12,fontSize:20,opacity:0.3}}>🔒</div>
        <div style={{fontSize:10,color:'#818cf8',...MONO,letterSpacing:'0.15em',textTransform:'uppercase',marginBottom:8}}>Advanced Analytics</div>
        {['📈 Price history per record','🔔 Smart price alerts','📊 30d / 90d portfolio change','🏆 Rarity score per pressing'].map((f,i)=>(
          <div key={i} style={{fontSize:11,color:'#6366f1',...MONO,opacity:0.8,marginBottom:4}}>{f}</div>
        ))}
        <div style={{background:'#4f46e5',borderRadius:8,padding:'8px 14px',fontSize:11,color:'#fff',...BEBAS,letterSpacing:'0.1em',textAlign:'center',opacity:0.85,marginTop:8}}>
          Coming soon — Metal Vault Pro
        </div>
      </div>

      {collection.length===0&&(
        <div style={{textAlign:'center',padding:'40px 0',color:C.dim,...MONO}}>
          <div style={{fontSize:40,marginBottom:12}}>📊</div>
          <div style={{fontSize:13,lineHeight:1.7}}>Add records to your collection<br/>to see statistics here</div>
        </div>
      )}
    </div>
  );
}
