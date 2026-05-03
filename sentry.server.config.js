import * as Sentry from '@sentry/nextjs';

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV,
    tracesSampleRate: 0.1,
    beforeSend(event) {
      // Strip request headers/cookies that may carry credentials before
      // anything leaves the server. Play Console Data Safety form
      // claims we don't ship credentials to third parties.
      if (event.request?.headers) {
        delete event.request.headers.authorization;
        delete event.request.headers.cookie;
        delete event.request.headers['x-revenuecat-signature'];
        delete event.request.headers['stripe-signature'];
      }
      if (event.request?.cookies) delete event.request.cookies;
      // Don't send the user's email even if Sentry auto-attached it.
      if (event.user) {
        delete event.user.email;
        delete event.user.ip_address;
      }
      return event;
    },
  });
}
