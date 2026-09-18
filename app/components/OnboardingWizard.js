'use client';
// ── OnboardingWizard — first-launch 3-step modal (v2, demo-first) ─
//
// v1 (1.1.3) opened with a text feature list, then pushed Discogs
// OAuth as step 1. Retention data from Aug/Sep 2026 (6% MAU vs
// 51 total installs) said users bounced right there — no Discogs
// account, no obvious value, close app.
//
// v2 rewrites the flow with value-first pacing:
//   Step 0 → Pick starter artists (immediate action, no login)
//   Step 1 → "Look what's happening" — LIVE releases fetched
//            for their picks, so they see real data driven by
//            their choices BEFORE any commitment
//   Step 2 → Optional Discogs OAuth (nice-to-have, not gating)
//
// After finish we schedule a D1 local notification about the
// user's #1 followed artist so they get pulled back tomorrow.
//
// Analytics: every step + action fires trackOnboardingStep so we
// can see exactly where users drop off in PostHog funnels.

import { useEffect, useState } from 'react';
import { C, MONO, BEBAS } from '@/lib/theme';
import { useT } from '@/lib/i18n';
import { trackOnboardingStep, track } from '@/lib/analytics';

// Curated starter list — mainstream-enough to be recognisable
// across PL/EN/DE markets, broad enough across subgenres to give
// almost any incoming user one or two they like.
const STARTER_ARTISTS = [
  'Metallica', 'Iron Maiden', 'Black Sabbath', 'Slayer', 'Megadeth',
  'Pantera', 'Tool', 'Mastodon', 'Gojira', 'Opeth',
  'Behemoth', 'Mgła', 'Ghost', 'Sleep Token', 'Spiritbox',
];

// Fallback preview shown if the MA endpoint returns nothing for
// the user's picks (they picked obscure ones, or MA hasn't been
// warmed for those yet). Real dates updated by cron, but the
// initial hard-coded set proves the concept even offline.
const FALLBACK_PREVIEW = [
  { artist: 'Behemoth',      album: 'The Shit ov God',           date: '2026-10-31' },
  { artist: 'Gojira',        album: 'Fortitude II',              date: '2026-11-14' },
  { artist: 'Sleep Token',   album: 'Even in Arcadia (Live)',    date: '2026-12-05' },
];

async function scheduleD1Notification(topArtist) {
  // Wrapped in try/catch — the whole thing is best-effort. On
  // web / non-native the plugin is a no-op; on Android we ask
  // for permission and schedule a single reminder for tomorrow.
  try {
    const { Capacitor } = await import('@capacitor/core');
    if (!Capacitor.isNativePlatform()) return;
    const { LocalNotifications } = await import('@capacitor/local-notifications');
    const perm = await LocalNotifications.requestPermissions();
    if (perm.display !== 'granted') return;
    // Permission granted == consent to notifications in general (it's
    // the one OS-level POST_NOTIFICATIONS prompt). Opt in to server
    // push as well so pre-order/alert pushes reach them with the app
    // closed, and mirror it into the Profile toggle. Best-effort: no-op
    // on builds without the native FCM plugin.
    try { localStorage.setItem('mv_local_notif_enabled', 'true'); } catch {}
    import('@/lib/native-push')
      .then(m => m.enableNativePush({ prompt: false }))
      .catch(() => {})
      .finally(() => { try { window.dispatchEvent(new Event('mv:native-push-changed')); } catch {} });
    const at = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await LocalNotifications.schedule({
      notifications: [{
        id:        901,
        title:     '🔥 Metal Vault',
        body:      topArtist
          ? `Sprawdź co nowego u ${topArtist} i innych śledzonych zespołów`
          : 'Sprawdź co nowego u śledzonych zespołów w tym tygodniu',
        schedule:  { at, allowWhileIdle: true },
        smallIcon: 'ic_stat_metalvault',
      }],
    });
    track('d1_notification_scheduled', { top_artist: topArtist || null });
  } catch (e) {
    // Silent — notifications are a nice-to-have, not a blocker.
  }
}

export default function OnboardingWizard({ user, onComplete, onConnectDiscogs, onFollow, followedArtists = [] }) {
  const t = useT();
  const [step, setStep] = useState(0);
  const [seeded, setSeeded] = useState(new Set());
  const [saving, setSaving] = useState(false);

  // Live preview data — pulled once the user moves to step 1.
  const [preview, setPreview]         = useState(null);   // array or null
  const [previewLoading, setLoading]  = useState(false);

  // Seed selection state from existing follows (so if the user
  // already follows Metallica when re-opening the wizard, that
  // chip appears active).
  useEffect(() => {
    const existing = new Set(
      (followedArtists || []).map(a => (a.artist_name || '').toLowerCase())
    );
    setSeeded(new Set(STARTER_ARTISTS.filter(n => existing.has(n.toLowerCase()))));
  }, [followedArtists]);

  // Fire wizard_shown once on mount.
  useEffect(() => {
    track('wizard_shown');
    trackOnboardingStep(0, 'view');
  }, []);

  // Load the preview when the user enters step 1. We call the
  // metal-archives endpoint (it already returns upcoming releases
  // for any user) and client-side filter to the picked artists.
  // If nothing matches (obscure picks / cold cache), fall back to
  // the hard-coded set so the step still delivers a wow moment.
  useEffect(() => {
    if (step !== 1) return;
    if (preview !== null) return;   // already loaded, don't refetch
    setLoading(true);
    (async () => {
      try {
        const r = await fetch('/api/releases/metal-archives');
        if (r.ok) {
          const d = await r.json();
          const items = Array.isArray(d?.items) ? d.items : [];
          const pickedLower = new Set(
            [...seeded].map(a => a.toLowerCase())
          );
          const matched = items
            .filter(x => x?.artist && pickedLower.has(x.artist.toLowerCase()))
            .filter(x => x?.releaseDate)
            .sort((a, b) => String(a.releaseDate).localeCompare(String(b.releaseDate)))
            .slice(0, 5);
          setPreview(matched.length > 0 ? matched : FALLBACK_PREVIEW);
        } else {
          setPreview(FALLBACK_PREVIEW);
        }
      } catch {
        setPreview(FALLBACK_PREVIEW);
      } finally {
        setLoading(false);
      }
    })();
  }, [step, preview, seeded]);

  const finish = async (mode = 'complete') => {
    setSaving(true);
    trackOnboardingStep(2, mode);   // 'complete' or 'discogs'
    track('wizard_completed', {
      followed_count:    seeded.size,
      via_discogs:       mode === 'discogs',
    });
    // Fire-and-forget: schedule a D1 push about the top followed band.
    // We don't await — if permission dialog blocks, we still finish
    // the wizard flow first.
    const topArtist = [...seeded][0];
    scheduleD1Notification(topArtist);
    try {
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
      track('wizard_artist_toggled', { artist: name, action: 'follow' });
    }
    setSeeded(next);
    // Force preview refetch next time user hits step 1 — their
    // picks changed so the preview should reflect that.
    setPreview(null);
  };

  // ── Step screens ────────────────────────────────────────────

  const steps = [
    // 0. Pick your bands — FIRST step now (was step 2 in v1).
    // Immediate interaction, no login barrier. Sets state for the
    // live preview on the next screen.
    {
      key: 'pick',
      title:    t('onboarding.follow.title')    || 'Zacznij od kilku zespołów',
      subtitle: t('onboarding.follow.subtitle') || 'Wybierz przynajmniej 3 — na następnym ekranie pokażemy Ci co u nich słychać.',
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
        ? (t('onboarding.continue') || 'Dalej')
        : (t('onboarding.skip')     || 'Pomiń'),
      onCta: () => {
        trackOnboardingStep(0, seeded.size > 0 ? 'next' : 'skip');
        setStep(1);
        trackOnboardingStep(1, 'view');
      },
    },
    // 1. Live preview — the wow moment. Real upcoming releases for
    // the user's picked artists, live from MB. If none match, we
    // fall back to a curated set so the screen always delivers.
    {
      key: 'preview',
      title:    t('onboarding.preview.title')    || 'Zobacz co się dzieje',
      subtitle: seeded.size > 0
        ? (t('onboarding.preview.subtitleWithPicks')
          || 'Twoje zespoły + nadchodzące premiery + koncerty — w jednym miejscu.')
        : (t('onboarding.preview.subtitleNoPicks')
          || 'Nadchodzące premiery metalu w tym kwartale. Wybierz kilka zespołów, żeby spersonalizować.'),
      body: (
        <div style={{ marginTop: 8 }}>
          {previewLoading && (
            <div style={{ padding: 30, textAlign: 'center', fontSize: 12,
              color: C.dim, ...MONO }}>
              {t('common.loading') || 'Ładuję…'}
            </div>
          )}
          {!previewLoading && preview && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {preview.map((r, i) => {
                const days = Math.round(
                  (new Date(r.releaseDate || r.date) - Date.now()) / 86400000
                );
                const when = days === 0 ? 'dziś'
                  : days === 1 ? 'jutro'
                  : days > 0 && days < 30 ? `za ${days}d`
                  : days >= 30 && days < 90 ? `za ${Math.round(days / 30)} mies.`
                  : String(r.releaseDate || r.date).slice(0, 10);
                return (
                  <div key={i} style={{
                    display: 'flex', gap: 10, alignItems: 'center',
                    padding: '12px 14px',
                    background: C.bg3, border: '1px solid ' + C.border,
                    borderRadius: 10,
                  }}>
                    <div style={{ fontSize: 22, lineHeight: 1 }}>🔥</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, color: C.accent, ...MONO,
                        fontWeight: 600 }}>
                        {r.artist}
                      </div>
                      <div style={{ fontSize: 13, color: C.text, ...MONO,
                        marginTop: 2, overflow: 'hidden',
                        textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {r.album || r.title}
                      </div>
                    </div>
                    <div style={{ fontSize: 11, color: C.dim, ...MONO,
                      flexShrink: 0 }}>
                      {when}
                    </div>
                  </div>
                );
              })}
              <div style={{ marginTop: 4, fontSize: 10, color: C.dim, ...MONO,
                textAlign: 'center', lineHeight: 1.5 }}>
                {t('onboarding.preview.footer')
                  || '+ powiadomienia, koncerty, wyceny Discogs — wszystko w apce.'}
              </div>
            </div>
          )}
        </div>
      ),
      cta: t('onboarding.continue') || 'Dalej',
      onCta: () => {
        trackOnboardingStep(1, 'next');
        setStep(2);
        trackOnboardingStep(2, 'view');
      },
    },
    // 2. Discogs — now the LAST step, framed as an add-on for
    // existing Discogs users, not a wall for new users.
    {
      key: 'discogs',
      title:    t('onboarding.discogs.title')    || 'Masz konto Discogs?',
      subtitle: t('onboarding.discogs.subtitle2')
        || 'Podłącz — cała Twoja kolekcja pojawi się tutaj z aktualnymi cenami. Bez konta? Nic nie szkodzi, możesz dodawać ręcznie.',
      body: (
        <div style={{ background: C.bg3, border: '1px solid ' + C.border,
          borderRadius: 10, padding: '14px', marginTop: 8 }}>
          <div style={{ fontSize: 11, color: C.dim, ...MONO, lineHeight: 1.6 }}>
            • {t('onboarding.discogs.b1') || 'Import istniejącej kolekcji + watchlist'}<br/>
            • {t('onboarding.discogs.b2') || 'Wantlist trafia do śledzonych premier'}<br/>
            • {t('onboarding.discogs.b3') || 'Codzienna aktualizacja cen rynkowych'}<br/>
            <br/>
            <span style={{ color: C.muted }}>
              {t('onboarding.discogs.skipHint2')
                || 'Bez Discogs też się przyda — dodawaj płyty ręcznie albo skanem kodu.'}
            </span>
          </div>
        </div>
      ),
      cta: t('onboarding.discogs.connect') || '🔗 Połącz Discogs',
      onCta: () => {
        trackOnboardingStep(2, 'discogs_clicked');
        try { onConnectDiscogs?.(); } catch {}
        // Don't wait — user's about to be redirected to Discogs OAuth.
        // Mark wizard complete so they don't see it again on return.
        finish('discogs');
      },
      altLabel: t('onboarding.follow.done') || 'Gotowe — pokaż mi apkę',
      onAlt: () => {
        trackOnboardingStep(2, 'discogs_skipped');
        finish('complete');
      },
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
