import Link from 'next/link';

export const metadata = {
  title: 'Metal Vault — Your Vinyl Collection, Tracked & Valued',
  description: 'Sync Discogs, track prices, scan barcodes at vinyl fairs. Free forever.',
};

const C = { bg:'#0a0a0a',bg2:'#141414',border:'#1e1e1e',accent:'#dc2626',gold:'#f5c842',text:'#f0f0f0',muted:'#888' };

const FEATURES = [
  { icon:'🔄', title:'Discogs Sync',     desc:'Import your entire collection instantly via OAuth. No CSV, no passwords.' },
  { icon:'📸', title:'Barcode Scanner',  desc:'Scan vinyl at record fairs. See if you own it and what it\'s worth — offline.' },
  { icon:'💰', title:'Price Tracking',   desc:'Daily Discogs market prices. Know your collection\'s real value.' },
  { icon:'🔔', title:'Price Alerts',     desc:'Set a target price. Get push notifications when vinyl hits your budget.' },
  { icon:'📅', title:'Release Calendar', desc:'Upcoming pressings from followed artists. Never miss a pre-order.' },
  { icon:'📴', title:'Works Offline',    desc:'Full collection access without internet. Built for vinyl fairs.' },
];

export default function LandingPage() {
  return (
    <div style={{minHeight:'100vh',background:C.bg,color:C.text,fontFamily:"'Space Mono',monospace",maxWidth:640,margin:'0 auto'}}>
      <link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Space+Mono&display=swap" rel="stylesheet"/>

      {/* Nav */}
      <nav style={{padding:'16px 24px',display:'flex',justifyContent:'space-between',alignItems:'center',borderBottom:'1px solid '+C.border}}>
        <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:22,letterSpacing:'0.08em'}}>METAL VAULT</div>
        <Link href="/" style={{background:C.accent,color:'#fff',padding:'8px 20px',borderRadius:8,textDecoration:'none',fontFamily:"'Bebas Neue',sans-serif",fontSize:16,letterSpacing:'0.08em'}}>
          OPEN APP →
        </Link>
      </nav>

      {/* Hero */}
      <div style={{padding:'56px 24px 36px',textAlign:'center',position:'relative',overflow:'hidden'}}>
        <div style={{position:'absolute',top:-60,left:'50%',transform:'translateX(-50%)',width:360,height:360,borderRadius:'50%',background:'radial-gradient(circle,#dc262622 0%,transparent 70%)',pointerEvents:'none'}}/>
        <div style={{fontSize:10,color:C.accent,letterSpacing:'0.3em',textTransform:'uppercase',marginBottom:14}}>For Metal Vinyl Collectors</div>
        <h1 style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:48,lineHeight:1.05,letterSpacing:'0.04em',margin:'0 0 20px'}}>
          YOUR COLLECTION.<br/><span style={{color:C.accent}}>TRACKED.</span> VALUED.<br/>ALWAYS WITH YOU.
        </h1>
        <p style={{fontSize:13,color:C.muted,lineHeight:1.8,maxWidth:400,margin:'0 auto 28px'}}>
          Sync from Discogs, scan barcodes at vinyl fairs, track market prices and get notified when new metal vinyl drops — offline-ready.
        </p>
        <Link href="/" style={{display:'inline-block',background:'linear-gradient(135deg,#dc2626,#991b1b)',color:'#fff',padding:'14px 36px',borderRadius:12,textDecoration:'none',fontFamily:"'Bebas Neue',sans-serif",fontSize:22,letterSpacing:'0.1em',boxShadow:'0 4px 24px #dc262644'}}>
          🤘 START FREE — NO SIGN-UP
        </Link>
      </div>

      {/* Stats */}
      <div style={{display:'flex',borderTop:'1px solid '+C.border,borderBottom:'1px solid '+C.border}}>
        {[{v:'∞',l:'Records free'},{v:'0s',l:'Discogs setup'},{v:'7d',l:'Pro trial'}].map((s,i)=>(
          <div key={i} style={{flex:1,padding:'18px 8px',textAlign:'center',borderRight:i<2?'1px solid '+C.border:'none'}}>
            <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:30,color:C.accent,lineHeight:1}}>{s.v}</div>
            <div style={{fontSize:9,color:C.muted,letterSpacing:'0.12em',textTransform:'uppercase',marginTop:3}}>{s.l}</div>
          </div>
        ))}
      </div>

      {/* Offline callout */}
      <div style={{margin:'32px 24px',background:'linear-gradient(135deg,#1a0800,#2a0a00)',border:'1px solid '+C.accent,borderRadius:14,padding:'22px 18px'}}>
        <div style={{fontSize:10,color:C.accent,letterSpacing:'0.25em',textTransform:'uppercase',marginBottom:10}}>Killer feature</div>
        <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:26,lineHeight:1.1,marginBottom:10}}>
          SCAN VINYL AT FAIRS — NO INTERNET NEEDED
        </div>
        <div style={{fontSize:12,color:C.muted,lineHeight:1.7}}>
          Open the camera, scan a barcode. Metal Vault instantly shows whether you own it and what Discogs says it's worth — even with zero signal.
        </div>
      </div>

      {/* Features grid */}
      <div style={{padding:'0 24px 32px'}}>
        <div style={{fontSize:10,color:C.accent,letterSpacing:'0.25em',textTransform:'uppercase',textAlign:'center',marginBottom:20}}>Everything you need</div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
          {FEATURES.map((f,i)=>(
            <div key={i} style={{background:C.bg2,border:'1px solid '+C.border,borderRadius:10,padding:'14px 12px'}}>
              <div style={{fontSize:24,marginBottom:8,lineHeight:1}}>{f.icon}</div>
              <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:16,letterSpacing:'0.04em',marginBottom:4,lineHeight:1}}>{f.title}</div>
              <div style={{fontSize:10,color:C.muted,lineHeight:1.6}}>{f.desc}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Pricing */}
      <div style={{padding:'0 24px 40px'}}>
        <div style={{fontSize:10,color:C.accent,letterSpacing:'0.25em',textTransform:'uppercase',textAlign:'center',marginBottom:20}}>Pricing</div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
          <div style={{background:C.bg2,border:'1px solid '+C.border,borderRadius:12,padding:'18px 14px'}}>
            <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:20,marginBottom:4}}>FREE</div>
            <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:32,color:C.gold,marginBottom:14,lineHeight:1}}>0 PLN</div>
            {['Unlimited records','Discogs sync','Price tracking','1 price alert','Barcode scanner','Offline mode'].map(f=>(
              <div key={f} style={{fontSize:10,color:C.muted,marginBottom:5,display:'flex',gap:5}}>
                <span style={{color:'#4ade80'}}>✓</span>{f}
              </div>
            ))}
          </div>
          <div style={{background:'linear-gradient(135deg,#1a0800,#2a1000)',border:'2px solid '+C.gold,borderRadius:12,padding:'18px 14px',position:'relative'}}>
            <div style={{position:'absolute',top:-10,right:10,background:C.gold,color:'#000',fontSize:8,padding:'2px 7px',borderRadius:10,fontWeight:'bold',letterSpacing:'0.1em'}}>7 DAYS FREE</div>
            <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:20,marginBottom:4}}>PRO</div>
            <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:32,color:C.gold,marginBottom:14,lineHeight:1}}>9.99 <span style={{fontSize:12,color:C.muted}}>PLN/mo</span></div>
            {['All Free features','Unlimited alerts','Price history charts','On-demand refresh','CSV / JSON export','Advanced analytics'].map(f=>(
              <div key={f} style={{fontSize:10,color:C.muted,marginBottom:5,display:'flex',gap:5}}>
                <span style={{color:C.gold}}>⭐</span>{f}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* CTA */}
      <div style={{padding:'0 24px 56px',textAlign:'center'}}>
        <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:32,lineHeight:1.1,marginBottom:16}}>
          KNOW WHAT YOUR<br/>COLLECTION IS WORTH.
        </div>
        <Link href="/" style={{display:'inline-block',background:'linear-gradient(135deg,#dc2626,#991b1b)',color:'#fff',padding:'15px 40px',borderRadius:14,textDecoration:'none',fontFamily:"'Bebas Neue',sans-serif",fontSize:22,letterSpacing:'0.1em',boxShadow:'0 4px 32px #dc262655'}}>
          🤘 START FOR FREE
        </Link>
        <div style={{fontSize:10,color:'#444',marginTop:10}}>No account required · Sign in with Google or email</div>
      </div>

      {/* Footer */}
      <div style={{padding:'18px 24px',borderTop:'1px solid '+C.border,display:'flex',justifyContent:'space-between',fontSize:10,color:'#333'}}>
        <span>© 2026 Metal Vault</span>
        <div style={{display:'flex',gap:14}}>
          <a href="mailto:hello@metal-vault.app" style={{color:'#444',textDecoration:'none'}}>Contact</a>
        </div>
      </div>
    </div>
  );
}
