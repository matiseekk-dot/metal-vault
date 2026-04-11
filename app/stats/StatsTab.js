'use client';
import { useState, useEffect } from 'react';

const C = {
  bg:'#0a0a0a', bg2:'#141414', bg3:'#1e1e1e', bg4:'#252525',
  border:'#2a2a2a', accent:'#dc2626', accent2:'#991b1b',
  text:'#f0f0f0', muted:'#888', dim:'#555',
};
const MONO  = { fontFamily:"'Space Mono',monospace" };
const BEBAS = { fontFamily:"'Bebas Neue',sans-serif" };

function StatCard({ icon, value, label, color = C.accent, sub }) {
  return (
    <div style={{ background:C.bg2, border:`1px solid ${C.border}`, borderRadius:12,
      padding:'16px', textAlign:'center' }}>
      <div style={{ fontSize:24, marginBottom:4 }}>{icon}</div>
      <div style={{ ...BEBAS, fontSize:32, color, lineHeight:1 }}>{value}</div>
      <div style={{ fontSize:9, color:C.dim, ...MONO, letterSpacing:'0.12em',
        textTransform:'uppercase', marginTop:4 }}>{label}</div>
      {sub && <div style={{ fontSize:10, color:C.muted, ...MONO, marginTop:4 }}>{sub}</div>}
    </div>
  );
}

function BarChart({ data, colorFn }) {
  const max = Math.max(...data.map(d => d.value), 1);
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
      {data.map((d, i) => (
        <div key={i} style={{ display:'flex', alignItems:'center', gap:8 }}>
          <div style={{ fontSize:11, color:C.muted, ...MONO, width:120, flexShrink:0,
            overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
            {d.label}
          </div>
          <div style={{ flex:1, height:20, background:C.bg3, borderRadius:4, overflow:'hidden' }}>
            <div style={{
              height:'100%', borderRadius:4,
              width:`${(d.value / max) * 100}%`,
              background: colorFn ? colorFn(i) : C.accent,
              transition:'width 0.5s ease',
              display:'flex', alignItems:'center', justifyContent:'flex-end', paddingRight:6,
            }}>
              {d.value > 0 && (
                <span style={{ fontSize:9, color:'#fff', ...MONO }}>{d.value}</span>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function PortfolioChart({ snapshots }) {
  if (!snapshots || snapshots.length < 2) return (
    <div style={{ textAlign:'center', padding:'30px 0', color:C.dim, ...MONO, fontSize:11 }}>
      Add records to your collection to see value over time
    </div>
  );
  const vals = snapshots.map(s => Number(s.total_value) || 0);
  const max  = Math.max(...vals, 1);
  const W = 300, H = 90, PL = 40, PR = 8, PT = 8, PB = 20;
  const pts = snapshots.map((s, i) => {
    const x = PL + (i / (snapshots.length - 1)) * (W - PL - PR);
    const y = PT + ((max - (Number(s.total_value) || 0)) / max) * (H - PT - PB);
    return `${x},${y}`;
  }).join(' ');
  const first = vals[0], last = vals[vals.length - 1];
  const gain  = last - first;
  const gainColor = gain >= 0 ? '#4ade80' : '#f87171';
  return (
    <div>
      <div style={{ display:'flex', justifyContent:'space-between', marginBottom:8 }}>
        <span style={{ fontSize:10, color:C.dim, ...MONO }}>90 day trend</span>
        <span style={{ fontSize:12, color:gainColor, ...MONO }}>
          {gain >= 0 ? '+' : ''}{gain.toFixed(0)} PLN
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width:'100%', height:'auto' }}>
        <defs>
          <linearGradient id="pg" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={C.accent} stopOpacity="0.3"/>
            <stop offset="100%" stopColor={C.accent} stopOpacity="0"/>
          </linearGradient>
        </defs>
        {[0, 0.5, 1].map(pct => {
          const y = PT + pct * (H - PT - PB);
          const val = max - pct * max;
          return (
            <g key={pct}>
              <line x1={PL} x2={W - PR} y1={y} y2={y} stroke={C.border} strokeWidth="1"/>
              <text x={PL - 3} y={y + 3} textAnchor="end" fontSize="7" fill={C.dim}>
                {val.toFixed(0)}
              </text>
            </g>
          );
        })}
        <polygon points={`${PL},${H - PB} ${pts} ${W - PR},${H - PB}`} fill="url(#pg)"/>
        <polyline points={pts} fill="none" stroke={C.accent} strokeWidth="1.5"/>
        {snapshots.map((_, i) => {
          const [x, y] = pts.split(' ')[i].split(',').map(Number);
          return <circle key={i} cx={x} cy={y} r="2.5" fill={C.accent}/>;
        })}
      </svg>
    </div>
  );
}

export default function StatsTab({ collection, watchlist, concerts = [] }) {
  const [portfolio, setPortfolio] = useState(null);

  useEffect(() => {
    fetch('/api/portfolio').then(r => r.json()).then(setPortfolio).catch(() => {});
  }, [collection.length]);

  // ── Compute stats ────────────────────────────────────────────
  const totalPurchased = collection.reduce((s, i) => s + (Number(i.purchase_price) || 0), 0);
  const totalCurrent   = collection.reduce((s, i) => s + (Number(i.current_price || i.purchase_price) || 0), 0);
  const gain           = totalCurrent - totalPurchased;
  const avgPrice       = collection.length > 0 ? totalPurchased / collection.length : 0;

  // Genre breakdown (from collection)
  const genreMap = {};
  collection.forEach(c => {
    const g = c.genre || 'Unknown';
    genreMap[g] = (genreMap[g] || 0) + 1;
  });
  const genreData = Object.entries(genreMap)
    .sort((a, b) => b[1] - a[1]).slice(0, 6)
    .map(([label, value]) => ({ label, value }));

  // Format breakdown
  const formatMap = {};
  collection.forEach(c => {
    const f = c.format?.split('·')[0].trim() || 'Vinyl';
    formatMap[f] = (formatMap[f] || 0) + 1;
  });
  const formatData = Object.entries(formatMap)
    .sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map(([label, value]) => ({ label, value }));

  // Most expensive
  const mostExpensive = [...collection]
    .sort((a, b) => (Number(b.purchase_price) || 0) - (Number(a.purchase_price) || 0))
    .slice(0, 3);

  // Concert stats
  const concertCount   = concerts.length;
  const bandMap        = {};
  concerts.forEach(c => { bandMap[c.band] = (bandMap[c.band] || 0) + 1; });
  const topBand        = Object.entries(bandMap).sort((a, b) => b[1] - a[1])[0];
  const totalSpent     = concerts.reduce((s, c) => s + (Number(c.price) || 0), 0);
  const concertGenres  = {};
  concerts.forEach(c => { concertGenres[c.genre] = (concertGenres[c.genre] || 0) + 1; });
  const topConcertGenre = Object.entries(concertGenres).sort((a, b) => b[1] - a[1])[0];

  const GENRE_COLORS = ['#dc2626','#f5c842','#4ade80','#60a5fa','#a78bfa','#f97316'];

  return (
    <div style={{ padding:'0 16px 16px' }}>
      {/* Header */}
      <div style={{ padding:'16px 0 12px' }}>
        <div style={{ ...BEBAS, fontSize:28, color:C.text, letterSpacing:'0.06em', lineHeight:1 }}>STATISTICS</div>
        <div style={{ fontSize:10, color:C.accent, ...MONO, letterSpacing:'0.2em', marginTop:2 }}>YOUR METAL VAULT OVERVIEW</div>
      </div>

      {/* Key stats grid */}
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, marginBottom:16 }}>
        <StatCard icon="📦" value={collection.length} label="Records owned" color={C.accent}/>
        <StatCard icon="★" value={watchlist.length} label="On watchlist" color="#f5c842"/>
        <StatCard icon="💰" value={totalPurchased > 0 ? `${totalPurchased.toFixed(0)} zł` : '—'} label="Total paid" color="#4ade80"/>
        <StatCard
          icon={gain >= 0 ? '📈' : '📉'}
          value={gain !== 0 ? `${gain > 0 ? '+' : ''}${gain.toFixed(0)} zł` : '—'}
          label="Est. gain/loss"
          color={gain >= 0 ? '#4ade80' : '#f87171'}
        />
        {concertCount > 0 && <>
          <StatCard icon="🎸" value={concertCount} label="Concerts seen" color="#a78bfa"/>
          <StatCard icon="🎟" value={totalSpent > 0 ? `${totalSpent.toFixed(0)} zł` : '—'} label="Tickets spent" color="#f97316"/>
        </>}
      </div>

      {/* Portfolio chart */}
      {portfolio?.snapshots?.length >= 2 && (
        <div style={{ background:C.bg2, border:`1px solid ${C.border}`, borderRadius:12,
          padding:'16px', marginBottom:16 }}>
          <div style={{ fontSize:10, color:C.accent, ...MONO, letterSpacing:'0.15em',
            textTransform:'uppercase', marginBottom:12 }}>Collection value over time</div>
          <PortfolioChart snapshots={portfolio.snapshots}/>
        </div>
      )}

      {/* Average price */}
      {avgPrice > 0 && (
        <div style={{ background:C.bg2, border:`1px solid ${C.border}`, borderRadius:12,
          padding:'14px', marginBottom:16, display:'flex', justifyContent:'space-between' }}>
          <span style={{ fontSize:12, color:C.muted, ...MONO }}>Avg. purchase price</span>
          <span style={{ fontSize:14, color:C.text, ...MONO }}>{avgPrice.toFixed(0)} zł</span>
        </div>
      )}

      {/* Genre breakdown */}
      {genreData.length > 0 && (
        <div style={{ background:C.bg2, border:`1px solid ${C.border}`, borderRadius:12,
          padding:'16px', marginBottom:16 }}>
          <div style={{ fontSize:10, color:C.accent, ...MONO, letterSpacing:'0.15em',
            textTransform:'uppercase', marginBottom:12 }}>Collection by genre</div>
          <BarChart data={genreData} colorFn={i => GENRE_COLORS[i % GENRE_COLORS.length]}/>
        </div>
      )}

      {/* Format breakdown */}
      {formatData.length > 0 && (
        <div style={{ background:C.bg2, border:`1px solid ${C.border}`, borderRadius:12,
          padding:'16px', marginBottom:16 }}>
          <div style={{ fontSize:10, color:C.accent, ...MONO, letterSpacing:'0.15em',
            textTransform:'uppercase', marginBottom:12 }}>Vinyl formats</div>
          <BarChart data={formatData} colorFn={() => '#60a5fa'}/>
        </div>
      )}

      {/* Most expensive */}
      {mostExpensive.length > 0 && mostExpensive[0].purchase_price && (
        <div style={{ background:C.bg2, border:`1px solid ${C.border}`, borderRadius:12,
          padding:'16px', marginBottom:16 }}>
          <div style={{ fontSize:10, color:C.accent, ...MONO, letterSpacing:'0.15em',
            textTransform:'uppercase', marginBottom:12 }}>Most expensive</div>
          {mostExpensive.map((item, i) => (
            <div key={item.id} style={{ display:'flex', justifyContent:'space-between',
              alignItems:'center', padding:'7px 0',
              borderBottom: i < mostExpensive.length - 1 ? `1px solid ${C.border}` : 'none' }}>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontSize:12, color:C.text, ...MONO,
                  overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{item.artist}</div>
                <div style={{ fontSize:10, color:C.dim, ...MONO,
                  overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{item.album}</div>
              </div>
              <div style={{ ...BEBAS, fontSize:20, color:'#f5c842', marginLeft:12 }}>
                {Number(item.purchase_price).toFixed(0)} zł
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Concert stats */}
      {concertCount > 0 && (
        <div style={{ background:C.bg2, border:`1px solid ${C.border}`, borderRadius:12,
          padding:'16px', marginBottom:16 }}>
          <div style={{ fontSize:10, color:'#a78bfa', ...MONO, letterSpacing:'0.15em',
            textTransform:'uppercase', marginBottom:12 }}>Concert stats</div>
          <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
            {topBand && (
              <div style={{ display:'flex', justifyContent:'space-between' }}>
                <span style={{ fontSize:12, color:C.muted, ...MONO }}>Most seen</span>
                <span style={{ fontSize:12, color:C.text, ...MONO }}>{topBand[0]} ({topBand[1]}×)</span>
              </div>
            )}
            {topConcertGenre && (
              <div style={{ display:'flex', justifyContent:'space-between' }}>
                <span style={{ fontSize:12, color:C.muted, ...MONO }}>Top genre</span>
                <span style={{ fontSize:12, color:C.text, ...MONO }}>{topConcertGenre[0]}</span>
              </div>
            )}
            <div style={{ display:'flex', justifyContent:'space-between' }}>
              <span style={{ fontSize:12, color:C.muted, ...MONO }}>Unique bands</span>
              <span style={{ fontSize:12, color:C.text, ...MONO }}>{Object.keys(bandMap).length}</span>
            </div>
          </div>
        </div>
      )}

      {/* Empty state */}
      {collection.length === 0 && watchlist.length === 0 && concertCount === 0 && (
        <div style={{ textAlign:'center', padding:'40px 0', color:C.dim, ...MONO }}>
          <div style={{ fontSize:40, marginBottom:12 }}>📊</div>
          <div style={{ fontSize:13, lineHeight:1.7 }}>
            Add records to your collection<br/>to see statistics here
          </div>
        </div>
      )}
    </div>
  );
}
