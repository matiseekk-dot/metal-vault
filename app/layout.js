import './globals.css';
import ToastProvider from '@/app/components/Toast';
import { Bebas_Neue, Space_Mono } from 'next/font/google';

// Self-hosted via next/font — fonts ship with the build, no third-party
// preconnect, no FOUT. Inline `fontFamily: "var(--font-space-mono),..."`
// references throughout the app pick up the family name from these
// CSS variables, set on <html> below.
const bebasNeue = Bebas_Neue({
  subsets: ['latin'],
  weight: '400',
  display: 'swap',
  variable: '--font-bebas-neue',
});
const spaceMono = Space_Mono({
  subsets: ['latin'],
  weight: ['400', '700'],
  style: ['normal', 'italic'],
  display: 'swap',
  variable: '--font-space-mono',
});

export const metadata = {
  title: 'Metal Vault',
  description: 'Metal vinyl collector tool — track releases, variants and prices',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Metal Vault',
  },
  icons: {
    icon: '/icons/icon-192.png',
    apple: '/icons/icon-192.png',
  },
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  // Pinch-zoom intentionally allowed — locking it out hurts accessibility
  // and triggers a Lighthouse / WCAG warning that can flag Play Console
  // accessibility review.
  themeColor: '#0a0a0a',
};

export default function RootLayout({ children }) {
  return (
    // lang stays "en" at SSR (we don't know the user's choice until JS
    // loads localStorage). Client-side we patch <html lang> below to
    // match the active app locale so screen readers + Chrome translate
    // pick the right language.
    <html lang="en" className={`${bebasNeue.variable} ${spaceMono.variable}`}>
      <head>
        <link rel="manifest" href="/manifest.json" />
        <link rel="icon" href="/icons/icon-192.png" />
        <link rel="apple-touch-icon" href="/icons/icon-192.png" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="Metal Vault" />
        {/*
          iOS PWA startup image. Until per-device splash PNGs are
          generated (use https://appsco.pe/developer/splash-screens or
          a similar tool against the icon + #0a0a0a background), iOS
          falls back to a black background derived from theme_color.
          Adding the explicit reference improves splash continuity and
          stops iOS from briefly flashing white on first launch.
          To finish: drop /public/splash/ios-2048.png + add per-device
          <link rel="apple-touch-startup-image" media="..."> tags here.
        */}
        <link rel="apple-touch-startup-image" href="/icons/icon-512.png" />
        <meta name="theme-color" content="#0a0a0a" />
      </head>
      <body>
        {children}
        <ToastProvider />
        <script dangerouslySetInnerHTML={{
          __html: `
            // ── Capacitor-only viewport hardening ────────────────────
            // The PWA viewport meta intentionally allows pinch-zoom
            // (WCAG / Play Store accessibility). Inside the native
            // WebView wrapper the gesture was firing accidentally on
            // dense grids (Calendar tab) and triggering a permanent
            // zoom-out that pushed the bottom nav off-screen. Detect
            // we're inside Capacitor and patch the viewport at runtime
            // to block pinch-zoom — without touching the meta tag the
            // open-web PWA uses.
            (function lockViewportInApp() {
              try {
                var isCap = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
                if (!isCap) return;
                var v = document.querySelector('meta[name=viewport]');
                if (!v) {
                  v = document.createElement('meta');
                  v.setAttribute('name', 'viewport');
                  document.head.appendChild(v);
                }
                v.setAttribute('content', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover');
                // CSS-level lock — touch-action manipulation tells the
                // browser to only respond to taps + pan, no zoom gestures.
                // overflow-x:hidden defends against any layout child that
                // accidentally extends beyond viewport-width (Calendar
                // grid was leaking ~20px to the right on mid-density
                // phones, causing horizontal scroll + the visual "page
                // sliding to the side" QA reported).
                var s = document.createElement('style');
                // Minimum-viable lockdown. Earlier we also forced
                // body width:100vw + body>div overflow-x:hidden — that
                // killed vertical scrolling on some Android Chrome
                // WebView versions because the body's effective height
                // got clamped to viewport. Calendar root now owns its
                // own width constraint (in CalendarTab.js) so we only
                // need touch-action + horizontal overflow guard here.
                s.textContent = [
                  'html, body {',
                  '  touch-action: manipulation;',
                  '  -ms-touch-action: manipulation;',
                  '  overflow-x: hidden;',
                  '}',
                  // Universal box-sizing — pads fold into the declared
                  // width so 1fr grids don't quietly exceed viewport.
                  '*, *::before, *::after { box-sizing: border-box; }',
                ].join('\\n');
                document.head.appendChild(s);
                // Last-resort: swallow any pinch attempts that slip through
                // (some Android WebViews honor the meta tag inconsistently
                // depending on Chrome WebView version on the device).
                document.addEventListener('gesturestart', function(e) { e.preventDefault(); }, { passive: false });
                document.addEventListener('touchmove', function(e) {
                  if (e.touches && e.touches.length > 1) e.preventDefault();
                }, { passive: false });
                // Mark the body so CSS can target Capacitor-only tweaks.
                document.body.classList.add('mv-capacitor');
              } catch {}
            })();

            // Mirror the user's app-locale choice onto <html lang> so
            // accessibility tools and browser translate behave correctly.
            (function syncLang() {
              try {
                const apply = (l) => {
                  if (l && /^(en|pl|de)$/.test(l)) document.documentElement.lang = l;
                };
                apply(localStorage.getItem('mv_locale'));
                window.addEventListener('mv:locale-changed', e => apply(e.detail?.locale));
              } catch {}
            })();

            if ('serviceWorker' in navigator) {
              window.addEventListener('load', () => {
                navigator.serviceWorker.register('/sw.js').then(reg => {
                  // Check for SW updates immediately on load AND every
                  // 60 seconds while the tab stays open. The default
                  // browser behaviour only calls update() on navigation
                  // events; for a long-lived TWA / standalone PWA tab
                  // that means the user can run the app for hours on
                  // an old build. 60-second polling is cheap (Vercel
                  // returns 304 if /sw.js hasn't changed, no full
                  // re-download).
                  const tick = () => reg.update().catch(() => {});
                  tick();
                  setInterval(tick, 60_000);

                  // Also re-check the moment the tab regains focus —
                  // covers the "swiped app away, came back hours
                  // later" pattern that 60s polling alone misses for
                  // backgrounded TWA windows.
                  document.addEventListener('visibilitychange', () => {
                    if (document.visibilityState === 'visible') tick();
                  });

                  // When a new SW finishes installing, ask it to skip
                  // the "waiting" phase so the controllerchange fires
                  // immediately instead of on next navigation.
                  reg.addEventListener('updatefound', () => {
                    const newWorker = reg.installing;
                    if (!newWorker) return;
                    newWorker.addEventListener('statechange', () => {
                      if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                        newWorker.postMessage({ type: 'SKIP_WAITING' });
                      }
                    });
                  });
                }).catch(() => {});

                // When the active SW gets replaced, reload once. The
                // refreshing flag stops a feedback loop when both the
                // controllerchange event AND the SW_UPDATED postMessage
                // fire (they often do back-to-back).
                let refreshing = false;
                navigator.serviceWorker.addEventListener('controllerchange', () => {
                  if (!refreshing) { refreshing = true; window.location.reload(); }
                });
                navigator.serviceWorker.addEventListener('message', e => {
                  if (e.data?.type === 'SW_UPDATED' && !refreshing) {
                    refreshing = true; window.location.reload();
                  }
                });
              });
            }
          `
        }} />
      </body>
    </html>
  );
}
