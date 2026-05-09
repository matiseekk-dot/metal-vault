'use client';
// ── UpgradeModal — Pro paywall ────────────────────────────────────
//
// Single-tier (Pro) paywall. The Collector tier was scoped earlier as
// a power-user upsell (market intelligence + AI recommendations + bulk
// ops) but never wired through Stripe — TIERS.collector.available is
// false, the env vars STRIPE_PRICE_COLLECTOR_* are unset, and the
// /api/stripe/checkout handler returns 503 "Stripe price IDs not
// configured" for any collector_* plan. Showing a tier toggle that
// dead-ends in an error is worse than not offering it.
//
// If/when Collector ships:
//   1. Set STRIPE_PRICE_COLLECTOR_MONTHLY/YEARLY in Vercel env
//   2. Flip TIERS.collector.available = true in lib/pricing.js
//   3. Re-introduce the tier toggle + COLLECTOR_FEATURES list here
//      (preserved in git history at 73dd38a~1).

import { useState } from 'react';
import { C, MONO, BEBAS } from '@/lib/theme';
import { useT } from '@/lib/i18n';
import Icon from '@/app/components/Icon';
import { TIERS, FREE_TRIAL_DAYS } from '@/lib/pricing';
import { useBackButton } from '@/lib/hooks/useBackButton';
import { trackPaywallCTA } from '@/lib/analytics';

const FEATURES = [
  { iconName: 'pkg',             free: 'Unlimited',      pro: 'Unlimited'           },
  { iconName: 'bell',            free: TIERS.free.alertLimit + ' alerts',       pro: 'Unlimited'           },
  { iconName: 'insurance',       free: '—',              pro: 'Insurance PDF'       },
  { iconName: 'detailedGrading', free: '—',              pro: 'Detailed grading'    },
  { iconName: 'priceHistory',    free: '—',              pro: 'Price history'       },
  { iconName: 'zap',             free: 'Daily',          pro: 'On-demand refresh'   },
  { iconName: 'export',          free: '—',              pro: 'CSV / JSON export'   },
  { iconName: 'user',            free: 'Persona share',  pro: 'Persona + stats'     },
  { iconName: 'barChart',        free: 'Basic stats',    pro: 'Full portfolio'      },
  { iconName: 'bellOn',          free: 'Weekly digest',  pro: 'Daily + pre-orders'  },
];

export default function UpgradeModal({ onClose, onCheckout, reason }) {
  const t = useT();
  const [plan,    setPlan]    = useState('monthly');
  const [loading, setLoading] = useState(false);
  useBackButton(true, onClose);

  const handleUpgrade = async () => {
    setLoading(true);
    trackPaywallCTA(reason, plan);
    await onCheckout(plan);
    setLoading(false);
  };

  // Reason text pulled from i18n via key lookup: paywall.reason.<REASON>
  const getReasonMessage = () => {
    if (!reason) return null;
    const key = 'paywall.reason.' + reason;
    const translated = t(key);
    return translated === key ? reason : translated;  // fallback to reason itself if no translation
  };

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: '#000000dd', zIndex: 400,
        display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div style={{ background: C.bg2, borderRadius: '20px 20px 0 0',
        maxHeight: '90vh', overflow: 'auto',
        paddingBottom: 'env(safe-area-inset-bottom, 24px)' }}
      >
        {/* Handle */}
        <div style={{ width: 40, height: 4, background: '#333', borderRadius: 2, margin: '14px auto 0' }} />

        {/* Header */}
        <div style={{ padding: '20px 20px 0', textAlign: 'center' }}>
          {reason && (
            <div style={{ background: '#1a0a00', border: '1px solid #f97316', borderRadius: 8,
              padding: '8px 14px', fontSize: 12, color: '#f97316', ...MONO, marginBottom: 16 }}>
              {getReasonMessage()}
            </div>
          )}
          <div style={{ fontSize: 13, color: C.accent, ...MONO, letterSpacing: '0.25em',
            textTransform: 'uppercase', marginBottom: 6 }}>
            {t('paywall.upgradeTo')}
          </div>
          <div style={{ ...BEBAS, fontSize: 44, lineHeight: 1,
            background: 'linear-gradient(135deg, #dc2626, #f5c842)',
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            METAL VAULT PRO
          </div>
          <div style={{ fontSize: 12, color: C.muted, ...MONO, marginTop: 6, marginBottom: 20 }}>
            {t('paywall.trial', { n: FREE_TRIAL_DAYS })}
          </div>
        </div>

        {/* Plan toggle (monthly vs yearly) */}
        <div style={{ display: 'flex', margin: '0 20px 20px', background: C.bg3,
          borderRadius: 12, padding: 4, border: '1px solid ' + C.border }}>
          {[
            { id: 'monthly', label: t('paywall.monthly'),
              price: '$' + TIERS.pro.monthly },
            { id: 'yearly',  label: t('paywall.yearly'),
              price: '$' + TIERS.pro.yearly,
              badge: t('paywall.yearlyBadge') },
          ].map(p => (
            <button key={p.id} onClick={() => setPlan(p.id)} style={{
              flex: 1, padding: '10px 8px', borderRadius: 10, border: 'none', cursor: 'pointer',
              background: plan === p.id ? C.accent : 'transparent',
              transition: 'all 0.2s',
            }}>
              <div style={{ fontSize: 12, color: plan === p.id ? '#fff' : C.dim, ...MONO }}>
                {p.label}
              </div>
              <div style={{ fontSize: 15, color: plan === p.id ? '#fff' : C.muted, ...BEBAS, lineHeight: 1.4 }}>
                {p.price}
              </div>
              {p.badge && (
                <div style={{ fontSize: 9, background: '#f5c842', color: '#000',
                  borderRadius: 4, padding: '1px 5px', ...MONO, display: 'inline-block', marginTop: 2 }}>
                  {p.badge}
                </div>
              )}
            </button>
          ))}
        </div>

        {/* Feature comparison */}
        <div style={{ margin: '0 20px 20px', background: C.bg3, borderRadius: 12,
          border: '1px solid ' + C.border, overflow: 'hidden' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '32px 1fr 1fr',
            padding: '8px 14px', borderBottom: '1px solid ' + C.border }}>
            <div />
            <div style={{ fontSize: 9, color: C.dim, ...MONO, letterSpacing: '0.15em', textAlign: 'center' }}>{t('common.free')}</div>
            <div style={{ fontSize: 9, color: C.accent, ...MONO, letterSpacing: '0.15em', textAlign: 'center' }}>{t('common.pro')}</div>
          </div>
          {FEATURES.map((f, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '32px 1fr 1fr',
              padding: '10px 14px', borderBottom: i < FEATURES.length - 1 ? '1px solid ' + C.border : 'none',
              alignItems: 'center' }}>
              <Icon name={f.iconName} size={16} color={C.accent}/>
              <span style={{ fontSize: 11, color: C.dim, ...MONO, textAlign: 'center' }}>
                {f.free === '—' ? <span style={{ color: '#555' }}>✕</span> : f.free}
              </span>
              <span style={{ fontSize: 11, color: '#4ade80', ...MONO, textAlign: 'center', fontWeight: 'bold' }}>
                {f.pro}
              </span>
            </div>
          ))}
        </div>

        {/* CTA */}
        <div style={{ padding: '0 20px 12px' }}>
          <button onClick={handleUpgrade} disabled={loading} style={{
            width: '100%', padding: '16px',
            background: loading ? C.bg3 : 'linear-gradient(135deg, #dc2626, #991b1b)',
            border: 'none', borderRadius: 14,
            color: '#fff',
            cursor: loading ? 'default' : 'pointer',
            ...BEBAS, fontSize: 22, letterSpacing: '0.08em',
            boxShadow: loading ? 'none' : '0 4px 24px #dc262644',
            transition: 'all 0.2s',
          }}>
            {loading ? t('paywall.cta.loading') : t('paywall.cta')}
          </button>
          <div style={{ fontSize: 10, color: C.dim, ...MONO, textAlign: 'center', marginTop: 10 }}>
            {t('paywall.powered')}
          </div>
          <button onClick={onClose} style={{ display: 'block', width: '100%', marginTop: 8,
            background: 'none', border: 'none', color: C.dim, cursor: 'pointer', ...MONO, fontSize: 11,
            padding: '8px', textAlign: 'center' }}>
            {t('paywall.laterBtn')}
          </button>
        </div>
      </div>
    </div>
  );
}
