import './globals.css';

export const metadata = {
  title: 'Metal Vault',
  description: 'Metal vinyl collector tool — track releases, variants and prices',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Metal Vault',
  },
  themeColor: '#0a0a0a',
  icons: {
    icon: '/icons/icon-192.png',
    apple: '/icons/icon-192.png',
  },
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: '#0a0a0a',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Space+Mono:ital,wght@0,400;0,700;1,400&display=swap" rel="stylesheet" />
        <link rel="manifest" href="/manifest.json" />
        <link rel="icon" href="/icons/icon-192.png" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="Metal Vault" />
      </head>
      <body>
        {children}
        <script dangerouslySetInnerHTML={{
          __html: `
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
