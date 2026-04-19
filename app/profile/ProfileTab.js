// ── ProfileTab — extracted from app/page.js, cleaned ───────────
'use client';
import { useState } from 'react';
import { C, MONO, BEBAS, inputSt } from '@/lib/theme';

export default function ProfileTab({
  user, profile, followedArtists,
  onSignOut, onUpdateProfile, onShowImport,
  pushEnabled, pushLoading, onTogglePush,
  discogsConnected, onConnectDiscogs, onSyncDiscogs,
  syncStatus, syncResult,
  shareToken, onGetShareToken,
  premium, onUpgrade, onOpenPortal,
}) {
  const [username, setUsername] = useState(profile?.username || '');
  const [isPublic, setIsPublic] = useState(profile?.is_public || false);
  const [saving,   setSaving]   = useState(false);
  const [msg,      setMsg]      = useState('');

  const saveProfile = async () => {
    setSaving(true); setMsg('');
    const r = await fetch('/api/profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, is_public: isPublic }),
    });
    const d = await r.json();
    setSaving(false);
    setMsg(d.error || '✓ Saved');
    if (!d.error) onUpdateProfile({ username, is_public: isPublic });
  };

  if (!user) return (
    <div style={{ textAlign: 'center', padding: '60px 24px', color: C.dim, ...MONO }}>
      <div style={{ fontSize: 40, marginBottom: 12 }}>👤</div>
      <div style={{ fontSize: 13, marginBottom: 20, lineHeight: 1.7 }}>Sign in to manage your profile</div>
      <button onClick={() => window.location.href = '/login'}
        style={{
          background: 'linear-gradient(135deg,' + C.accent + ',' + C.accent2 + ')',
          border: 'none', borderRadius: 10, color: '#fff', padding: '13px 24px',
          ...BEBAS, fontSize: 18, letterSpacing: '0.1em', cursor: 'pointer',
        }}>
        SIGN IN
      </button>
    </div>
  );

  return (
    <div style={{ padding: '16px' }}>

      {/* User info */}
      <div style={{
        display: 'flex', gap: 14, alignItems: 'center', marginBottom: 24, padding: '16px',
        background: C.bg2, border: '1px solid ' + C.border, borderRadius: 12,
      }}>
        <div style={{
          width: 52, height: 52, borderRadius: '50%',
          background: 'linear-gradient(135deg,' + C.accent + ',#450a0a)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 24, overflow: 'hidden', flexShrink: 0,
        }}>
          {user.user_metadata?.avatar_url
            ? <img src={user.user_metadata.avatar_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            : <span style={{ ...BEBAS }}>{(user.email || '?')[0].toUpperCase()}</span>}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ ...BEBAS, fontSize: 20, color: C.text, lineHeight: 1 }}>{user.user_metadata?.full_name || 'Collector'}</div>
          <div style={{ fontSize: 11, color: C.dim, ...MONO, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis' }}>{user.email}</div>
        </div>
      </div>

      {/* ── Premium Status ───────────────────────────────────── */}
      {premium === true && (
        <div style={{ background: 'linear-gradient(135deg,#1a0800,#2a1000)', border: '1px solid #f5c842', borderRadius: 12, padding: '14px 16px', marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{ ...BEBAS, fontSize: 18, color: '#f5c842', letterSpacing: '0.08em', lineHeight: 1 }}>⭐ METAL VAULT PRO</div>
              <div style={{ fontSize: 10, color: '#a16207', ...MONO, marginTop: 3 }}>
                {profile?.subscription_status === 'trialing' ? '7-day free trial active' : 'Active subscription'}
                {profile?.subscription_end && (
                  <span> · renews {new Date(profile.subscription_end).toLocaleDateString('pl-PL')}</span>
                )}
              </div>
            </div>
            <button onClick={onOpenPortal}
              style={{ background: '#2a1a00', border: '1px solid #f5c842', borderRadius: 8, color: '#f5c842', padding: '7px 12px', cursor: 'pointer', ...MONO, fontSize: 10 }}>
              Manage
            </button>
          </div>
        </div>
      )}
      {premium === false && (
        <div style={{ background: 'linear-gradient(135deg,#0a0a0a,#1a0a00)', border: '1px solid #3f3f3f', borderRadius: 12, padding: '16px', marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
            <div>
              <div style={{ ...BEBAS, fontSize: 20, color: C.text, letterSpacing: '0.06em', lineHeight: 1 }}>FREE PLAN</div>
              <div style={{ fontSize: 10, color: C.dim, ...MONO, marginTop: 3 }}>Unlimited vinyl awaits</div>
            </div>
            <button onClick={onUpgrade}
              style={{ background: 'linear-gradient(135deg,#dc2626,#991b1b)', border: 'none', borderRadius: 8, color: '#fff', padding: '9px 16px', cursor: 'pointer', ...BEBAS, fontSize: 15, letterSpacing: '0.06em', flexShrink: 0 }}>
              UPGRADE →
            </button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            {[['📦','Unlimited records'],['🔔','1 price alert free'],['📈','No price history'],['⭐','Pro unlocks all']].map(([icon, text]) => (
              <div key={text} style={{ fontSize: 10, color: C.dim, ...MONO, display: 'flex', gap: 5, alignItems: 'center' }}>
                <span>{icon}</span><span>{text}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Public Profile Banner — prominent CTA */}
      {!profile?.is_public && (
        <div style={{ background: 'linear-gradient(135deg,#0d1a2e,#1a0a2e)', border: '1px solid #1e40af', borderRadius: 12, padding: '14px 16px', marginBottom: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <div style={{ fontSize: 11, color: '#60a5fa', ...MONO, marginBottom: 3 }}>🌐 Share your collection</div>
            <div style={{ fontSize: 10, color: '#4a7ab5', ...MONO, lineHeight: 1.5 }}>Enable public profile to show off your vault</div>
          </div>
          <button onClick={async () => {
              if (!username?.trim()) {
                alert('Set a username first in the profile settings below');
                return;
              }
              setIsPublic(true);
              await fetch('/api/profile', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, is_public: true }) });
              onUpdateProfile({ ...profile, is_public: true, username });
            }}
            style={{ background: '#1e40af', border: 'none', borderRadius: 8, color: '#fff', padding: '8px 14px', cursor: 'pointer', ...MONO, fontSize: 11, flexShrink: 0, whiteSpace: 'nowrap' }}>
            Go public →
          </button>
        </div>
      )}
      {(profile?.is_public || isPublic) && (profile?.username || username) && (
        <div style={{ background: '#001a00', border: '1px solid #166534', borderRadius: 12, padding: '14px 16px', marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <div style={{ fontSize: 11, color: '#4ade80', ...MONO }}>✓ Public profile active</div>
            <button onClick={() => {
                const link = `${typeof window !== 'undefined' ? window.location.origin : ''}/p/${profile?.username || username}`;
                navigator.clipboard?.writeText(link).then(() => alert('Link copied!'));
              }}
              style={{ background: '#0d2a0d', border: '1px solid #1a3d1a', borderRadius: 6, color: '#4ade80', padding: '5px 10px', cursor: 'pointer', ...MONO, fontSize: 10 }}>
              📋 Copy link
            </button>
          </div>
          <div style={{ fontSize: 10, color: '#2d6b2d', ...MONO, wordBreak: 'break-all' }}>
            {typeof window !== 'undefined' ? window.location.origin : ''}/p/{profile?.username || username}
          </div>
        </div>
      )}

      {/* Profile settings */}
      <div style={{ background: C.bg2, border: '1px solid ' + C.border, borderRadius: 12, padding: '16px', marginBottom: 16 }}>
        <div style={{ fontSize: 10, color: C.accent, letterSpacing: '0.2em', textTransform: 'uppercase', ...MONO, marginBottom: 12 }}>Profile settings</div>

        <label style={{ fontSize: 10, color: C.dim, ...MONO, letterSpacing: '0.15em', textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>
          Username (@)
        </label>
        <input value={username} onChange={e => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
          placeholder="e.g. metal_collector" style={{ ...inputSt, marginBottom: 12 }} />

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <button onClick={() => setIsPublic(p => !p)}
            style={{
              width: 44, height: 24, borderRadius: 12, border: 'none', cursor: 'pointer',
              background: isPublic ? C.accent : C.bg3, position: 'relative', transition: 'background 0.2s',
            }}>
            <span style={{
              position: 'absolute', top: 2, width: 20, height: 20, borderRadius: '50%',
              background: '#fff', transition: 'left 0.2s',
              left: isPublic ? 'calc(100% - 22px)' : '2px',
            }} />
          </button>
          <span style={{ fontSize: 12, color: C.muted, ...MONO }}>
            Public profile {username ? `(metal-vault.app/p/${username})` : ''}
          </span>
        </div>

        {username && isPublic && (
          <div style={{ background: '#001a00', border: '1px solid #166534', borderRadius: 6, padding: '8px 12px', marginBottom: 12, fontSize: 10, color: '#4ade80', ...MONO }}>
            🌐 {process.env.NEXT_PUBLIC_APP_URL || 'https://your-app.vercel.app'}/p/{username}
          </div>
        )}

        <button onClick={saveProfile} disabled={saving}
          style={{
            width: '100%', padding: '11px',
            background: 'linear-gradient(135deg,' + C.accent + ',' + C.accent2 + ')',
            border: 'none', borderRadius: 8, color: '#fff', cursor: 'pointer',
            ...BEBAS, fontSize: 16, letterSpacing: '0.08em',
          }}>
          {saving ? 'SAVING…' : 'SAVE PROFILE'}
        </button>
        {msg && <div style={{ fontSize: 11, color: msg.startsWith('✓') ? '#4ade80' : '#f87171', ...MONO, marginTop: 8, textAlign: 'center' }}>{msg}</div>}
      </div>

      {/* Followed artists */}
      {followedArtists.length > 0 && (
        <div style={{ background: C.bg2, border: '1px solid ' + C.border, borderRadius: 12, padding: '16px', marginBottom: 16 }}>
          <div style={{ fontSize: 10, color: C.accent, letterSpacing: '0.2em', textTransform: 'uppercase', ...MONO, marginBottom: 10 }}>
            Followed artists ({followedArtists.length})
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {followedArtists.map(a => (
              <span key={a.id} style={{ fontSize: 11, padding: '5px 10px', borderRadius: 20, background: C.bg3, color: C.muted, border: '1px solid ' + C.border, ...MONO }}>
                {a.artist_name} 🔔
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Push notifications */}
      <div style={{ background: C.bg2, border: '1px solid ' + C.border, borderRadius: 12, padding: '16px', marginBottom: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 10, color: C.accent, letterSpacing: '0.2em', textTransform: 'uppercase', ...MONO, marginBottom: 4 }}>Push Notifications</div>
            <div style={{ fontSize: 11, color: C.dim, ...MONO }}>Price alerts on your phone</div>
          </div>
          <button onClick={onTogglePush} disabled={pushLoading}
            style={{
              width: 52, height: 28, borderRadius: 14, border: 'none', cursor: 'pointer', flexShrink: 0,
              background: pushEnabled ? C.accent : '#333', position: 'relative',
              transition: 'background 0.2s', opacity: pushLoading ? 0.6 : 1,
            }}>
            <span style={{
              position: 'absolute', top: 3, width: 22, height: 22, borderRadius: '50%',
              background: '#fff', transition: 'left 0.2s',
              left: pushEnabled ? 'calc(100% - 25px)' : '3px',
            }} />
          </button>
        </div>
        {pushEnabled && <div style={{ fontSize: 10, color: '#4ade80', ...MONO, marginTop: 6 }}>✓ Enabled — you will receive price alerts</div>}
      </div>

      {/* Discogs OAuth */}
      <div style={{ background: C.bg2, border: '1px solid ' + C.border, borderRadius: 12, padding: '16px', marginBottom: 12 }}>
        <div style={{ fontSize: 10, color: C.accent, letterSpacing: '0.2em', textTransform: 'uppercase', ...MONO, marginBottom: 8 }}>Discogs Account</div>
        {discogsConnected ? (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <div style={{ fontSize: 12, color: '#4ade80', ...MONO }}>✓ Discogs connected</div>
              <button onClick={onSyncDiscogs} disabled={syncStatus === 'syncing'}
                style={{
                  padding: '6px 14px',
                  background: syncStatus === 'syncing' ? C.bg3 : '#0d1f0d',
                  border: '1px solid ' + (syncStatus === 'syncing' ? C.border : '#1a3d1a'),
                  borderRadius: 6,
                  color: syncStatus === 'syncing' ? C.dim : '#4ade80',
                  cursor: syncStatus === 'syncing' ? 'default' : 'pointer',
                  ...MONO, fontSize: 11,
                }}>
                {syncStatus === 'syncing' ? '⏳ Syncing…' : '↺ Sync collection'}
              </button>
            </div>
            {syncStatus === 'done' && syncResult && (
              <div style={{
                fontSize: 10, color: '#4ade80', ...MONO, lineHeight: 1.7,
                background: '#0d1f0d', border: '1px solid #1a3d1a', borderRadius: 6, padding: '8px 10px',
              }}>
                ✓ Added {syncResult.added ?? 0} new · Updated {syncResult.updated ?? 0} · Watchlist +{syncResult.watchAdded ?? 0}
              </div>
            )}
            {(syncStatus === 'error' || syncResult?._error) && (
              <div style={{ fontSize: 10, color: '#f87171', ...MONO, lineHeight: 1.5 }}>
                ⚠️ {syncResult?._error || 'Sync failed — try again'}
              </div>
            )}
          </div>
        ) : (
          <div>
            <div style={{ fontSize: 11, color: C.dim, ...MONO, lineHeight: 1.7, marginBottom: 10 }}>
              Connect your Discogs account to automatically sync your collection and wantlist.
              Works for all users — each person authorizes their own account.
            </div>
            <button onClick={onConnectDiscogs}
              style={{
                width: '100%', padding: '12px',
                background: 'linear-gradient(135deg,#1a1a00,#2a2800)',
                border: '1px solid #f5c842', borderRadius: 8, color: '#f5c842',
                cursor: 'pointer', ...BEBAS, fontSize: 16, letterSpacing: '0.06em',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              }}>
              🔗 Connect Discogs Account
            </button>
            <div style={{ fontSize: 9, color: C.dim, ...MONO, marginTop: 8, lineHeight: 1.6, textAlign: 'center' }}>
              Redirects to discogs.com → authorize → returns here → syncs automatically
            </div>
          </div>
        )}
      </div>

      {/* Import */}
      <div style={{ background: C.bg2, border: '1px solid ' + C.border, borderRadius: 12, padding: '16px', marginBottom: 12 }}>
        <div style={{ fontSize: 10, color: C.accent, letterSpacing: '0.2em', textTransform: 'uppercase', ...MONO, marginBottom: 8 }}>Import from Discogs</div>
        <button onClick={onShowImport}
          style={{
            width: '100%', padding: '10px',
            background: C.accent + '22', border: '1px solid ' + C.accent + '44',
            borderRadius: 8, color: C.accent, cursor: 'pointer', ...MONO, fontSize: 12,
          }}>
          ⬇ Open Discogs Import
        </button>
      </div>

      {/* Export */}
      <div style={{ background: C.bg2, border: '1px solid ' + C.border, borderRadius: 12, padding: '16px', marginBottom: 12 }}>
        <div style={{ fontSize: 10, color: C.accent, letterSpacing: '0.2em', textTransform: 'uppercase', ...MONO, marginBottom: 8 }}>Export Collection</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <a href="/api/collection/export?format=csv" download
            style={{ flex: 1, padding: '9px', background: C.bg3, border: '1px solid ' + C.border, borderRadius: 7, color: C.muted, textDecoration: 'none', textAlign: 'center', fontSize: 11, ...MONO }}>
            📊 CSV / Excel
          </a>
          <a href="/api/collection/export?format=json" download
            style={{ flex: 1, padding: '9px', background: C.bg3, border: '1px solid ' + C.border, borderRadius: 7, color: C.muted, textDecoration: 'none', textAlign: 'center', fontSize: 11, ...MONO }}>
            {'{ }'} JSON
          </a>
        </div>
      </div>

      {/* Share */}
      <div style={{ background: C.bg2, border: '1px solid ' + C.border, borderRadius: 12, padding: '16px', marginBottom: 12 }}>
        <div style={{ fontSize: 10, color: C.accent, letterSpacing: '0.2em', textTransform: 'uppercase', ...MONO, marginBottom: 8 }}>Share Collection</div>
        {shareToken ? (
          <div>
            <div style={{ fontSize: 10, color: '#60a5fa', ...MONO, wordBreak: 'break-all', marginBottom: 8, lineHeight: 1.5 }}>
              {typeof window !== 'undefined' ? window.location.origin : ''}/share/{shareToken}
            </div>
            <button onClick={() => navigator.clipboard?.writeText((typeof window !== 'undefined' ? window.location.origin : '') + '/share/' + shareToken).then(() => alert('Copied!'))}
              style={{ width: '100%', padding: '8px', background: C.bg3, border: '1px solid ' + C.border, borderRadius: 7, color: C.muted, cursor: 'pointer', fontSize: 11, ...MONO }}>
              📋 Copy share link
            </button>
          </div>
        ) : (
          <button onClick={onGetShareToken}
            style={{ width: '100%', padding: '10px', background: C.bg3, border: '1px solid ' + C.border, borderRadius: 8, color: C.muted, cursor: 'pointer', ...MONO, fontSize: 12 }}>
            🔗 Generate share link
          </button>
        )}
      </div>

      {/* Sign out */}
      <button onClick={onSignOut}
        style={{
          width: '100%', padding: '12px',
          background: 'none', border: '1px solid ' + C.border,
          borderRadius: 10, color: C.dim, cursor: 'pointer', ...MONO, fontSize: 12,
        }}>
        Sign out
      </button>
    </div>
  );
}
