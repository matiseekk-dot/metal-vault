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
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="Metal Vault" />
      </head>
      <body>
        {children}
        <ToastProvider />
        <script dangerouslySetInnerHTML={{
          __html: `
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
                  // Check for SW updates every time app loads
                  reg.update();

                  // When a new SW is waiting, activate it immediately
                  reg.addEventListener('updatefound', () => {
                    const newWorker = reg.installing;
                    newWorker.addEventListener('statechange', () => {
                      if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                        // New version available — tell SW to skip waiting
                        newWorker.postMessage({ type: 'SKIP_WAITING' });
                      }
                    });
                  });
                }).catch(() => {});

                // When SW controller changes (new SW took over), reload the page
                let refreshing = false;
                navigator.serviceWorker.addEventListener('controllerchange', () => {
                  if (!refreshing) {
                    refreshing = true;
                    window.location.reload();
                  }
                });

                // Also listen for SW_UPDATED message
                navigator.serviceWorker.addEventListener('message', e => {
                  if (e.data?.type === 'SW_UPDATED' && !refreshing) {
                    refreshing = true;
                    window.location.reload();
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
