'use client';
// ── Recommendations card ────────────────────────────────────────
//
// Renders inside Vault → Słuchaj. Pulls /api/recommendations once on
// mount, displays the top 12 "you might like X" results as taps that
// follow the band (POST /api/artists). Self-hides if there's not
// enough listening data yet to seed the algorithm.
//
// UX: this is a discovery hook, not a content surface — keep the card
// tight (one line per artist, "because of X+Y" mini-context). User
// taps a row to follow → the recommendation queue regenerates next
// session (cache TTL 24h on server).

import { useEffect, useState } from 'react';
import { C, MONO, BEBAS } from '@/lib/theme';
import { useT } from '@/lib/i18n';
import { toast } from '@/app/components/Toast';
import { haptic } from '@/lib/haptics';
import { track } from '@/lib/analytics';

export default function Recommendations({ premium = false }) {
  const t = useT();
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [followedSet, setFollowedSet] = useState(new Set());
  const [busyName, setBusyName] = useState(null);

  // Free tier sees a preview of the algorithm's output (top 3); Pro
  // sees the full 12. Both pull the same endpoint — gating lives in
  // the render layer because the discovery COST (Last.fm calls,
  // aggregation) is the same regardless of how many we display.
  const FREE_LIMIT = 3;

  useEffect(() => {
    let cancelled = false;
    fetch('/api/recommendations')
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (cancelled) return;
        setData(d);
        setLoading(false);
      })
      .catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const follow = async (name) => {
    if (followedSet.has(name) || busyName === name) return;
    setBusyName(name);
    try {
      const r = await fetch('/api/artists', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ artist_name: name }),
      });
      if (!r.ok) throw new Error('Failed');
      haptic.success();
      track('recommendation_follow', { name });
      setFollowedSet(prev => new Set(prev).add(name));
      toast.success(t('reco.followed') || 'Following ' + name);
    } catch (e) {
      toast.error(e.message);
    }
    setBusyName(null);
  };

  // Don't render anything while loading, or when the server told us we
  // don't have enough seed data yet. Empty state would just be noise.
  if (loading) return null;
  if (!data || !data.recommendations || data.recommendations.length === 0) return null;

  return (
    <div style={{
      background: C.bg2, border: '1px solid ' + C.border, borderRadius: 12,
      padding: 14, marginBottom: 12,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <span style={{ fontSize: 10, color: C.accent, ...MONO,
          letterSpacing: '0.18em', textTransform: 'uppercase' }}>
          ✨ {t('reco.title') || 'Może ci się spodobać'}
        </span>
        {data.seeds?.length > 0 && (
          <span style={{ fontSize: 9, color: C.dim, ...MONO,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 200 }}>
            {(t('reco.basedOn') || 'na podstawie') + ' ' + data.seeds.slice(0, 3).join(', ')}
          </span>
        )}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {(premium ? data.recommendations : data.recommendations.slice(0, FREE_LIMIT)).map((r, i) => {
          const isFollowed = followedSet.has(r.name);
          const isBusy     = busyName === r.name;
          return (
            <div key={r.name}
              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0',
                borderBottom: i < data.recommendations.length - 1 ? '1px solid ' + C.border : 'none' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ ...BEBAS, fontSize: 14, color: C.text, letterSpacing: '0.04em', lineHeight: 1.1,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {r.name}
                </div>
                {r.becauseOf?.length > 0 && (
                  <div style={{ fontSize: 9, color: C.dim, ...MONO, marginTop: 2,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {(t('reco.because') || 'bo') + ' ' + r.becauseOf.join(' + ')}
                  </div>
                )}
              </div>
              {/* Multi-seed match badge — these are genuinely interesting recs
                  because Last.fm associates the artist with MULTIPLE of your
                  faves. Highlights signal vs noise. */}
              {r.becauseOf?.length >= 2 && (
                <span style={{ fontSize: 8, color: '#f97316', ...MONO,
                  background: '#3a1a06', padding: '1px 5px', borderRadius: 3,
                  border: '1px solid #f9731644', letterSpacing: '0.05em' }}>
                  ×{r.becauseOf.length}
                </span>
              )}
              <button onClick={() => follow(r.name)}
                disabled={isFollowed || isBusy}
                style={{
                  background:  isFollowed ? '#1a1a3d' : '#1a3d1a',
                  border: '1px solid ' + (isFollowed ? '#a5b4fc' : '#4ade80'),
                  borderRadius: 6,
                  color: isFollowed ? '#a5b4fc' : '#4ade80',
                  cursor: isFollowed || isBusy ? 'default' : 'pointer',
                  fontSize: 9, ...MONO, fontWeight: 600,
                  padding: '4px 8px',
                  letterSpacing: '0.05em',
                  opacity: isBusy ? 0.5 : 1,
                  flexShrink: 0,
                }}>
                {isFollowed ? '★' : '+'}
              </button>
            </div>
          );
        })}
        {/* Upgrade CTA — only when free user has more recs hidden than
            shown. Tapping the row dispatches the global mv:upgrade
            event which mounts UpgradeModal with reason=RECOMMENDATIONS
            so we can A/B test paywall copy per feature. */}
        {!premium && data.recommendations.length > FREE_LIMIT && (
          <button onClick={() => {
            if (typeof window !== 'undefined') {
              window.dispatchEvent(new CustomEvent('mv:upgrade', { detail: { reason: 'RECOMMENDATIONS' } }));
            }
          }}
            style={{
              marginTop: 8, padding: '10px 12px',
              background: 'linear-gradient(135deg,#1a0a00,#2a1000)',
              border: '1px solid ' + C.accent + '66',
              borderRadius: 8, cursor: 'pointer',
              color: C.text, ...MONO, fontSize: 11, textAlign: 'center',
              letterSpacing: '0.04em',
            }}>
            ✨ {(t('reco.moreInPro', { n: data.recommendations.length - FREE_LIMIT })
                 || ('+' + (data.recommendations.length - FREE_LIMIT) + ' więcej w Pro →'))}
          </button>
        )}
      </div>
    </div>
  );
}
