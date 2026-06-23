'use client';
// ── OnboardingWizard — first-launch 3-step modal ───────────────
//
// Why this exists: signed-in user lands on an empty Feed (no
// followed artists yet, no Discogs link), sees no value, leaves.
// Day-1 drop-off was the silent killer of every prior PWA build.
// This wizard runs once (profiles.onboarding_completed boolean
// flips to true on finish) and:
//   1. Pitches the value prop in one screen — what the app does
//   2. Prompts a Discogs OAuth (one tap → all their collection
//      pulls in, instant 'aha')
//   3. Seeds 5–10 popular metal artists they can tap to follow
//      so the Feed isn't empty when they exit
//
// Skip-anywhere is intentional — forcing onboarding completion
// before showing the app is annoying. Each step has both
// "Continue" and "Skip" (or "Done" on the last step).

import { useEffect, useState } from 'react';
import { C, MONO, BEBAS } from '@/lib/theme';
import { useT } from '@/lib/i18n';

// Curated starter list — mainstream-enough to be recognisable
// across PL/EN/DE markets, broad enough across subgenres to give
// almost any incoming user one or two they like.
const STARTER_ARTISTS = [
  'Metallica', 'Iron Maiden', 'Black Sabbath', 'Slayer', 'Megadeth',
  'Pantera', 'Tool', 'Mastodon', 'Gojira', 'Opeth',
  'Behemoth', 'Mgła', 'Ghost', 'Sleep Token', 'Spiritbox',
];

export default function OnboardingWizard({ user, onComplete, onConnectDiscogs, onFollow, followedArtists = [] }) {
  const t = useT();
  const [step, setStep] = useState(0);
  const [seeded, setSeeded] = useState(new Set());
  const [saving, setSaving] = useState(false);

  // Seed selection state from existing follows (so if the user
  // already follows Metallica when re-opening the wizard, that
  // chip appears active).
  useEffect(() => {
    const existing = new Set(
      (followedArtists || []).map(a => (a.artist_name || '').toLowerCase())
    );
    setSeeded(new Set(STARTER_ARTISTS.filter(n => existing.has(n.toLowerCase()))));
  }, [followedArtists]);

  const finish = async (mode = 'complete') => {
    setSaving(true);
    try {
      // Persist the completion flag so the wizard never reappears.
      await fetch('/api/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ onboarding_completed: true }),
      });
    } catch {}
    setSaving(false);
    onComplete?.(mode);
  };

  const toggleSeed = (name) => {
    const next = new Set(seeded);
    if (next.has(name)) {
      next.delete(name);
    } else {
      next.add(name);
      // Fire follow immediately — optimistic; user sees follow
      // count tick up as they tap. Background failure is logged
      // but doesn't block the wizard.
      try { onFollow?.(name); } catch {}
    }
    setSeeded(next);
  };

  // ── Step screens ────────────────────────────────────────────

  const steps = [
    // 0. Welcome
    {
      key: 'welcome',
      title: t('onboarding.welcome.title') || 'Witaj w Metal Vault',
      subtitle: t('onboarding.welcome.subtitle')
        || 'Twoja kolekcja, twoje koncerty, twoje statystyki — wszystko w jednym miejscu.',
      body: (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '8px 0' }}>
          {[
            { i: '💿', t: t('onboarding.welcome.f1') || 'Kolekcja winyli z wyceną Discogs' },
            { i: '🔥', t: t('onboarding.welcome.f2') || 'Premiery od śledzonych zespołów' },
            { i: '🎤', t: t('onboarding.welcome.f3') || 'Kalendarz koncertów + Live mode na festiwalach' },
            { i: '💰', t: t('onboarding.welcome.f4') || 'Historia sprzedaży z PnL' },
            { i: '📦', t: t('onboarding.welcome.f5') || 'Pre-ordery + powiadomienia o premierach' },
          ].map((f, i) => (
            <div key={i} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
              <div style={{ fontSize: 22, lineHeight: 1, marginTop: 2 }}>{f.i}</div>
              <div style={{ fontSize: 13, color: C.text, ...MONO, lineHeight: 1.5, flex: 1 }}>{f.t}</div>
            </div>
          ))}
        </div>
      ),
      cta: t('onboarding.continue') || 'Dalej',
      onCta: () => setStep(1),
    },
    // 1. Connect Discogs
    {
      key: 'discogs',
      title: t('onboarding.discogs.title') || 'Połącz Discogs',
      subtitle: t('onboarding.discogs.subtitle')
        || 'Jeden klik — cała Twoja kolekcja z Discogs pojawi się tutaj. Wartości, warianty, daty zakupu — wszystko.',
      body: (
        <div style={{ background: C.bg3, border: '1px solid ' + C.border,
          borderRadius: 10, padding: '14px', marginTop: 8 }}>
          <div style={{ fontSize: 11, color: C.dim, ...MONO, lineHeight: 1.6 }}>
            • {t('onboarding.discogs.b1') || 'Import istniejącej kolekcji + watchlist'}<br/>
            • {t('onboarding.discogs.b2') || 'Wantlist trafia do śledzonych premier'}<br/>
            • {t('onboarding.discogs.b3') || 'Codzienna aktualizacja cen rynkowych'}<br/>
            <br/>
            <span style={{ color: C.muted }}>
              {t('onboarding.discogs.skip') || 'Możesz to zrobić później w Profilu.'}
            </span>
          </div>
        </div>
      ),
      cta: t('onboarding.discogs.connect') || '🔗 Połącz Discogs',
      onCta: () => {
        try { onConnectDiscogs?.(); } catch {}
        // Don't wait — user's about to be redirected to Discogs OAuth.
        // Mark wizard complete so they don't see it again on return.
        finish('discogs');
      },
      altLabel: t('onboarding.skip') || 'Pomiń',
      onAlt: () => setStep(2),
    },
    // 2. Follow starter artists
    {
      key: 'follow',
      title: t('onboarding.follow.title') || 'Zacznij od kilku zespołów',
      subtitle: t('onboarding.follow.subtitle')
        || 'Wybierz przynajmniej 3 — będziemy Ci pokazywać ich premiery, koncerty i nowe ogłoszenia.',
      body: (
        <div style={{ marginTop: 8 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {STARTER_ARTISTS.map(name => {
              const active = seeded.has(name);
              return (
                <button key={name} onClick={() => toggleSeed(name)}
                  style={{
                    padding: '8px 14px',
                    borderRadius: 20,
                    background: active ? C.accent + '22' : C.bg3,
                    color: active ? C.accent : C.muted,
                    border: '1px solid ' + (active ? C.accent + '66' : C.border),
                    cursor: 'pointer',
                    fontSize: 13, ...MONO, fontWeight: active ? 600 : 400,
                  }}>
                  {active ? '✓ ' : ''}{name}
                </button>
              );
            })}
          </div>
          <div style={{ marginTop: 14, fontSize: 11, color: C.dim, ...MONO,
            textAlign: 'center' }}>
            {seeded.size === 0
              ? (t('onboarding.follow.empty') || 'Tap to follow — wybierz dowolną liczbę')
              : t('onboarding.follow.count', { n: seeded.size })
                || `${seeded.size} ${seeded.size === 1 ? 'zespół wybrany' : 'zespołów wybranych'}`}
          </div>
        </div>
      ),
      cta: seeded.size > 0
        ? (t('onboarding.follow.done') || 'Gotowe — pokaż mi apkę')
        : (t('onboarding.skip') || 'Pomiń'),
      onCta: () => finish('complete'),
    },
  ];

  const current = steps[step];

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 6000,
      background: 'rgba(0,0,0,0.85)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 16,
    }}>
      <div role="dialog" aria-modal="true"
        style={{
          background: C.bg2, border: '1px solid ' + C.border,
          borderRadius: 16, width: '100%', maxWidth: 460,
          maxHeight: '90vh', overflow: 'auto',
          display: 'flex', flexDirection: 'column',
        }}>
        {/* Step dots — top right */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6,
          padding: '14px 16px 0' }}>
          {steps.map((s, i) => (
            <div key={i} style={{
              width: 6, height: 6, borderRadius: '50%',
              background: i === step ? C.accent : C.border,
              transition: 'background 0.2s',
            }}/>
          ))}
        </div>

        {/* Header */}
        <div style={{ padding: '14px 22px 6px' }}>
          <div style={{ ...BEBAS, fontSize: 24, color: C.text,
            letterSpacing: '0.04em', lineHeight: 1.15 }}>
            {current.title}
          </div>
          <div style={{ fontSize: 12, color: C.muted, ...MONO,
            lineHeight: 1.5, marginTop: 6 }}>
            {current.subtitle}
          </div>
        </div>

        {/* Body */}
        <div style={{ padding: '8px 22px 4px', flex: 1 }}>
          {current.body}
        </div>

        {/* Footer — primary + optional skip */}
        <div style={{ padding: '14px 22px 22px',
          display: 'flex', flexDirection: 'column', gap: 8 }}>
          <button onClick={current.onCta} disabled={saving}
            style={{
              width: '100%', padding: '13px',
              background: 'linear-gradient(135deg,#dc2626,#991b1b)',
              border: 'none', borderRadius: 10, color: '#fff',
              cursor: saving ? 'wait' : 'pointer',
              ...BEBAS, fontSize: 15, letterSpacing: '0.06em',
              opacity: saving ? 0.6 : 1,
            }}>
            {current.cta}
          </button>
          {current.altLabel && (
            <button onClick={current.onAlt} disabled={saving}
              style={{
                width: '100%', padding: '8px',
                background: 'none', border: 'none',
                color: C.dim, cursor: saving ? 'wait' : 'pointer',
                ...MONO, fontSize: 11,
              }}>
              {current.altLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
