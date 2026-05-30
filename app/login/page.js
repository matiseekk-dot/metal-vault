'use client';
import { useState, useRef, useEffect } from 'react';
import { createClient } from '@/lib/supabase';
import { useT, t as plainT } from '@/lib/i18n';


export const dynamic = 'force-dynamic';

const C = {
  bg: '#0a0a0a', bg2: '#141414', bg3: '#1e1e1e',
  border: '#2a2a2a', accent: '#dc2626',
  text: '#f0f0f0', muted: '#888', dim: '#555',
};
const MONO  = { fontFamily: "var(--font-space-mono), monospace" };
const BEBAS = { fontFamily: "var(--font-bebas-neue), sans-serif" };

const RESEND_COOLDOWN_S = 30;

// Map common Supabase / network errors to copy a non-technical user can act on.
// Falls back to the original message for anything we don't recognize, so we
// don't silently hide a meaningful error. Reads via plainT() so it works
// from outside React (still picks up the active locale).
function friendlyError(message) {
  const m = String(message || '').toLowerCase();
  if (m.includes('rate limit') || m.includes('too many') || m.includes('429')) {
    return plainT('login.error.rateLimit');
  }
  if (m.includes('invalid email') || m.includes('email_address_invalid')) {
    return plainT('login.error.invalidEmail');
  }
  if (m.includes('signups not allowed') || m.includes('signup is disabled')) {
    return plainT('login.error.signupsClosed');
  }
  if (m.includes('failed to fetch') || m.includes('networkerror')) {
    return plainT('login.error.network');
  }
  if (m.includes('email link is invalid') || m.includes('expired')) {
    return plainT('login.error.expired');
  }
  return message || plainT('common.error');
}

export default function LoginPage() {
  const t = useT();
  const [email,    setEmail]    = useState('');
  const [loading,  setLoading]  = useState(false);
  const [sent,     setSent]     = useState(false);
  const [error,    setError]    = useState('');
  const [info,     setInfo]     = useState('');
  const [cooldown, setCooldown] = useState(0);
  // OTP-code fallback for cross-device login. Magic-link clicks rely on
  // PKCE which only works in the same browser that requested the email —
  // so a user requesting on PC and clicking the link on phone (or vice
  // versa) gets a "Sign-in failed" error. The 6-digit code from the email
  // body works regardless of device: paste it here, hit Verify.
  const [otpCode, setOtpCode]   = useState('');
  const [verifying, setVerifying] = useState(false);
  const supabase = useRef(createClient()).current;

  // Surface contextual banners coming from the redirect:
  //   ?deleted=1     — we just nuked the account from /api/profile/delete
  //   ?error=auth_failed — auth/callback returned without a session
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const p = new URLSearchParams(window.location.search);
    if (p.get('deleted') === '1') {
      setInfo(plainT('login.banner.deleted'));
    }
    if (p.get('error') === 'auth_failed') {
      setError(plainT('login.banner.authFailed'));
    }
  }, []);

  // Resend cooldown countdown — disables the button so we don't burn through
  // Supabase's per-email rate limit (default 60s) and trigger generic 429s.
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  // OAuth redirect target. NEXT_PUBLIC_APP_URL was sometimes UNDEFINED
  // at build time on Vercel (the env var slipped out of the project
  // config). That produced `redirectTo: 'undefined/auth/callback'`,
  // which Google rejected with a flash 400 page before the session
  // recovered via Supabase's fallback site URL. Fallback to
  // window.location.origin so the redirect target is always the same
  // host the user is already on — works identically in PWA and inside
  // the Capacitor WebView (server.url makes origin = the Vercel domain).
  const appOrigin = () => {
    if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL;
    if (typeof window !== 'undefined' && window.location?.origin) return window.location.origin;
    return 'https://metal-vault-six.vercel.app';
  };

  const signInWithGoogle = async () => {
    setLoading(true); setError('');

    // ── Capacitor: native Google Sign-In via Android SDK ──────────
    // Web OAuth flow was flashing a Google "400" error in the
    // WebView before recovering — looks broken to users, kills
    // installs. Native Google Sign-In bypasses the web redirect
    // entirely: the system Google account picker fires natively,
    // returns an idToken in-process, and we hand that to Supabase
    // via signInWithIdToken. No redirect URLs, no PKCE, no 400.
    const isCap = typeof window !== 'undefined'
      && window.Capacitor
      && window.Capacitor.isNativePlatform?.();
    if (isCap) {
      try {
        const { GoogleAuth } = await import('@codetrix-studio/capacitor-google-auth');
        // Initialize on first use. clientId is the Web client ID
        // from Google Cloud Console (same one Supabase uses for
        // its Google provider). The Android OAuth client is
        // matched automatically by package name + SHA-1, no
        // separate ID needed in the client code.
        const webClientId = process.env.NEXT_PUBLIC_GOOGLE_WEB_CLIENT_ID;
        if (!webClientId) {
          setError('Google Sign-In is not configured (missing client id).');
          setLoading(false);
          return;
        }
        try {
          await GoogleAuth.initialize({
            clientId: webClientId,
            scopes: ['email', 'profile', 'openid'],
            grantOfflineAccess: false,
          });
        } catch { /* second init is a no-op */ }

        const user = await GoogleAuth.signIn();
        const idToken = user?.authentication?.idToken;
        if (!idToken) {
          setError('Google did not return an idToken.');
          setLoading(false);
          return;
        }

        const { error: sErr } = await supabase.auth.signInWithIdToken({
          provider: 'google',
          token: idToken,
        });
        if (sErr) {
          setError(friendlyError(sErr.message));
          setLoading(false);
          return;
        }
        // Success — auth state listener in the parent will push
        // the user past the login page.
      } catch (e) {
        // User cancellation throws — present a benign message rather
        // than the raw error.
        if (/cancel|abort/i.test(e?.message || '')) {
          setLoading(false);
          return;
        }
        setError(friendlyError(e?.message || 'Google sign-in failed'));
        setLoading(false);
      }
      return;
    }

    // ── Web (PWA / browser): standard Supabase OAuth redirect ─────
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${appOrigin()}/auth/callback` },
    });
    if (error) {
      setError(friendlyError(error.message));
      setLoading(false);
    }
  };

  const signInWithEmail = async () => {
    if (!email.trim()) { setError(plainT('login.error.empty')); return; }
    setLoading(true); setError(''); setInfo('');
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: `${appOrigin()}/auth/callback` },
    });
    if (error) {
      setError(friendlyError(error.message));
      setLoading(false);
      return;
    }
    setSent(true); setLoading(false); setCooldown(RESEND_COOLDOWN_S);
  };

  const resend = async () => {
    if (cooldown > 0) return;
    await signInWithEmail();
  };

  // Cross-device OTP verification. User pasted the 6-digit code from the
  // email body — we exchange it for a session via Supabase's verifyOtp
  // (type 'email' covers both magic-link OTP and email-confirmation OTP).
  // Same end result as clicking the link, but no PKCE dependency on
  // browser-of-origin.
  const verifyCode = async () => {
    const token = otpCode.trim().replace(/\s+/g, '');
    if (!/^\d{6}$/.test(token)) {
      setError(plainT('login.error.codeFormat') || 'Wpisz 6-cyfrowy kod z maila');
      return;
    }
    setVerifying(true); setError('');
    const { error } = await supabase.auth.verifyOtp({
      email: email.trim(),
      token,
      type: 'email',
    });
    if (error) {
      setVerifying(false);
      setError(friendlyError(error.message));
      return;
    }
    // Session is now set in cookies. Redirect to app root.
    window.location.href = '/';
  };

  return (
    <div style={{
      minHeight: '100vh', background: C.bg, display: 'flex',
      flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24,
    }}>
      <div style={{ width: '100%', maxWidth: 360 }}>
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ ...BEBAS, fontSize: 42, letterSpacing: '0.1em', color: C.text, lineHeight: 1 }}>
            METAL VAULT
          </div>
          <div style={{ fontSize: 11, color: C.accent, ...MONO, letterSpacing: '0.25em', marginTop: 4 }}>
            {t('login.subtitle')}
          </div>
        </div>

        {/* Contextual info banner (account deleted, etc.) */}
        {info && (
          <div style={{
            background: '#001a05', border: '1px solid #14532d',
            borderRadius: 10, padding: '10px 14px', marginBottom: 14,
            fontSize: 12, color: '#86efac', ...MONO, lineHeight: 1.5,
          }}>
            {info}
          </div>
        )}

        {/* Email magic-link path disabled for launch — Resend domain
            verification was the blocker (sandbox can only send to the
            Resend account owner email). Google sign-in covers >95% of
            sign-ups on a metal-collector niche audience anyway; we
            can re-enable email later by reverting this commit and
            wiring SMTP through a verified domain. The `sent`/`email`
            state + signInWithEmail/verifyCode handlers stay defined
            but unreachable — keeps the file diff-small for a quick
            revert. */}
        {false && sent ? (
          /* Magic link sent */
          <div style={{
            background: '#001a00', border: '1px solid #166534',
            borderRadius: 12, padding: 24, textAlign: 'center',
          }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>📬</div>
            <div style={{ ...BEBAS, fontSize: 22, color: '#4ade80', marginBottom: 8 }}>
              {t('login.checkEmail')}
            </div>
            <div style={{ fontSize: 12, color: '#6ee7b7', ...MONO, lineHeight: 1.6 }}>
              {t('login.checkEmailDesc')}<br />
              <strong>{email}</strong>
            </div>
            <div style={{ fontSize: 10, color: '#86efac', ...MONO, marginTop: 14, lineHeight: 1.6 }}>
              {t('login.checkEmailTip')}
            </div>

            {/* OTP code fallback — paste the 6-digit code from the email.
                Useful when the magic link was opened on a different
                device than where the email was requested (PKCE fails in
                that case). The code works regardless of which browser
                you're in. */}
            <div style={{
              marginTop: 18, padding: 14,
              background: 'rgba(0,0,0,0.3)', border: '1px solid ' + C.border,
              borderRadius: 8,
            }}>
              <div style={{ fontSize: 10, color: C.dim, ...MONO, marginBottom: 8,
                letterSpacing: '0.06em' }}>
                {plainT('login.otpHint') || 'Albo wpisz 6-cyfrowy kod z maila:'}
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  autoComplete="one-time-code"
                  value={otpCode}
                  onChange={e => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  onKeyDown={e => e.key === 'Enter' && verifyCode()}
                  placeholder="123456"
                  style={{
                    flex: 1, background: C.bg3, border: '1px solid ' + C.border,
                    borderRadius: 6, color: C.text, padding: '10px 12px',
                    fontSize: 18, letterSpacing: '0.3em', textAlign: 'center',
                    ...MONO, outline: 'none',
                  }}
                />
                <button
                  onClick={verifyCode}
                  disabled={verifying || otpCode.length !== 6}
                  style={{
                    background: otpCode.length === 6 ? '#14532d' : C.bg3,
                    border: '1px solid ' + (otpCode.length === 6 ? '#166534' : C.border),
                    borderRadius: 6,
                    color: otpCode.length === 6 ? '#86efac' : C.dim,
                    padding: '10px 16px',
                    cursor: otpCode.length === 6 && !verifying ? 'pointer' : 'default',
                    ...BEBAS, fontSize: 14, letterSpacing: '0.06em',
                    opacity: verifying ? 0.6 : 1,
                  }}>
                  {verifying ? '…' : (plainT('login.otpVerify') || 'Zaloguj')}
                </button>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
              <button
                onClick={() => { setSent(false); setEmail(''); setError(''); setCooldown(0); }}
                style={{
                  flex: 1, background: 'none', border: '1px solid ' + C.border,
                  borderRadius: 8, color: C.dim, padding: '10px',
                  cursor: 'pointer', fontSize: 11, ...MONO,
                }}>
                {t('login.useDifferentEmail')}
              </button>
              <button
                onClick={resend}
                disabled={cooldown > 0 || loading}
                style={{
                  flex: 1,
                  background: cooldown > 0 ? C.bg3 : '#14532d',
                  border: cooldown > 0 ? '1px solid ' + C.border : '1px solid #166534',
                  borderRadius: 8,
                  color: cooldown > 0 ? C.dim : '#86efac',
                  padding: '10px',
                  cursor: cooldown > 0 || loading ? 'default' : 'pointer',
                  fontSize: 11, ...MONO,
                }}>
                {cooldown > 0 ? t('login.resendIn', { n: cooldown }) : t('login.resend')}
              </button>
            </div>

            {error && (
              <div style={{ fontSize: 11, color: '#fca5a5', ...MONO, marginTop: 12 }}>
                ⚠ {error}
              </div>
            )}
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
              {t('login.google')}
            </button>

            {/* Divider, email input + "Wyślij link" button removed for
                launch — email magic-link path needs a verified Resend
                domain which we'll wire post-launch. Google sign-in is
                the only path users see right now. */}

            {error && (
              <div style={{ fontSize: 11, color: '#f87171', ...MONO, textAlign: 'center', lineHeight: 1.5 }}>
                ⚠ {error}
              </div>
            )}

            <div style={{ fontSize: 10, color: C.dim, ...MONO, textAlign: 'center', lineHeight: 1.6, marginTop: 8 }}>
              {t('login.helper')}<br />
              {t('login.consent', {
                terms:   '__TERMS__',
                privacy: '__PRIVACY__',
              }).split(/(__TERMS__|__PRIVACY__)/).map((part, i) => {
                if (part === '__TERMS__') return (
                  <a key={i} href="/legal/terms.html" target="_blank" rel="noopener noreferrer"
                    style={{ color: C.muted, textDecoration: 'underline' }}>{t('login.terms')}</a>
                );
                if (part === '__PRIVACY__') return (
                  <a key={i} href="/legal/privacy.html" target="_blank" rel="noopener noreferrer"
                    style={{ color: C.muted, textDecoration: 'underline' }}>{t('login.privacy')}</a>
                );
                return part;
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
