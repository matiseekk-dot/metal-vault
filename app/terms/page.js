'use client';

// ── Terms of Service ───────────────────────────────────────────
// Companion to /privacy. Required by both Google OAuth consent
// verification and the Play Store listing.

import Link from 'next/link';
import { useT } from '@/lib/i18n';
import { C, MONO, BEBAS } from '@/lib/theme';

export default function TermsPage() {
  const t = useT();
  const today = new Date().toISOString().slice(0, 10);

  const sections = [
    {
      h: t('terms.s1.title') || 'What Metal Vault does',
      p: t('terms.s1.body')
        || 'Metal Vault is a digital catalogue for your metal record collection: store records, track upcoming releases, log concerts, share collections with friends, and optionally see market prices via Discogs.',
    },
    {
      h: t('terms.s2.title') || 'Your account',
      p: t('terms.s2.body')
        || 'You sign in with Google. You are responsible for what happens under your account. Keep your Google account secure.',
    },
    {
      h: t('terms.s3.title') || 'Subscription + payments',
      p: t('terms.s3.body')
        || 'The core app is free. Metal Vault Pro is a paid upgrade with extra features (detailed grading, photo annotation, price alerts, advanced stats). Pro is offered monthly (2.99 USD) or yearly (19.99 USD). Charges are processed by Stripe (web) or Google Play Billing (Play Store install). Subscriptions auto-renew until you cancel. Cancel anytime from Profile → Manage subscription — you keep Pro until the period ends. Refunds follow the policy of the platform you paid through (Stripe for web, Google Play for Play Store).',
    },
    {
      h: t('terms.s4.title') || 'Acceptable use',
      p: t('terms.s4.body')
        || "Don't try to break the service, abuse the API, scrape other users' data, upload illegal content, or impersonate someone. We can suspend accounts that do.",
    },
    {
      h: t('terms.s5.title') || 'Your content',
      p: t('terms.s5.body')
        || 'You own your collection data. By using third-party providers (Discogs, Last.fm, Spotify) you also agree to their terms — we just stitch them together. Metal Vault does not claim ownership of any cover art or metadata fetched from those sources.',
    },
    {
      h: t('terms.s6.title') || 'Service availability',
      p: t('terms.s6.body')
        || 'We do our best to keep the app running 24/7. We rely on Vercel + Supabase + third-party APIs (Discogs, Last.fm, Spotify, MusicBrainz) so an outage of any of them can affect Metal Vault. We are not liable for losses caused by downtime.',
    },
    {
      h: t('terms.s7.title') || 'Limitation of liability',
      p: t('terms.s7.body')
        || 'Metal Vault is provided "as is". We are not liable for data loss, missed price alerts, missed releases, or any indirect/consequential damages, to the maximum extent permitted by law. Your one remedy in any case is to stop using the app.',
    },
    {
      h: t('terms.s8.title') || 'Changes to terms',
      p: t('terms.s8.body')
        || 'We may update these terms occasionally. Material changes will be surfaced in-app. Continued use after the change date means you accept the new terms.',
    },
    {
      h: t('terms.s9.title') || 'Governing law',
      p: t('terms.s9.body')
        || 'These terms are governed by the laws of Poland. Any disputes that cannot be resolved by email go to the courts of Warsaw.',
    },
    {
      h: t('terms.s10.title') || 'Contact',
      p: t('terms.s10.body')
        || 'Questions about these terms: matiseekk@gmail.com',
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
      <Link href="/" style={{
        color: C.dim, ...MONO, fontSize: 12, textDecoration: 'none',
        display: 'inline-block', marginBottom: 24,
      }}>← {t('terms.back') || 'Back to app'}</Link>

      <h1 style={{
        ...BEBAS, fontSize: 36, letterSpacing: '0.04em',
        color: C.text, lineHeight: 1.1, marginBottom: 8,
      }}>
        {t('terms.title') || 'Terms of Service'}
      </h1>
      <div style={{ fontSize: 11, color: C.dim, marginBottom: 28 }}>
        {t('terms.lastUpdated') || 'Last updated'}: {today} · Metal Vault · pl.skudev.metalvault
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
