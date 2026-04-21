'use client';
import { useState } from 'react';
import { C, MONO, BEBAS } from '@/lib/theme';

const steps = [
  {
    icon: '🔥',
    title: 'METAL VAULT',
    sub: 'YOUR VINYL UNIVERSE',
    desc: 'Track your collection, discover upcoming pre-orders, monitor market prices, and generate insurance reports — all for your metal records.',
    bullets: ['Unlimited records', 'Price alerts', 'Pre-order feed', 'Insurance PDFs (Pro)'],
    cta: null,
  },
  {
    icon: '🔗',
    title: 'CONNECT DISCOGS',
    sub: 'STEP 1 OF 4  ·  RECOMMENDED',
    desc: 'Link your Discogs to automatically import your collection and fetch live market prices. You can skip this and add records manually.',
    cta: 'connect',
    skippable: true,
  },
  {
    icon: '🔄',
    title: 'SYNC YOUR VAULT',
    sub: 'STEP 2 OF 4',
    desc: 'We pull your vinyl — artist, album, format, price paid — into your private vault and keep it in sync.',
    bullets: ['Automatic import', 'Live market prices', 'Wantlist → watchlist'],
    cta: null,
  },
  {
    icon: '🔔',
    title: 'ENABLE NOTIFICATIONS',
    sub: 'STEP 3 OF 4  ·  OPTIONAL',
    desc: 'Get a push notification when your followed artists announce a new album or a watched record drops below your target price.',
    bullets: ['Pre-order alerts', 'Price drop alerts', 'Weekly release digest'],
    cta: 'done',
    skippable: true,
  },
  {
    icon: '🎯',
    title: 'YOU ARE READY',
    sub: 'STEP 4 OF 4',
    desc: 'Start adding records, following artists, and tracking prices. Upgrade to Pro anytime for detailed grading, insurance reports and price history.',
    cta: 'done',
  },
];

export default function OnboardingScreen({ onDone, onConnectDiscogs, isConnected }) {
  const [step, setStep] = useState(0);
  const current = steps[step];
  const isLast  = step === steps.length - 1;

  const next = () => {
    if (isLast) { onDone(); return; }
    setStep(s => s + 1);
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 300,
      background: '#0a0a0a',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      padding: '0 32px',
    }}>
      {/* Background accent */}
      <div style={{
        position: 'absolute', top: -100, right: -100,
        width: 400, height: 400, borderRadius: '50%',
        background: 'radial-gradient(circle, #dc262618 0%, transparent 70%)',
        pointerEvents: 'none',
      }}/>

      {/* Progress dots */}
      <div style={{ position: 'absolute', top: 48, display: 'flex', gap: 8 }}>
        {steps.map((_, i) => (
          <div key={i} style={{
            width: i === step ? 24 : 8, height: 8,
            borderRadius: 4, transition: 'all 0.3s',
            background: i === step ? C.accent : i < step ? '#991b1b' : '#2a2a2a',
          }}/>
        ))}
      </div>

      {/* Icon */}
      <div style={{
        fontSize: 72, marginBottom: 32, lineHeight: 1,
        filter: step === 0 ? 'drop-shadow(0 0 40px #dc262688)' : 'none',
        transition: 'all 0.3s',
      }}>
        {current.icon}
      </div>

      {/* Sub label */}
      <div style={{
        fontSize: 10, color: C.accent, ...MONO,
        letterSpacing: '0.3em', textTransform: 'uppercase',
        marginBottom: 10,
      }}>
        {current.sub}
      </div>

      {/* Title */}
      <div style={{
        ...BEBAS, fontSize: 42, color: C.text,
        letterSpacing: '0.06em', textAlign: 'center',
        lineHeight: 1, marginBottom: 20,
      }}>
        {current.title}
      </div>

      {/* Description */}
      <div style={{
        fontSize: 15, color: C.muted, ...MONO,
        textAlign: 'center', lineHeight: 1.8,
        maxWidth: 320, marginBottom: current.bullets ? 24 : 48,
      }}>
        {current.desc}
      </div>

      {/* Feature bullets */}
      {current.bullets && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, maxWidth: 320, width: '100%', marginBottom: 40 }}>
          {current.bullets.map((b, i) => (
            <div key={i} style={{
              fontSize: 11, color: C.text, ...MONO,
              display: 'flex', gap: 6, alignItems: 'center',
              padding: '6px 10px', background: '#1a0a0a',
              border: '1px solid #3a1010', borderRadius: 6,
            }}>
              <span style={{ color: '#dc2626' }}>✓</span>
              <span style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{b}</span>
            </div>
          ))}
        </div>
      )}

      {/* Connected badge (step 1) */}
      {step === 1 && isConnected && (
        <div style={{
          background: '#0d1f0d', border: '1px solid #1a3d1a',
          borderRadius: 10, padding: '10px 20px',
          fontSize: 12, color: '#4ade80', ...MONO,
          marginBottom: 16,
        }}>
          ✓ Discogs connected! Click Continue.
        </div>
      )}

      {/* CTA buttons */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, width: '100%', maxWidth: 320 }}>
        {step === 1 && !isConnected && (
          <button onClick={onConnectDiscogs} style={{
            width: '100%', padding: '16px',
            background: 'linear-gradient(135deg, #1a1a00, #2a2800)',
            border: '2px solid #f5c842', borderRadius: 12,
            color: '#f5c842', cursor: 'pointer',
            ...BEBAS, fontSize: 18, letterSpacing: '0.1em',
          }}>
            🔗 CONNECT DISCOGS
          </button>
        )}

        <button onClick={next} style={{
          width: '100%', padding: '16px',
          background: isLast
            ? 'linear-gradient(135deg, #dc2626, #991b1b)'
            : (step === 1 && !isConnected)
              ? 'none'
              : 'linear-gradient(135deg, #dc2626, #991b1b)',
          border: (step === 1 && !isConnected) ? '1px solid #2a2a2a' : 'none',
          borderRadius: 12,
          color: (step === 1 && !isConnected) ? C.dim : '#fff',
          cursor: 'pointer',
          ...BEBAS, fontSize: 20, letterSpacing: '0.1em',
        }}>
          {isLast ? '🤘 ENTER THE VAULT' : (step === 1 && !isConnected) ? 'Skip for now →' : 'CONTINUE →'}
        </button>
      </div>

      {/* Skip button for skippable steps OR skip-all from first */}
      {(step === 0 || current.skippable) && (
        <button onClick={onDone} style={{
          position: 'absolute', bottom: 40,
          background: 'none', border: 'none',
          color: C.dim, ...MONO, fontSize: 11,
          cursor: 'pointer', letterSpacing: '0.1em',
        }}>
          Skip intro
        </button>
      )}
    </div>
  );
}
