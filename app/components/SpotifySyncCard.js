'use client';
// ── SpotifySyncCard — connect Spotify + auto-import listens ─────
//
// Renders inside ProfileTab. Three states:
//   1. Spotify not configured (env vars missing) → hidden entirely
//   2. Connected → "Sync now" button + last sync info + disconnect
//   3. Not connected → "Connect Spotify" button
//
// Auto-shows a success banner when the URL has `?spotify_connected=1`
// (set by /api/spotify/callback after successful OAuth).

import { useEffect, useState } from 'react';
import { C, MONO, BEBAS } from '@/lib/theme';
import { useT } from '@/lib/i18n';
import { toast, confirm as mvConfirm } from '@/app/components/Toast';
import { haptic } from '@/lib/haptics';
import Icon from '@/app/components/Icon';

export default function SpotifySyncCard() {
  const t = useT();
  const [state, setState] = useState({ loading: true, connected: false });
  const [busy, setBusy] = useState(false);

  // Refresh status from server. Called on mount + after sync/disconnect.
  const refresh = async () => {
    try {
      const r = await fetch('/api/spotify/sync');
      const d = await r.json();
      setState({ loading: false, ...d });
    } catch {
      setState({ loading: false, connected: false });
    }
  };

  useEffect(() => {
    refresh();
    // Surface OAuth result banners
    if (typeof window === 'undefined') return;
    const p = new URLSearchParams(window.location.search);
    if (p.get('spotify_connected') === '1') {
      toast.success(t('spotify.justConnected') || '✓ Spotify connected');
      const url = new URL(window.location.href);
      url.searchParams.delete('spotify_connected');
      url.searchParams.delete('tab');
      window.history.replaceState({}, '', url.pathname + (url.search || ''));
    }
    const err = p.get('spotify_error');
    if (err) {
      toast.error((t('spotify.errorPrefix') || 'Spotify error: ') + err);
      const url = new URL(window.location.href);
      url.searchParams.delete('spotify_error');
      window.history.replaceState({}, '', url.pathname + (url.search || ''));
    }
  }, []);  // eslint-disable-line

  const connect = async () => {
    setBusy(true);
    try {
      const r = await fetch('/api/spotify/oauth');
      const d = await r.json();
      if (d.authorizeUrl) {
        window.location.href = d.authorizeUrl;
        return;
      }
      toast.error(d.error || (t('spotify.connectFailed') || 'Could not start Spotify auth'));
    } catch (e) {
      toast.error(e.message);
    }
    setBusy(false);
  };

  const sync = async () => {
    setBusy(true);
    try {
      const r = await fetch('/api/spotify/sync', { method: 'POST' });
      const d = await r.json();
      if (!r.ok) {
        toast.error(d.error || (t('spotify.syncFailed') || 'Sync failed'));
      } else {
        haptic.success();
        const matched   = d.matched   ?? 0;
        const unmatched = d.unmatched ?? 0;
        if (matched === 0 && unmatched === 0) {
          toast(t('spotify.syncNone') || 'No new matches yet — keep listening!');
        } else {
          const parts = [];
          if (matched > 0)   parts.push(matched + ' vinyl');
          if (unmatched > 0) parts.push(unmatched + ' discovery');
          toast.success(parts.join(' · ') + ' ✓');
          window.dispatchEvent(new CustomEvent('mv-streaming-changed'));
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
    const ok = await mvConfirm(t('spotify.disconnectConfirm') || 'Disconnect Spotify? Your existing listen logs stay — only the auto-sync stops.', {
      confirmLabel: t('common.remove') || 'Disconnect',
    });
    if (!ok) return;
    setBusy(true);
    try {
      const r = await fetch('/api/spotify/sync', { method: 'DELETE' });
      const d = await r.json();
      if (!r.ok) toast.error(d.error || 'Disconnect failed');
      else {
        toast.success(t('spotify.disconnected') || 'Spotify disconnected');
        await refresh();
      }
    } catch (e) { toast.error(e.message); }
    setBusy(false);
  };

  if (state.loading) return null;

  return (
    <div style={{ marginTop: 16, padding: 14, border: '1px solid ' + C.border, borderRadius: 10, background: C.bg2 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <div style={{ fontSize: 18 }}>🟢</div>
        <div style={{ flex: 1 }}>
          <div style={{ ...BEBAS, fontSize: 16, color: C.text, letterSpacing: '0.06em' }}>
            {t('spotify.heading') || 'SPOTIFY AUTO-LISTEN'}
          </div>
          <div style={{ fontSize: 10, color: C.dim, ...MONO, marginTop: 2 }}>
            {state.connected
              ? (t('spotify.connectedAs') || 'Connected as') + ' ' + (state.displayName || state.spotifyId || 'unknown')
              : (t('spotify.pitch') || 'Auto-log plays from Spotify to your Vault')}
          </div>
        </div>
      </div>

      {!state.connected && (
        <button onClick={connect} disabled={busy}
          style={{
            width: '100%', padding: '12px',
            background: '#1db954', border: 'none', borderRadius: 10,
            color: '#000', cursor: busy ? 'wait' : 'pointer',
            ...BEBAS, fontSize: 16, letterSpacing: '0.06em',
            opacity: busy ? 0.6 : 1,
          }}>
          {busy ? '⏳' : (t('spotify.connect') || 'CONNECT SPOTIFY')}
        </button>
      )}

      {state.connected && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <button onClick={sync} disabled={busy}
            style={{
              width: '100%', padding: '12px',
              background: '#1db954', border: 'none', borderRadius: 10,
              color: '#000', cursor: busy ? 'wait' : 'pointer',
              ...BEBAS, fontSize: 16, letterSpacing: '0.06em',
              opacity: busy ? 0.6 : 1,
            }}>
            {busy ? '⏳' : '↻ ' + (t('spotify.syncNow') || 'SYNC NOW')}
          </button>
          <div style={{ fontSize: 9, color: C.dim, ...MONO, textAlign: 'center', lineHeight: 1.5 }}>
            {state.lastSyncedAt
              ? (t('spotify.lastSync') || 'Last synced') + ': ' + new Date(state.lastSyncedAt).toLocaleString()
              : (t('spotify.notSyncedYet') || 'Not synced yet — tap above')}
          </div>
          <button onClick={disconnect} disabled={busy}
            style={{
              padding: '8px',
              background: 'transparent', border: '1px solid ' + C.border, borderRadius: 8,
              color: C.dim, cursor: busy ? 'wait' : 'pointer',
              ...MONO, fontSize: 10,
            }}>
            {t('spotify.disconnect') || 'Disconnect'}
          </button>
        </div>
      )}
    </div>
  );
}
