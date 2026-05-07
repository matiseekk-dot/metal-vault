'use client';
import Link from 'next/link';
import { PRO_MONTHLY_USD, PRO_YEARLY_USD, FREE_TRIAL_DAYS, YEARLY_SAVINGS_PCT } from '@/lib/pricing';
import { useT } from '@/lib/i18n';

const C = { bg:'#0a0a0a',bg2:'#141414',border:'#1e1e1e',accent:'#dc2626',gold:'#f5c842',text:'#f0f0f0',muted:'#888' };

export default function LandingPage() {
  const t = useT();

  // Feature grid — translated via i18n keys; icons stay non-translatable.
  // First render at SSR uses default-locale English; useT triggers a
  // client re-render once localStorage locale loads (non-EN users see
  // a brief EN→PL/DE flash, acceptable for a marketing page).
  const FEATURES = [
    { icon:'🔄', titleKey: 'landing.feature.discogs.title',  descKey: 'landing.feature.discogs.desc'  },
    { icon:'📸', titleKey: 'landing.feature.scan.title',     descKey: 'landing.feature.scan.desc'     },
    { icon:'💰', titleKey: 'landing.feature.prices.title',   descKey: 'landing.feature.prices.desc'   },
    { icon:'🔔', titleKey: 'landing.feature.alerts.title',   descKey: 'landing.feature.alerts.desc'   },
    { icon:'📅', titleKey: 'landing.feature.calendar.title', descKey: 'landing.feature.calendar.desc' },
    { icon:'📴', titleKey: 'landing.feature.offline.title',  descKey: 'landing.feature.offline.desc'  },
  ];

  return (
    <div style={{minHeight:'100vh',background:C.bg,color:C.text,fontFamily:"var(--font-space-mono), monospace",maxWidth:640,margin:'0 auto'}}>
      {/* Nav */}
      <nav style={{padding:'16px 24px',display:'flex',justifyContent:'space-between',alignItems:'center',borderBottom:'1px solid '+C.border}}>
        <div style={{fontFamily:"var(--font-bebas-neue), sans-serif",fontSize:22,letterSpacing:'0.08em'}}>METAL VAULT</div>
        <Link href="/" style={{background:C.accent,color:'#fff',padding:'8px 20px',borderRadius:8,textDecoration:'none',fontFamily:"var(--font-bebas-neue), sans-serif",fontSize:16,letterSpacing:'0.08em'}}>
          {t('landing.openApp')} →
        </Link>
      </nav>

      {/* Hero */}
      <div style={{padding:'56px 24px 36px',textAlign:'center',position:'relative',overflow:'hidden'}}>
        <div style={{position:'absolute',top:-60,left:'50%',transform:'translateX(-50%)',width:360,height:360,borderRadius:'50%',background:'radial-gradient(circle,#dc262622 0%,transparent 70%)',pointerEvents:'none'}}/>
        <div style={{fontSize:10,color:C.accent,letterSpacing:'0.3em',textTransform:'uppercase',marginBottom:14}}>{t('landing.heroEyebrow')}</div>
        <h1 style={{fontFamily:"var(--font-bebas-neue), sans-serif",fontSize:48,lineHeight:1.05,letterSpacing:'0.04em',margin:'0 0 20px'}}>
          {t('landing.heroLine1')}<br/><span style={{color:C.accent}}>{t('landing.heroLine2')}</span><br/>{t('landing.heroLine3')}
        </h1>
        <p style={{fontSize:13,color:C.muted,lineHeight:1.8,maxWidth:400,margin:'0 auto 28px'}}>
          {t('landing.heroDesc')}
        </p>
        <div style={{display:'flex',gap:10,justifyContent:'center',flexWrap:'wrap'}}>
          <Link href="/" style={{display:'inline-block',background:'linear-gradient(135deg,#dc2626,#991b1b)',color:'#fff',padding:'14px 36px',borderRadius:12,textDecoration:'none',fontFamily:"var(--font-bebas-neue), sans-serif",fontSize:22,letterSpacing:'0.1em',boxShadow:'0 4px 24px #dc262644'}}>
            🤘 {t('landing.heroCta')}
          </Link>
          {/* Demo mode CTA — sets the LS flag and lands on the app
              shell. useCollection picks it up, seeds the demo
              dataset, DemoBanner renders sticky-top. The reviewer /
              first-time visitor never has to type a credential
              before seeing the value of the app. */}
          <button
            onClick={() => {
              try {
                localStorage.setItem('mv_demo_active', '1');
                window.dispatchEvent(new CustomEvent('mv:demo-changed'));
              } catch {}
              window.location.href = '/';
            }}
            style={{display:'inline-block',background:'transparent',border:'1px solid '+C.accent,color:C.accent,padding:'14px 28px',borderRadius:12,fontFamily:"var(--font-bebas-neue), sans-serif",fontSize:22,letterSpacing:'0.1em',cursor:'pointer'}}>
            👀 {t('landing.tryAsGuest') || 'Try without account'}
          </button>
        </div>
      </div>

      {/* Stats */}
      <div style={{display:'flex',borderTop:'1px solid '+C.border,borderBottom:'1px solid '+C.border}}>
        {[
          { v:'∞',                 l: t('landing.stats.records') },
          { v:'0s',                l: t('landing.stats.setup') },
          { v: FREE_TRIAL_DAYS+'d', l: t('landing.stats.proTrial') },
        ].map((s,i)=>(
          <div key={i} style={{flex:1,padding:'18px 8px',textAlign:'center',borderRight:i<2?'1px solid '+C.border:'none'}}>
            <div style={{fontFamily:"var(--font-bebas-neue), sans-serif",fontSize:30,color:C.accent,lineHeight:1}}>{s.v}</div>
            <div style={{fontSize:9,color:C.muted,letterSpacing:'0.12em',textTransform:'uppercase',marginTop:3}}>{s.l}</div>
          </div>
        ))}
      </div>

      {/* Offline callout */}
      <div style={{margin:'32px 24px',background:'linear-gradient(135deg,#1a0800,#2a0a00)',border:'1px solid '+C.accent,borderRadius:14,padding:'22px 18px'}}>
        <div style={{fontSize:10,color:C.accent,letterSpacing:'0.25em',textTransform:'uppercase',marginBottom:10}}>{t('landing.killer.label')}</div>
        <div style={{fontFamily:"var(--font-bebas-neue), sans-serif",fontSize:26,lineHeight:1.1,marginBottom:10}}>
          {t('landing.killer.title')}
        </div>
        <div style={{fontSize:12,color:C.muted,lineHeight:1.7}}>
          {t('landing.killer.desc')}
        </div>
      </div>

      {/* Features grid */}
      <div style={{padding:'0 24px 32px'}}>
        <div style={{fontSize:10,color:C.accent,letterSpacing:'0.25em',textTransform:'uppercase',textAlign:'center',marginBottom:20}}>{t('landing.features.title')}</div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
          {FEATURES.map((f,i)=>(
            <div key={i} style={{background:C.bg2,border:'1px solid '+C.border,borderRadius:10,padding:'14px 12px'}}>
              <div style={{fontSize:24,marginBottom:8,lineHeight:1}}>{f.icon}</div>
              <div style={{fontFamily:"var(--font-bebas-neue), sans-serif",fontSize:16,letterSpacing:'0.04em',marginBottom:4,lineHeight:1}}>{t(f.titleKey)}</div>
              <div style={{fontSize:10,color:C.muted,lineHeight:1.6}}>{t(f.descKey)}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Pricing */}
      <div style={{padding:'0 24px 40px'}}>
        <div style={{fontSize:10,color:C.accent,letterSpacing:'0.25em',textTransform:'uppercase',textAlign:'center',marginBottom:20}}>{t('landing.pricing.label')}</div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
          <div style={{background:C.bg2,border:'1px solid '+C.border,borderRadius:12,padding:'18px 14px'}}>
            <div style={{fontFamily:"var(--font-bebas-neue), sans-serif",fontSize:20,marginBottom:4}}>{t('landing.pricing.freeTitle')}</div>
            <div style={{fontFamily:"var(--font-bebas-neue), sans-serif",fontSize:32,color:C.gold,marginBottom:14,lineHeight:1}}>{t('landing.pricing.freePrice')}</div>
            {[
              t('landing.pricing.free.records'),
              t('landing.pricing.free.discogsSync'),
              t('landing.pricing.free.priceTracking'),
              t('landing.pricing.free.alerts3'),
              t('landing.pricing.free.scanner'),
              t('landing.pricing.free.offline'),
            ].map(f=>(
              <div key={f} style={{fontSize:10,color:C.muted,marginBottom:5,display:'flex',gap:5}}>
                <span style={{color:'#4ade80'}}>✓</span>{f}
              </div>
            ))}
          </div>
          <div style={{background:'linear-gradient(135deg,#1a0800,#2a1000)',border:'2px solid '+C.gold,borderRadius:12,padding:'18px 14px',position:'relative'}}>
            <div style={{position:'absolute',top:-10,right:10,background:C.gold,color:'#000',fontSize:8,padding:'2px 7px',borderRadius:10,fontWeight:'bold',letterSpacing:'0.1em'}}>{t('landing.pricing.trialBadge', { n: FREE_TRIAL_DAYS })}</div>
            <div style={{fontFamily:"var(--font-bebas-neue), sans-serif",fontSize:20,marginBottom:4}}>{t('landing.pricing.proTitle')}</div>
            <div style={{fontFamily:"var(--font-bebas-neue), sans-serif",fontSize:32,color:C.gold,marginBottom:14,lineHeight:1}}>${PRO_MONTHLY_USD} <span style={{fontSize:12,color:C.muted}}>{t('landing.pricing.proSuffix')}</span></div>
            <div style={{fontSize:10,color:C.muted,marginBottom:10}}>{t('landing.pricing.yearlyPrice', { price: '$'+PRO_YEARLY_USD, save: YEARLY_SAVINGS_PCT })}</div>
            {[
              t('landing.pricing.pro.allFree'),
              t('landing.pricing.pro.unlimitedAlerts'),
              t('landing.pricing.pro.priceHistory'),
              t('landing.pricing.pro.refresh'),
              t('landing.pricing.pro.export'),
              t('landing.pricing.pro.analytics'),
            ].map(f=>(
              <div key={f} style={{fontSize:10,color:C.muted,marginBottom:5,display:'flex',gap:5}}>
                <span style={{color:C.gold}}>⭐</span>{f}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* CTA */}
      <div style={{padding:'0 24px 56px',textAlign:'center'}}>
        <div style={{fontFamily:"var(--font-bebas-neue), sans-serif",fontSize:32,lineHeight:1.1,marginBottom:16}}>
          {t('landing.outro.title')}
        </div>
        <Link href="/" style={{display:'inline-block',background:'linear-gradient(135deg,#dc2626,#991b1b)',color:'#fff',padding:'15px 40px',borderRadius:14,textDecoration:'none',fontFamily:"var(--font-bebas-neue), sans-serif",fontSize:22,letterSpacing:'0.1em',boxShadow:'0 4px 32px #dc262655'}}>
          🤘 {t('landing.outro.cta')}
        </Link>
        <div style={{fontSize:10,color:'#444',marginTop:10}}>{t('landing.outro.subline')}</div>
      </div>

      {/* Footer */}
      <div style={{padding:'18px 24px',borderTop:'1px solid '+C.border,display:'flex',justifyContent:'space-between',fontSize:10,color:'#333'}}>
        <span>© 2026 Metal Vault</span>
        <div style={{display:'flex',gap:14}}>
          <a href="mailto:hello@metal-vault.app" style={{color:'#444',textDecoration:'none'}}>{t('landing.contact')}</a>
        </div>
      </div>
    </div>
  );
}
