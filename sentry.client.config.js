// Sentry browser error reporting.
// Only activates if NEXT_PUBLIC_SENTRY_DSN env var is set — otherwise no-op.
import * as Sentry from '@sentry/nextjs';

if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    environment: process.env.NODE_ENV,
    tracesSampleRate: 0.1,         // 10% of transactions
    replaysSessionSampleRate: 0,   // no session replay by default
    replaysOnErrorSampleRate: 0.1, // 10% on error
    beforeSend(event) {
      // Drop errors from known-noisy extensions/sources
      if (event.exception?.values?.[0]?.value?.includes('ResizeObserver')) return null;
      return event;
    },
  });
  // Expose for ErrorBoundary
  if (typeof window !== 'undefined') window.Sentry = Sentry;
}
