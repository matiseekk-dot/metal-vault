// ── Sentry SDK v10+ instrumentation entrypoint ─────────────────────
// Replaces the legacy `sentry.{server,edge}.config.js` auto-loading
// from SDK v8. Next.js calls `register()` once per runtime; we
// dynamically import the matching config so each runtime initializes
// only what it needs.
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config');
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config');
  }
}

// Captures errors thrown during request handling that escape the
// per-runtime hooks. SDK v10 added this so server/edge errors can be
// reported even if a custom error boundary swallows them.
export async function onRequestError(err, request, context) {
  const Sentry = await import('@sentry/nextjs');
  Sentry.captureRequestError(err, request, context);
}
