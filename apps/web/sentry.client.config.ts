import * as Sentry from '@sentry/nextjs';

const dsn = process.env['NEXT_PUBLIC_SENTRY_DSN'];

if (!dsn) {
  console.warn('[sentry] NEXT_PUBLIC_SENTRY_DSN not set — client error tracking disabled.');
} else {
  Sentry.init({
    dsn,
    environment: process.env['NODE_ENV'] ?? 'development',
    release: process.env['NEXT_PUBLIC_GIT_COMMIT_SHA'] ?? 'dev',
    tracesSampleRate: 0.1,
    replaysOnErrorSampleRate: 0,
    replaysSessionSampleRate: 0,
  });
}
