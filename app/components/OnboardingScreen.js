'use client';
// ── OnboardingScreen — 3-step flow ─────────────────────────────────
//
// Earlier this was a 5-step interrogation: hero → discogs → sync
// explainer → push permission → genres. Realistic funnel was 30-40%
// completion at best — every "skippable but please don't" step
// halved the cohort:
//   • OAuth Discogs roundtrip = 30-50% drop on its own (external
//     redirect, browser back handles unevenly, error state silent)
//   • Push permission upfront = 30% deny rate; once denied the only
//     way to re-prompt is to teach the user how to flip browser
//     site settings, so we gave up the alert-funnel feature for
//     those users entirely
//   • Sync explainer step = pure dead weight, no decision happens
//
// New shape, 3 steps:
//   0. Hero — single value prop, single CTA
//   1. Path picker — three concrete first actions (Discogs sync,
//      barcode scan, manual / browse). Picking a card commits the
//      user to that path AND ends onboarding immediately, except
//      the bottom skip-link which advances to step 2.
//   2. Genres — optional, skippable. Personalises the Feed.
//
// What moved out:
//   • Push permission-on-context — fired the first time a user
//     creates a price alert (CollectionTab.createAlert success path).
//     Conversion rate when prompted in-context with concrete value
//     ("notify when X drops to Y zł") is ~3× higher than upfront.
//   • Sync explainer step — its content is now a one-line caption
//     under the Discogs card on the path picker.

import { useState, useEffect } from 'react';
import { C, MONO, BEBAS } from '@/lib/theme';
import { useT } from '@/lib/i18n';
import Icon from '@/app/components/Icon';
import { useBackButton } from '@/lib/hooks/useBackButton';
import { trackOnboardingStep } from '@/lib/analytics';
import { haptic } from '@/lib/haptics';
import { saveLS } from '@/lib/localStorage';

// Genre choices reused from app/page.js — kept in sync deliberately
// rather than imported (page.js can't import from this file without
// a circular dep risk).
const GENRES = [
  'Heavy Metal','Death Metal','Black Metal','Thrash Metal','Doom Metal',
  'Progressive Metal','Power Metal','Metalcore','Groove Metal','Nu-Metal',
  'Symphonic Metal','Sludge Metal','Industrial Metal','Folk Metal','Post-Metal',
];

export default function OnboardingScreen({ onDone, onConnectDiscogs, isConnected }) {
  const t = useT();
  useBackButton(true, onDone);

  // step 0=hero, 1=path picker, 2=genres
  const [step, setStep] = useState(0);
  const [genres, setGenres] = useState([]);

  useEffect(() => { trackOnboardingStep(step, 'view'); }, [step]);

  const finish = (reason) => {
    trackOnboardingStep(step, reason || 'complete');
    if (genres.length > 0) saveLS('mv_genre_interests', genres);
    onDone();
  };

  const advance = () => {
    trackOnboardingStep(step, 'next');
    haptic.tap();
    setStep(s => s + 1);
  };

  const onPickDiscogs = () => {
    trackOnboardingStep(step, 'path_discogs');
    haptic.tap();
    // OAuth redirect leaves the page — no need to onDone() ourselves;
    // the onboarding state is implicitly thrown away. Set the
    // mv_onboarding_done flag first so the user doesn't get re-prompted
    // when they come back signed-in + connected.
    try { localStorage.setItem('mv_onboarding_done', '1'); } catch {}
    onConnectDiscogs();
  };

  const onPickScan = () => {
    trackOnboardingStep(step, 'path_scan');
    haptic.tap();
    // Open scanner from the global event bus; onDone closes onboarding
    // first so the scanner sheet renders on top of the app shell, not
    // the onboarding overlay.
    onDone();
    setTimeout(() => {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('mv:open-scanner'));
      }
    }, 50);
  };

  const onPickBrowse = () => {
    trackOnboardingStep(step, 'path_browse');
    haptic.tap();
    onDone();
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 300,
      background: '#0a0a0a',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      padding: '0 24px',
      overflow: 'auto',
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
        {[0,1,2].map(i => (
          <div key={i} style={{
            width: i === step ? 24 : 8, height: 8,
            borderRadius: 4, transition: 'all 0.3s',
            background: i === step ? C.accent : i < step ? '#991b1b' : '#2a2a2a',
          }}/>
        ))}
      </div>

      {/* ── Step 0: Hero ─────────────────────────────────────── */}
      {step === 0 && (
        <div style={{ width: '100%', maxWidth: 360, textAlign: 'center', marginTop: 80 }}>
          <div style={{
            fontSize: 72, marginBottom: 28, lineHeight: 1,
            filter: 'drop-shadow(0 0 40px #dc262688)',
          }}>
            <Icon name="fire" size={64} color={C.accent}/>
          </div>
          <div style={{
            fontSize: 10, color: C.accent, ...MONO,
            letterSpacing: '0.3em', textTransform: 'uppercase',
            marginBottom: 12,
          }}>
            {t('onboarding.v3.heroEyebrow')}
          </div>
          <div style={{
            ...BEBAS, fontSize: 40, color: C.text,
            letterSpacing: '0.06em', lineHeight: 1.05,
            marginBottom: 18,
          }}>
            {t('onboarding.v3.heroTitle')}
          </div>
          <div style={{
            fontSize: 14, color: C.muted, ...MONO,
            lineHeight: 1.7, marginBottom: 40,
          }}>
            {t('onboarding.v3.heroDesc')}
          </div>
          <button onClick={advance} style={{
            width: '100%', padding: '16px',
            background: 'linear-gradient(135deg, #dc2626, #991b1b)',
            border: 'none', borderRadius: 12,
            color: '#fff', cursor: 'pointer',
            ...BEBAS, fontSize: 22, letterSpacing: '0.1em',
            boxShadow: '0 4px 24px #dc262644',
          }}>
            {t('onboarding.v3.heroCta')} →
          </button>
          <button
            onClick={() => finish('skip')}
            style={{
              marginTop: 16,
              background: 'none', border: 'none',
              color: C.dim, ...MONO, fontSize: 11,
              cursor: 'pointer', letterSpacing: '0.1em',
              padding: 8,
            }}>
            {t('onboarding.v3.skipIntro')}
          </button>
        </div>
      )}

      {/* ── Step 1: Path picker ─────────────────────────────── */}
      {step === 1 && (
        <div style={{ width: '100%', maxWidth: 360, marginTop: 80, marginBottom: 40 }}>
          <div style={{
            fontSize: 10, color: C.accent, ...MONO,
            letterSpacing: '0.3em', textTransform: 'uppercase',
            textAlign: 'center', marginBottom: 12,
          }}>
            {t('onboarding.v3.pathEyebrow')}
          </div>
          <div style={{
            ...BEBAS, fontSize: 28, color: C.text,
            letterSpacing: '0.04em', lineHeight: 1.1,
            textAlign: 'center', marginBottom: 24,
          }}>
            {t('onboarding.v3.pathTitle')}
          </div>

          {/* Card 1: Discogs (gold, recommended for collectors) */}
          <button
            onClick={onPickDiscogs}
            disabled={isConnected}
            style={{
              width: '100%', padding: '14px 16px', marginBottom: 10,
              background: isConnected
                ? '#0d1f0d'
                : 'linear-gradient(135deg, #1a1a00, #2a1f00)',
              border: '1px solid ' + (isConnected ? '#1a3d1a' : '#f5c842'),
              borderRadius: 12,
              color: isConnected ? '#4ade80' : '#f5c842',
              cursor: isConnected ? 'default' : 'pointer',
              textAlign: 'left',
              display: 'flex', gap: 14, alignItems: 'center',
            }}>
            <div style={{ flexShrink: 0 }}>
              <Icon name="external" size={28} color={isConnected ? '#4ade80' : '#f5c842'}/>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ ...BEBAS, fontSize: 16, letterSpacing: '0.06em', marginBottom: 3 }}>
                {isConnected
                  ? '✓ ' + t('onboarding.v3.path.discogsDone')
                  : t('onboarding.v3.path.discogs')}
              </div>
              <div style={{ fontSize: 10, color: C.muted, ...MONO, lineHeight: 1.4 }}>
                {t('onboarding.v3.path.discogsDesc')}
              </div>
            </div>
            <div style={{ fontSize: 16, color: isConnected ? '#4ade80' : '#f5c842', flexShrink: 0 }}>→</div>
          </button>

          {/* Card 2: Barcode scan */}
          <button
            onClick={onPickScan}
            style={{
              width: '100%', padding: '14px 16px', marginBottom: 10,
              background: 'linear-gradient(135deg, #1a0500, #2a0a00)',
              border: '1px solid ' + C.accent,
              borderRadius: 12,
              color: '#fff', cursor: 'pointer',
              textAlign: 'left',
              display: 'flex', gap: 14, alignItems: 'center',
            }}>
            <div style={{ flexShrink: 0 }}>
              <Icon name="scan" size={28} color={C.accent}/>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ ...BEBAS, fontSize: 16, letterSpacing: '0.06em', marginBottom: 3 }}>
                {t('onboarding.v3.path.scan')}
              </div>
              <div style={{ fontSize: 10, color: C.muted, ...MONO, lineHeight: 1.4 }}>
                {t('onboarding.v3.path.scanDesc')}
              </div>
            </div>
            <div style={{ fontSize: 16, color: C.accent, flexShrink: 0 }}>→</div>
          </button>

          {/* Card 3: Browse / set up later */}
          <button
            onClick={onPickBrowse}
            style={{
              width: '100%', padding: '14px 16px',
              background: 'transparent',
              border: '1px solid ' + C.border,
              borderRadius: 12,
              color: C.dim, cursor: 'pointer',
              textAlign: 'left',
              display: 'flex', gap: 14, alignItems: 'center',
            }}>
            <div style={{ flexShrink: 0 }}>
              <Icon name="search" size={28} color={C.dim}/>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ ...BEBAS, fontSize: 16, letterSpacing: '0.06em', marginBottom: 3, color: C.muted }}>
                {t('onboarding.v3.path.browse')}
              </div>
              <div style={{ fontSize: 10, color: C.dim, ...MONO, lineHeight: 1.4 }}>
                {t('onboarding.v3.path.browseDesc')}
              </div>
            </div>
            <div style={{ fontSize: 16, color: C.dim, flexShrink: 0 }}>→</div>
          </button>

          {/* Optional: continue to genre setup without picking a path */}
          <button
            onClick={advance}
            style={{
              marginTop: 18, width: '100%',
              background: 'none', border: 'none',
              color: C.dim, ...MONO, fontSize: 11,
              cursor: 'pointer', letterSpacing: '0.1em',
              padding: 8,
            }}>
            {t('onboarding.v3.pathContinue')} →
          </button>
        </div>
      )}

      {/* ── Step 2: Genres (optional) ────────────────────────── */}
      {step === 2 && (
        <div style={{ width: '100%', maxWidth: 360, marginTop: 80, marginBottom: 40 }}>
          <div style={{
            fontSize: 10, color: C.accent, ...MONO,
            letterSpacing: '0.3em', textTransform: 'uppercase',
            textAlign: 'center', marginBottom: 12,
          }}>
            {t('onboarding.v3.genresEyebrow')}
          </div>
          <div style={{
            ...BEBAS, fontSize: 28, color: C.text,
            letterSpacing: '0.04em', lineHeight: 1.1,
            textAlign: 'center', marginBottom: 8,
          }}>
            {t('onboarding.v3.genresTitle')}
          </div>
          <div style={{
            fontSize: 12, color: C.muted, ...MONO,
            lineHeight: 1.6, textAlign: 'center', marginBottom: 20,
          }}>
            {t('onboarding.v3.genresDesc')}
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'center', marginBottom: 24 }}>
            {GENRES.map(g => {
              const active = genres.includes(g);
              return (
                <button key={g}
                  onClick={() => setGenres(s => active ? s.filter(x => x !== g) : [...s, g])}
                  style={{
                    fontSize: 11, padding: '7px 12px', borderRadius: 18,
                    background: active ? C.accent + '22' : C.bg2,
                    color: active ? C.accent : C.muted,
                    border: '1px solid ' + (active ? C.accent + '88' : C.border),
                    cursor: 'pointer', ...MONO,
                    minHeight: 36,
                  }}>
                  {g}
                </button>
              );
            })}
          </div>

          <button onClick={() => finish('complete')} style={{
            width: '100%', padding: '16px',
            background: 'linear-gradient(135deg, #dc2626, #991b1b)',
            border: 'none', borderRadius: 12,
            color: '#fff', cursor: 'pointer',
            ...BEBAS, fontSize: 22, letterSpacing: '0.1em',
            boxShadow: '0 4px 24px #dc262644',
          }}>
            🤘 {t('onboarding.v3.genresCta')}
          </button>
          <button
            onClick={() => finish('skip_genres')}
            style={{
              marginTop: 12, width: '100%',
              background: 'none', border: 'none',
              color: C.dim, ...MONO, fontSize: 11,
              cursor: 'pointer', letterSpacing: '0.1em',
              padding: 8,
            }}>
            {t('common.skip')}
          </button>
        </div>
      )}
    </div>
  );
}
