'use client';
// ── Global ArtistInfoModal ────────────────────────────────────
// Listens to `mv:open-artist` events from anywhere in the app
// (SearchTab, BandsTab/ArtistAbout, related-artist clicks inside this
// modal itself) and opens a sheet with bio + members + similar.
//
// Mounted once at the top of the SPA tree (app/page.js). Components
// dispatch a CustomEvent and don't need to thread modal state
// through props.
//
// Data source: /api/artists/related (MusicBrainz + Last.fm + Spotify).

import { useState, useEffect } from 'react';
import { C, MONO, BEBAS } from '@/lib/theme';
import { useT, useLocale } from '@/lib/i18n';
import { useBackButton } from '@/lib/hooks/useBackButton';

// ── ArtistPhoto — exported so SearchTab/BandsTab can reuse it ─
export function ArtistPhoto({ src, name, size = 44, accent = '#dc2626' }) {
  const [err, setErr] = useState(false);
  if (!src || err) {
    return (
      <div style={{ width:size, height:size, borderRadius:'50%', flexShrink:0,
        background:'linear-gradient(135deg,#1a0a0a,#0a0a0a)',
        border:`1px solid ${accent}33`,
        display:'flex', alignItems:'center', justifyContent:'center' }}>
        <span style={{ ...BEBAS, fontSize:Math.round(size*0.45), color:accent }}>
          {(name||'?')[0].toUpperCase()}
        </span>
      </div>
    );
  }
  return (
    <div style={{ width:size, height:size, borderRadius:'50%', flexShrink:0,
      overflow:'hidden', border:`1px solid ${accent}33` }}>
      <img src={src} alt={name} loading="lazy" onError={() => setErr(true)}
        style={{ width:'100%', height:'100%', objectFit:'cover' }}/>
    </div>
  );
}

// ── Section list inside the modal ─────────────────────────────
function ArtistSection({ title, items, onPick }) {
  const [photoMap, setPhotoMap] = useState({});
  useEffect(() => {
    const names = items.slice(0, 12).map(i => i.name).filter(Boolean);
    if (names.length === 0) return;
    let cancelled = false;
    fetch('/api/artists/image', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ names }),
    })
      .then(r => r.json())
      .then(d => { if (!cancelled && d?.images) setPhotoMap(d.images); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [items]);

  return (
    <div style={{ padding:'10px 16px 4px' }}>
      <div style={{ fontSize:9, color:C.accent, ...MONO, letterSpacing:'0.18em',
        textTransform:'uppercase', marginBottom:6 }}>
        {title}
      </div>
      <div style={{ display:'flex', flexDirection:'column', gap:5 }}>
        {items.slice(0, 12).map(item => (
          <div key={item.mbid || item.name}
            onClick={() => onPick(item)}
            style={{ display:'flex', alignItems:'center', gap:9, padding:'7px 9px',
              background:C.bg2, border:`1px solid ${C.border}`, borderRadius:7,
              cursor:'pointer' }}>
            <ArtistPhoto src={photoMap[item.name]} name={item.name} size={32} accent={C.muted}/>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontSize:12, color:C.text, ...MONO, fontWeight:600,
                overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                {item.name}
              </div>
              <div style={{ fontSize:9, color:C.dim, ...MONO, marginTop:1,
                display:'flex', gap:6, flexWrap:'wrap' }}>
                {item.roles?.length > 0 && (
                  <span style={{ color: item.active ? C.green : C.muted }}>
                    {item.roles.join(', ')}
                  </span>
                )}
                {item.begin && (
                  <span>{item.roles?.length > 0 ? '· ' : ''}{item.begin.split('-')[0]}{item.end ? '–' + item.end.split('-')[0] : ''}</span>
                )}
                {item.similarMatch != null && item.similarMatch > 0 && (
                  <span style={{ color:C.accent }}>match {Math.round(item.similarMatch * 100)}%</span>
                )}
              </div>
            </div>
            <span style={{ fontSize:14, color:C.accent }}>›</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Modal sheet ───────────────────────────────────────────────
function Sheet({ artist, onClose }) {
  const t = useT();
  const locale = useLocale();
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [showFullBio, setShowFullBio] = useState(false);
  useBackButton(true, onClose);

  useEffect(() => {
    if (!artist) return;
    setLoading(true); setData(null); setShowFullBio(false);
    const params = new URLSearchParams({
      name: artist.name,
      lang: locale,
      ...(artist.mbid ? { mbid: artist.mbid } : {}),
    });
    // v=2 busts the stale "image: null" responses cached at the edge
    // before Spotify env vars were configured.
    fetch(`/api/artists/related?${params}&v=2`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [artist, locale]);

  if (!artist) return null;

  const openOther = (other) => {
    // Replace current modal with a new artist — push, not stack.
    window.dispatchEvent(new CustomEvent('mv:open-artist', {
      detail: { name: other.name, mbid: other.mbid },
    }));
  };

  return (
    <div onClick={onClose}
      style={{ position:'fixed', inset:0, zIndex:300, background:'rgba(0,0,0,0.85)',
        display:'flex', alignItems:'flex-end', justifyContent:'center' }}>
      <div onClick={e => e.stopPropagation()}
        style={{ background:C.bg, width:'100%', maxWidth:480, maxHeight:'92vh',
          borderRadius:'16px 16px 0 0', overflowY:'auto', overflowX:'hidden',
          border:`1px solid ${C.border}`, paddingBottom:24 }}>

        <div style={{ position:'sticky', top:0, zIndex:1,
          background: data?.image
            ? `linear-gradient(180deg, rgba(10,10,10,0.55) 0%, ${C.bg} 100%), url("${data.image}") center/cover`
            : C.bg,
          borderBottom:`1px solid ${C.border}`, padding:'14px 16px',
          display:'flex', justifyContent:'space-between', alignItems:'center', gap:12 }}>
          <ArtistPhoto src={data?.image || data?.thumb} name={data?.artist || artist.name}
            size={56} accent={C.accent}/>
          <div style={{ minWidth:0, flex:1 }}>
            <div style={{ ...BEBAS, fontSize:22, color:C.text, letterSpacing:'0.04em',
              overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap',
              textShadow: data?.image ? '0 1px 2px rgba(0,0,0,0.7)' : 'none' }}>
              {data?.artist || artist.name}
            </div>
            <div style={{ display:'flex', gap:6, marginTop:2, flexWrap:'wrap' }}>
              {data?.type && <span style={{ fontSize:10, color:C.dim, ...MONO }}>{data.type}</span>}
              {data?.country && <span style={{ fontSize:10, color:C.dim, ...MONO }}>· {data.country}</span>}
              {data?.lifeSpan?.begin && (
                <span style={{ fontSize:10, color:C.dim, ...MONO }}>
                  · {data.lifeSpan.begin.split('-')[0]}{data.lifeSpan.ended && data.lifeSpan.end ? '–' + data.lifeSpan.end.split('-')[0] : '–'}
                </span>
              )}
              {data?.popularity != null && (
                <span style={{ fontSize:10, color:C.dim, ...MONO }}>· {data.popularity}/100</span>
              )}
            </div>
          </div>
          <button onClick={onClose}
            style={{ width:32, height:32, borderRadius:'50%', border:`1px solid ${C.border}`,
              background:'rgba(0,0,0,0.6)', color:'#fff', cursor:'pointer',
              fontSize:18, lineHeight:1, padding:0, flexShrink:0 }}>
            ×
          </button>
        </div>

        {loading && (
          <div style={{ textAlign:'center', padding:'40px 16px', color:C.dim, ...MONO, fontSize:11 }}>
            ⟳ {t('common.loading')}
          </div>
        )}

        {!loading && data && (
          <>
            {data.tags?.length > 0 && (
              <div style={{ padding:'10px 16px', display:'flex', flexWrap:'wrap', gap:5 }}>
                {data.tags.map(tag => (
                  <span key={tag} style={{ fontSize:10, padding:'2px 8px', borderRadius:11,
                    background:C.bg2, color:C.muted, border:`1px solid ${C.border}`,
                    ...MONO }}>{tag}</span>
                ))}
              </div>
            )}

            {data.bio?.summary && (
              <div style={{ padding:'4px 16px 12px' }}>
                <div style={{ fontSize:9, color:C.accent, ...MONO, letterSpacing:'0.18em',
                  textTransform:'uppercase', marginBottom:6 }}>
                  {t('artist.bio')}
                </div>
                <div style={{ fontSize:12, color:C.text, lineHeight:1.6, ...MONO }}>
                  {showFullBio ? data.bio.full : data.bio.summary}
                </div>
                {data.bio.full && data.bio.full !== data.bio.summary && (
                  <button onClick={() => setShowFullBio(b => !b)}
                    style={{ marginTop:6, background:'none', border:'none', color:C.accent,
                      cursor:'pointer', fontSize:10, ...MONO, padding:0 }}>
                    {showFullBio ? t('artist.bioLess') : t('artist.bioMore')}
                  </button>
                )}
              </div>
            )}

            {data.stats?.listeners > 0 && (
              <div style={{ padding:'0 16px 12px', display:'flex', gap:14 }}>
                <div>
                  <div style={{ fontSize:9, color:C.dim, ...MONO, letterSpacing:'0.1em',
                    textTransform:'uppercase' }}>
                    {t('artist.listeners')}
                  </div>
                  <div style={{ ...BEBAS, fontSize:18, color:C.text }}>
                    {data.stats.listeners.toLocaleString()}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize:9, color:C.dim, ...MONO, letterSpacing:'0.1em',
                    textTransform:'uppercase' }}>
                    {t('artist.scrobbles')}
                  </div>
                  <div style={{ ...BEBAS, fontSize:18, color:C.text }}>
                    {(data.stats.playcount / 1000000).toFixed(1)}M
                  </div>
                </div>
              </div>
            )}

            {data.members?.length > 0 && (
              <ArtistSection title={t('artist.members')} items={data.members} onPick={openOther}/>
            )}
            {data.exMembers?.length > 0 && (
              <ArtistSection title={t('artist.exMembers')} items={data.exMembers} onPick={openOther}/>
            )}
            {data.sideProjects?.length > 0 && (
              <ArtistSection title={t('artist.bandsPlayedIn')} items={data.sideProjects} onPick={openOther}/>
            )}
            {data.similar?.length > 0 && (
              <ArtistSection title={t('artist.similar')} items={data.similar.map(s => ({
                ...s, type: null, mbid: s.mbid, similarMatch: s.match,
              }))} onPick={openOther}/>
            )}

            {data.urls && Object.keys(data.urls).length > 0 && (
              <div style={{ padding:'10px 16px' }}>
                <div style={{ fontSize:9, color:C.accent, ...MONO, letterSpacing:'0.18em',
                  textTransform:'uppercase', marginBottom:6 }}>
                  {t('artist.links')}
                </div>
                <div style={{ display:'flex', flexWrap:'wrap', gap:6 }}>
                  {Object.entries(data.urls).slice(0, 6).map(([type, url]) => (
                    <a key={type} href={url} target="_blank" rel="noopener noreferrer"
                      style={{ fontSize:10, padding:'5px 10px', borderRadius:7,
                        background:C.bg2, border:`1px solid ${C.border}`,
                        color:C.muted, textDecoration:'none', ...MONO,
                        textTransform:'capitalize' }}>
                      {type.replace(/_/g, ' ')} ↗
                    </a>
                  ))}
                </div>
              </div>
            )}

            <div style={{ textAlign:'center', padding:'16px 16px 0',
              fontSize:8, color:C.dim, ...MONO, opacity:0.5 }}>
              {data.lastfmConfigured ? t('artist.poweredBy') : t('artist.poweredByMbOnly')}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Default export — global mount point ───────────────────────
// Listens to mv:open-artist anywhere; renders nothing until an event
// arrives. Closing the modal returns to whatever was below.
export default function ArtistInfoModal() {
  const [target, setTarget] = useState(null);
  useEffect(() => {
    const handler = (e) => {
      const d = e.detail;
      if (!d?.name) return;
      setTarget({ name: d.name, mbid: d.mbid || null });
    };
    window.addEventListener('mv:open-artist', handler);
    return () => window.removeEventListener('mv:open-artist', handler);
  }, []);
  if (!target) return null;
  return <Sheet artist={target} onClose={() => setTarget(null)}/>;
}
