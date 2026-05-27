'use client';

// ── Privacy Policy ─────────────────────────────────────────────
// Required by Google OAuth Consent Screen verification (the URL
// referenced from console.cloud.google.com → OAuth consent must
// resolve to a real policy page or Google rejects the submission).
//
// Same i18n hook as the rest of the app — content swaps per the
// active locale (PL / EN / DE) without a server-side reshape.
// All third-party processors that touch user data are explicitly
// listed (Supabase, Discogs, Last.fm, Spotify, Stripe, RevenueCat,
// Vercel, Sentry, PostHog).

import { useT } from '@/lib/i18n';
import { C, MONO, BEBAS } from '@/lib/theme';

export default function PrivacyPage() {
  const t = useT();
  const today = new Date().toISOString().slice(0, 10);

  const sections = [
    {
      h: t('privacy.s1.title') || 'What we collect',
      p: t('privacy.s1.body')
        || 'Account email (via Google OAuth), your basic Google profile (name + avatar), the records you add to your vault, ratings/notes, listening history if you connect Last.fm or Spotify, concert attendance, and push notification subscription (if enabled). We do not collect location, contacts, SMS, or call data.',
    },
    {
      h: t('privacy.s2.title') || 'Why we use it',
      p: t('privacy.s2.body')
        || 'To run your collection — synchronize your data across devices, surface upcoming releases from artists you follow, notify you about price drops on watched records, and let you compare your library with friends. Aggregate (de-identified) usage data helps us decide which features to build next.',
    },
    {
      h: t('privacy.s3.title') || 'Who we share it with',
      p: t('privacy.s3.body')
        || 'Authentication and database — Supabase (EU region). Record metadata + market prices — Discogs. Streaming play history (opt-in) — Last.fm, Spotify. Payments — Stripe (web) or Google Play Billing via RevenueCat (Play Store). Hosting — Vercel. Error reporting — Sentry. Product analytics — PostHog (events only, no personal identifiers). We never sell your data.',
    },
    {
      h: t('privacy.s4.title') || 'Storage + retention',
      p: t('privacy.s4.body')
        || 'Your data stays in your account until you delete it. Account deletion wipes all rows owned by your user_id within 30 days. Backups are kept up to 90 days for disaster-recovery.',
    },
    {
      h: t('privacy.s5.title') || 'Cookies + local storage',
      p: t('privacy.s5.body')
        || 'We store an authentication token (Supabase session cookie), language + theme preferences (localStorage), and a small cache of vinyl data to speed up the feed. No tracking pixels.',
    },
    {
      h: t('privacy.s6.title') || 'Your rights',
      p: t('privacy.s6.body')
        || 'Under GDPR you can: access your data, export it (Profile → Export collection), correct it, delete it (Profile → Delete account), or restrict processing. Email us at the address below and we respond within 30 days.',
    },
    {
      h: t('privacy.s7.title') || 'Children',
      p: t('privacy.s7.body')
        || 'Metal Vault is not directed at children under 13. If you believe a child has provided us data, contact us and we will delete it.',
    },
    {
      h: t('privacy.s8.title') || 'Changes to this policy',
      p: t('privacy.s8.body')
        || 'If we make material changes we will surface a notice in-app the next time you sign in. Continued use after the change date constitutes acceptance.',
    },
    {
      h: t('privacy.s9.title') || 'Contact',
      p: t('privacy.s9.body')
        || 'Privacy questions, deletion requests, or anything else: matiseekk@gmail.com',
    },
  ];

  return (
    <div style={{
      minHeight: '100vh',
      background: C.bg,
      color: C.text,
      ...MONO,
      padding: '24px 20px 80px',
      maxWidth: 760,
      margin: '0 auto',
      fontSize: 14,
      lineHeight: 1.6,
    }}>
      <a href="/" style={{
        color: C.dim, ...MONO, fontSize: 12, textDecoration: 'none',
        display: 'inline-block', marginBottom: 24,
      }}>← {t('privacy.back') || 'Back to app'}</a>

      <h1 style={{
        ...BEBAS, fontSize: 36, letterSpacing: '0.04em',
        color: C.text, lineHeight: 1.1, marginBottom: 8,
      }}>
        {t('privacy.title') || 'Privacy Policy'}
      </h1>
      <div style={{ fontSize: 11, color: C.dim, marginBottom: 28 }}>
        {t('privacy.lastUpdated') || 'Last updated'}: {today} · Metal Vault · pl.skudev.metalvault
      </div>

      {sections.map((s, i) => (
        <section key={i} style={{ marginBottom: 28 }}>
          <h2 style={{
            ...BEBAS, fontSize: 18, color: C.accent,
            letterSpacing: '0.06em', textTransform: 'uppercase',
            marginBottom: 10,
          }}>
            {s.h}
          </h2>
          <p style={{ color: C.text, opacity: 0.85, margin: 0 }}>{s.p}</p>
        </section>
      ))}
    </div>
  );
}
