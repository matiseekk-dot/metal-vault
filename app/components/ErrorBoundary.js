// ── Error Boundary — catches React errors in subtree so one broken
//    component doesn't crash the whole app. Critical for Persona / Stats / Insurance
//    which depend on external data and could throw on malformed input.
'use client';
import React from 'react';
import { C, MONO, BEBAS } from '@/lib/theme';
import { t } from '@/lib/i18n';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null, showDetails: false };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    // Log to console; Sentry will auto-capture if configured
    console.error('[ErrorBoundary]', this.props.name || 'unknown', error, errorInfo);
    if (typeof window !== 'undefined' && window.Sentry) {
      try { window.Sentry.captureException(error, { contexts: { react: errorInfo } }); } catch {}
    }
    // Stash both so the fallback UI can offer a "show details" view —
    // operators (and Claude!) need the actual stack to diagnose, the
    // generic "something broke" message wasted hours of round-trips.
    this.setState({ errorInfo });
  }

  copyDetails = () => {
    const { error, errorInfo } = this.state;
    const blob = [
      'Tab: ' + (this.props.name || 'unknown'),
      'When: ' + new Date().toISOString(),
      'UA: ' + (typeof navigator !== 'undefined' ? navigator.userAgent : 'n/a'),
      'URL: ' + (typeof location !== 'undefined' ? location.href : 'n/a'),
      '',
      'Message: ' + (error?.message || String(error)),
      '',
      'Stack:',
      error?.stack || '(no stack)',
      '',
      'Component stack:',
      errorInfo?.componentStack || '(none)',
    ].join('\n');
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(blob).catch(() => {});
    }
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    const name  = this.props.name || 'Component';
    const error = this.state.error;
    const info  = this.state.errorInfo;
    const msg   = error?.message || String(error);

    return (
      <div style={{
        background: '#1a0505', border: '1px solid #7f1d1d', borderRadius: 12,
        padding: 20, margin: '12px 16px', textAlign: 'center',
      }}>
        <div style={{ fontSize: 32, marginBottom: 8 }}>⚠️</div>
        <div style={{ ...BEBAS, fontSize: 18, color: '#f87171', letterSpacing: '0.04em', marginBottom: 6 }}>
          {t('errorBoundary.title', { tab: name })}
        </div>
        <div style={{ fontSize: 11, color: C.dim, ...MONO, marginBottom: 12 }}>
          {t('errorBoundary.desc')}
        </div>

        {/* Diagnostic block — visible to operator, copy-to-clipboard
            button so the user can paste the real error back to support. */}
        {msg && (
          <div style={{
            background: '#0a0a0a', border: '1px solid #3a1010', borderRadius: 8,
            padding: '8px 10px', marginBottom: 12, textAlign: 'left',
            fontSize: 10, color: '#f87171', ...MONO, lineHeight: 1.5,
            maxHeight: this.state.showDetails ? 280 : 60, overflow: 'auto',
            wordBreak: 'break-word',
          }}>
            {msg}
            {this.state.showDetails && error?.stack && (
              <pre style={{
                margin: '8px 0 0', fontSize: 9, color: C.dim,
                whiteSpace: 'pre-wrap', wordBreak: 'break-word',
              }}>{error.stack}</pre>
            )}
            {this.state.showDetails && info?.componentStack && (
              <pre style={{
                margin: '8px 0 0', fontSize: 9, color: C.dim,
                whiteSpace: 'pre-wrap', wordBreak: 'break-word',
              }}>{info.componentStack}</pre>
            )}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
          <button onClick={() => this.setState({ hasError: false, error: null, errorInfo: null, showDetails: false })}
            style={{ background: 'none', border: '1px solid ' + C.border, borderRadius: 8,
              color: C.text, padding: '8px 18px', cursor: 'pointer', ...MONO, fontSize: 11 }}>
            {t('common.retry')}
          </button>
          <button onClick={() => this.setState(s => ({ showDetails: !s.showDetails }))}
            style={{ background: 'none', border: '1px solid ' + C.border, borderRadius: 8,
              color: C.dim, padding: '8px 14px', cursor: 'pointer', ...MONO, fontSize: 10 }}>
            {this.state.showDetails ? '▲ details' : '▼ details'}
          </button>
          <button onClick={this.copyDetails}
            style={{ background: 'none', border: '1px solid ' + C.border, borderRadius: 8,
              color: C.dim, padding: '8px 14px', cursor: 'pointer', ...MONO, fontSize: 10 }}>
            ⎘ copy
          </button>
        </div>
      </div>
    );
  }
}
