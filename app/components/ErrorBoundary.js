// ── Error Boundary — catches React errors in subtree so one broken
//    component doesn't crash the whole app. Critical for Persona / Stats / Insurance
//    which depend on external data and could throw on malformed input.
'use client';
import React from 'react';
import { C, MONO, BEBAS } from '@/lib/theme';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
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
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    const name = this.props.name || 'Component';
    return (
      <div style={{
        background: '#1a0505', border: '1px solid #7f1d1d', borderRadius: 12,
        padding: 20, margin: '12px 16px', textAlign: 'center',
      }}>
        <div style={{ fontSize: 32, marginBottom: 8 }}>⚠️</div>
        <div style={{ ...BEBAS, fontSize: 18, color: '#f87171', letterSpacing: '0.04em', marginBottom: 6 }}>
          {name} failed to render
        </div>
        <div style={{ fontSize: 11, color: C.dim, ...MONO, marginBottom: 12 }}>
          The rest of the app is fine — only this section had an error.
        </div>
        <button onClick={() => this.setState({ hasError: false, error: null })}
          style={{ background: 'none', border: '1px solid ' + C.border, borderRadius: 8,
            color: C.text, padding: '8px 18px', cursor: 'pointer', ...MONO, fontSize: 11 }}>
          Try again
        </button>
      </div>
    );
  }
}
