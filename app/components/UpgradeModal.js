'use client';
import { useState } from 'react';
import { C, MONO, BEBAS } from '@/lib/theme';

const FEATURES = [
  { icon: '📦', free: 'Unlimited records',  pro: 'Unlimited records'     },
  { icon: '🔔', free: '1 price alert',      pro: 'Unlimited alerts'      },
  { icon: '📈', free: '—',                  pro: 'Price history charts'  },
  { icon: '⚡', free: 'Daily price update', pro: 'On-demand refresh'     },
  { icon: '📤', free: '—',                  pro: 'CSV / JSON export'     },
  { icon: '📊', free: 'Basic stats',        pro: 'Full portfolio analytics'},
];

export default function UpgradeModal({ onClose, onCheckout, reason }) {
  const [plan,    setPlan]    = useState('monthly');
  const [loading, setLoading] = useState(false);

  const handleUpgrade = async () => {
    setLoading(true);
    await onCheckout(plan);
    setLoading(false);
  };

  const reasonMessages = {
    ALERT_LIMIT_REACHED: '🔔 Free plan includes 1 price alert.',
    PREMIUM_REQUIRED:    '⚡ This feature requires Metal Vault Pro.',
    PRICE_HISTORY:       '📈 Price history is a Pro feature.',
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
          {reason && (reasonMessages[reason] || reason) && (
            <div style={{ background: '#1a0a00', border: '1px solid #f97316', borderRadius: 8,
              padding: '8px 14px', fontSize: 12, color: '#f97316', ...MONO, marginBottom: 16 }}>
              {reasonMessages[reason] || reason}
            </div>
          )}
          <div style={{ fontSize: 13, color: C.accent, ...MONO, letterSpacing: '0.25em',
            textTransform: 'uppercase', marginBottom: 6 }}>
            Upgrade to
          </div>
          <div style={{ ...BEBAS, fontSize: 44, lineHeight: 1,
            background: 'linear-gradient(135deg, #dc2626, #f5c842)',
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            METAL VAULT PRO
          </div>
          <div style={{ fontSize: 12, color: C.muted, ...MONO, marginTop: 6, marginBottom: 20 }}>
            7-day free trial · cancel anytime
          </div>
        </div>

        {/* Plan toggle */}
        <div style={{ display: 'flex', margin: '0 20px 20px', background: C.bg3,
          borderRadius: 12, padding: 4, border: '1px solid ' + C.border }}>
          {[
            { id: 'monthly', label: 'Monthly', price: '9.99 PLN' },
            { id: 'yearly',  label: 'Yearly',  price: '79.99 PLN', badge: 'SAVE 33%' },
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
            <div style={{ fontSize: 9, color: C.dim, ...MONO, letterSpacing: '0.15em', textAlign: 'center' }}>FREE</div>
            <div style={{ fontSize: 9, color: C.accent, ...MONO, letterSpacing: '0.15em', textAlign: 'center' }}>PRO</div>
          </div>
          {FEATURES.map((f, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '32px 1fr 1fr',
              padding: '10px 14px', borderBottom: i < FEATURES.length - 1 ? '1px solid ' + C.border : 'none',
              alignItems: 'center' }}>
              <span style={{ fontSize: 16 }}>{f.icon}</span>
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
            border: 'none', borderRadius: 14, color: '#fff', cursor: loading ? 'default' : 'pointer',
            ...BEBAS, fontSize: 22, letterSpacing: '0.08em',
            boxShadow: loading ? 'none' : '0 4px 24px #dc262644',
            transition: 'all 0.2s',
          }}>
            {loading ? 'REDIRECTING…' : '🤘 START FREE TRIAL'}
          </button>
          <div style={{ fontSize: 10, color: C.dim, ...MONO, textAlign: 'center', marginTop: 10 }}>
            Powered by Stripe · BLIK, P24, card accepted · cancel anytime
          </div>
          <button onClick={onClose} style={{ display: 'block', width: '100%', marginTop: 8,
            background: 'none', border: 'none', color: C.dim, cursor: 'pointer', ...MONO, fontSize: 11,
            padding: '8px', textAlign: 'center' }}>
            Maybe later
          </button>
        </div>
      </div>
    </div>
  );
}
