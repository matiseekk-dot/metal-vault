'use client';
// ── LastfmSyncCard — connect Last.fm + auto-import listens ─────
//
// Mirrors SpotifySyncCard. Same three states (loading / connected /
// disconnected). Last.fm has a dramatically wider service surface —
// any scrobbler app for Apple Music / Tidal / YouTube Music / Plex
// / iTunes ends up writing to the same Last.fm profile, so one auth
// covers users we can't reach with Spotify.

import { useEffect, useState } from 'react';
import { C, MONO, BEBAS } from '@/lib/theme';
import { useT } from '@/lib/i18n';
import { toast, confirm as mvConfirm } from '@/app/components/Toast';
import { haptic } from '@/lib/haptics';

export default function LastfmSyncCard() {
  const t = useT();
  const [state, setState] = useState({ loading: true, connected: false });
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    try {
      const r = await fetch('/api/lastfm/sync');
      const d = await r.json();
      setState({ loading: false, ...d });
    } catch {
      setState({ loading: false, connected: false });
    }
  };

  useEffect(() => {
    refresh();
    if (typeof window === 'undefined') return;
    const p = new URLSearchParams(window.location.search);
    if (p.get('lastfm_connected') === '1') {
      toast.success(t('lastfm.justConnected') || '✓ Last.fm connected');
      const url = new URL(window.location.href);
      url.searchParams.delete('lastfm_connected');
      url.searchParams.delete('tab');
      window.history.replaceState({}, '', url.pathname + (url.search || ''));
    }
    const err = p.get('lastfm_error');
    if (err) {
      toast.error((t('lastfm.errorPrefix') || 'Last.fm error: ') + err);
      const url = new URL(window.location.href);
      url.searchParams.delete('lastfm_error');
      window.history.replaceState({}, '', url.pathname + (url.search || ''));
    }
  }, []); // eslint-disable-line

  const connect = async () => {
    setBusy(true);
    try {
      const r = await fetch('/api/lastfm/oauth');
      const d = await r.json();
      if (d.authorizeUrl) {
        window.location.href = d.authorizeUrl;
        return;
      }
      toast.error(d.error || (t('lastfm.connectFailed') || 'Could not start Last.fm auth'));
    } catch (e) {
      toast.error(e.message);
    }
    setBusy(false);
  };

  const sync = async () => {
    setBusy(true);
    try {
      const r = await fetch('/api/lastfm/sync', { method: 'POST' });
      const d = await r.json();
      if (!r.ok) {
        toast.error(d.error || (t('lastfm.syncFailed') || 'Sync failed'));
      } else {
        haptic.success();
        const matched = d.matched ?? 0;
        if (matched === 0) {
          toast(t('lastfm.syncNone') || 'No new matches yet — keep scrobbling!');
        } else {
          toast.success(
            (t('lastfm.syncMatched', { n: matched }) || (matched + ' new plays logged ✓'))
          );
          window.dispatchEvent(new CustomEvent('mv-watchlist-changed'));
        }
        await refresh();
      }
    } catch (e) {
      toast.error(e.message);
    }
    setBusy(false);
  };

  const disconnect = async () => {
    const ok = await mvConfirm(t('lastfm.disconnectConfirm') || 'Disconnect Last.fm? Your listen logs stay; only auto-sync stops.', {
      confirmLabel: t('common.remove') || 'Disconnect',
    });
    if (!ok) return;
    setBusy(true);
    try {
      const r = await fetch('/api/lastfm/sync', { method: 'DELETE' });
      const d = await r.json();
      if (!r.ok) toast.error(d.error || 'Disconnect failed');
      else {
        toast.success(t('lastfm.disconnected') || 'Last.fm disconnected');
        await refresh();
      }
    } catch (e) { toast.error(e.message); }
    setBusy(false);
  };

  if (state.loading) return null;

  return (
    <div style={{ marginTop: 12, padding: 14, border: '1px solid ' + C.border, borderRadius: 10, background: C.bg2 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        {/* Last.fm red square emoji-ish glyph */}
        <div style={{ fontSize: 18 }}>📻</div>
        <div style={{ flex: 1 }}>
          <div style={{ ...BEBAS, fontSize: 16, color: C.text, letterSpacing: '0.06em' }}>
            {t('lastfm.heading') || 'LAST.FM AUTO-LISTEN'}
          </div>
          <div style={{ fontSize: 10, color: C.dim, ...MONO, marginTop: 2 }}>
            {state.connected
              ? (t('lastfm.connectedAs') || 'Connected as') + ' ' + (state.username || 'unknown')
              : (t('lastfm.pitch') || 'Bridges Apple Music / Tidal / YT Music via scrobblers')}
          </div>
        </div>
      </div>

      {!state.connected && (
        <button onClick={connect} disabled={busy}
          style={{
            width: '100%', padding: '12px',
            background: '#d51007', border: 'none', borderRadius: 10,
            color: '#fff', cursor: busy ? 'wait' : 'pointer',
            ...BEBAS, fontSize: 16, letterSpacing: '0.06em',
            opacity: busy ? 0.6 : 1,
          }}>
          {busy ? '⏳' : (t('lastfm.connect') || 'CONNECT LAST.FM')}
        </button>
      )}

      {state.connected && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <button onClick={sync} disabled={busy}
            style={{
              width: '100%', padding: '12px',
              background: '#d51007', border: 'none', borderRadius: 10,
              color: '#fff', cursor: busy ? 'wait' : 'pointer',
              ...BEBAS, fontSize: 16, letterSpacing: '0.06em',
              opacity: busy ? 0.6 : 1,
            }}>
            {busy ? '⏳' : '↻ ' + (t('lastfm.syncNow') || 'SYNC NOW')}
          </button>
          <div style={{ fontSize: 9, color: C.dim, ...MONO, textAlign: 'center', lineHeight: 1.5 }}>
            {state.lastSyncedAt
              ? (t('lastfm.lastSync') || 'Last synced') + ': ' + new Date(state.lastSyncedAt).toLocaleString()
              : (t('lastfm.notSyncedYet') || 'Not synced yet — tap above')}
          </div>
          <button onClick={disconnect} disabled={busy}
            style={{
              padding: '8px',
              background: 'transparent', border: '1px solid ' + C.border, borderRadius: 8,
              color: C.dim, cursor: busy ? 'wait' : 'pointer',
              ...MONO, fontSize: 10,
            }}>
            {t('lastfm.disconnect') || 'Disconnect'}
          </button>
        </div>
      )}
    </div>
  );
}
