// Sentry browser error reporting.
// Only activates if NEXT_PUBLIC_SENTRY_DSN env var is set — otherwise the
// SDK is never even loaded, so the main client chunk stays slim.
//
// We `import()` instead of static-importing so webpack splits the entire
// Sentry SDK into a separate chunk that's fetched only when DSN is set
// (i.e. production with monitoring enabled). Dev and DSN-less prod
// builds pay zero KB for Sentry.
if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  import('@sentry/nextjs').then((Sentry) => {
    Sentry.init({
      dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
      environment: process.env.NEXT_PUBLIC_VERCEL_ENV || process.env.NODE_ENV,
      // Tag every event with the deployed commit SHA so Sentry can
      // correlate errors with a specific Vercel deployment. Falls
      // back to the build-time NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA;
      // local dev (no Vercel env) reports as 'dev'.
      release: process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA || 'dev',
      // No browser tracing (BrowserTracing integration would add ~80KB
      // gzipped on its own and we only need error capture for now).
      tracesSampleRate: 0,
      // No session replay — privacy concern + extra bandwidth/cost.
      replaysSessionSampleRate: 0,
      replaysOnErrorSampleRate: 0,
      // Skip auto-attached integrations we don't use.
      integrations: (defaults) => defaults.filter((i) =>
        i.name !== 'BrowserTracing' &&
        i.name !== 'Replay'           &&
        i.name !== 'BrowserProfiling' &&
        i.name !== 'BrowserMetrics'
      ),
      beforeSend(event) {
        // Drop errors from known-noisy extensions/sources
        if (event.exception?.values?.[0]?.value?.includes('ResizeObserver')) return null;
        return event;
      },
    });
    // Expose for ErrorBoundary + ad-hoc captures from lib/log.js
    if (typeof window !== 'undefined') window.Sentry = Sentry;
  }).catch(() => {});
}

// Sentry 10 expects this hook for client-side request errors. No-op when
// Sentry isn't loaded.
export const onRouterTransitionStart = () => {};
