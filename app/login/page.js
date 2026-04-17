'use client';
export const dynamic = 'force-dynamic';
import { useState, useRef } from 'react';
import { createClient } from '@/lib/supabase';

const C = {
  bg: '#0a0a0a', bg2: '#141414', bg3: '#1e1e1e',
  border: '#2a2a2a', accent: '#dc2626',
  text: '#f0f0f0', muted: '#888', dim: '#555',
};
const MONO  = { fontFamily: "'Space Mono', monospace" };
const BEBAS = { fontFamily: "'Bebas Neue', sans-serif" };

export default function LoginPage() {
  const [email,   setEmail]   = useState('');
  const [loading, setLoading] = useState(false);
  const [sent,    setSent]    = useState(false);
  const [error,   setError]   = useState('');
  const supabase = useRef(createClient()).current;

  const signInWithGoogle = async () => {
    setLoading(true); setError('');
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/auth/callback` },
    });
    if (error) { setError(error.message); setLoading(false); }
  };

  const signInWithEmail = async () => {
    if (!email.trim()) { setError('Enter your email address'); return; }
    setLoading(true); setError('');
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/auth/callback` },
    });
    if (error) { setError(error.message); setLoading(false); return; }
    setSent(true); setLoading(false);
  };

  return (
    <div style={{
      minHeight: '100vh', background: C.bg, display: 'flex',
      flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24,
    }}>
      <div style={{ width: '100%', maxWidth: 360 }}>
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <div style={{ ...BEBAS, fontSize: 42, letterSpacing: '0.1em', color: C.text, lineHeight: 1 }}>
            METAL VAULT
          </div>
          <div style={{ fontSize: 11, color: C.accent, ...MONO, letterSpacing: '0.25em', marginTop: 4 }}>
            VINYL COLLECTOR TOOL
          </div>
        </div>

        {sent ? (
          /* Magic link sent */
          <div style={{
            background: '#001a00', border: '1px solid #166534',
            borderRadius: 12, padding: 24, textAlign: 'center',
          }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>📬</div>
            <div style={{ ...BEBAS, fontSize: 22, color: '#4ade80', marginBottom: 8 }}>
              Check your email
            </div>
            <div style={{ fontSize: 12, color: '#6ee7b7', ...MONO, lineHeight: 1.6 }}>
              We sent a login link to<br />
              <strong>{email}</strong>
            </div>
            <button onClick={() => { setSent(false); setEmail(''); }}
              style={{ marginTop: 20, background: 'none', border: 'none', color: C.dim, cursor: 'pointer', fontSize: 11, ...MONO }}>
              Back
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {/* Google */}
            <button onClick={signInWithGoogle} disabled={loading}
              style={{
                width: '100%', padding: '14px', borderRadius: 10,
                background: '#fff', border: 'none', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
                fontSize: 14, fontWeight: 500, color: '#1a1a1a',
                opacity: loading ? 0.7 : 1,
              }}>
              <svg width="18" height="18" viewBox="0 0 18 18">
                <path fill="#4285F4" d="M16.51 8H8.98v3h4.3c-.18 1-.74 1.48-1.6 2.04v2.01h2.6a7.8 7.8 0 0 0 2.38-5.88c0-.57-.05-.66-.15-1.18z"/>
                <path fill="#34A853" d="M8.98 17c2.16 0 3.97-.72 5.3-1.94l-2.6-2a4.8 4.8 0 0 1-7.18-2.54H1.83v2.07A8 8 0 0 0 8.98 17z"/>
                <path fill="#FBBC05" d="M4.5 10.52a4.8 4.8 0 0 1 0-3.04V5.41H1.83a8 8 0 0 0 0 7.18l2.67-2.07z"/>
                <path fill="#EA4335" d="M8.98 4.18c1.17 0 2.23.4 3.06 1.2l2.3-2.3A8 8 0 0 0 1.83 5.4L4.5 7.49a4.77 4.77 0 0 1 4.48-3.3z"/>
              </svg>
              Sign in with Google
            </button>

            {/* Divider */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ flex: 1, height: 1, background: C.border }} />
              <span style={{ fontSize: 10, color: C.dim, ...MONO }}>LUB</span>
              <div style={{ flex: 1, height: 1, background: C.border }} />
            </div>

            {/* Email magic link */}
            <input
              type="email" value={email} onChange={e => setEmail(e.target.value)}
              placeholder="twoj@email.com"
              onKeyDown={e => e.key === 'Enter' && signInWithEmail()}
              style={{
                width: '100%', background: C.bg3, border: `1px solid ${C.border}`,
                borderRadius: 8, color: C.text, padding: '13px 14px', fontSize: 16,
                ...MONO, outline: 'none',
              }}
            />
            <button onClick={signInWithEmail} disabled={loading}
              style={{
                width: '100%', padding: '14px',
                background: `linear-gradient(135deg, ${C.accent}, #991b1b)`,
                border: 'none', borderRadius: 10, color: '#fff', cursor: 'pointer',
                ...BEBAS, fontSize: 18, letterSpacing: '0.1em',
                opacity: loading ? 0.7 : 1,
              }}>
              {loading ? 'SENDING…' : 'SEND LOGIN LINK'}
            </button>

            {error && (
              <div style={{ fontSize: 11, color: '#f87171', ...MONO, textAlign: 'center' }}>
                ⚠ {error}
              </div>
            )}

            <div style={{ fontSize: 10, color: C.dim, ...MONO, textAlign: 'center', lineHeight: 1.6, marginTop: 8 }}>
              No password — just click the link in your email.<br />
              By signing in you accept the terms of use.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
