import * as Sentry from '@sentry/nextjs';

const dsn = process.env['SENTRY_DSN'];

if (!dsn) {
  console.warn('[sentry] SENTRY_DSN not set — server error tracking disabled.');
} else {
  Sentry.init({
    dsn,
    environment: process.env['NODE_ENV'] ?? 'development',
    release: process.env['GIT_COMMIT_SHA'] ?? 'dev',
    tracesSampleRate: 0.1,
  });
}
