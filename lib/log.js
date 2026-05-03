// ── Tiny logging shim ─────────────────────────────────────────────
// In dev: prints to console. In prod: sends to Sentry if available, else
// silent. Replaces ad-hoc `console.error('Save error', e)` in catch blocks.
//
// Usage:
//   import { logError, logWarn } from '@/lib/log';
//   logError('Saving photo', e);

function sentryCapture(err, meta) {
  if (typeof window !== 'undefined' && window.Sentry?.captureException) {
    try { window.Sentry.captureException(err, { extra: meta }); } catch {}
    return true;
  }
  return false;
}

export function logError(message, error, meta) {
  if (process.env.NODE_ENV !== 'production') {
    // eslint-disable-next-line no-console
    console.error(message, error);
    return;
  }
  if (!sentryCapture(error || new Error(message), { message, ...meta })) {
    // No Sentry configured — silent in prod is fine; UI surfaces a toast.
  }
}

export function logWarn(message, error, meta) {
  if (process.env.NODE_ENV !== 'production') {
    // eslint-disable-next-line no-console
    console.warn(message, error);
    return;
  }
  // Warnings are not interesting in prod telemetry — drop silently.
}
