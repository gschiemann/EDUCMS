import * as Sentry from '@sentry/nextjs';
import { scrubBreadcrumb, scrubEvent } from './src/lib/sentry-scrub';

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
    // Request URL, breadcrumbs, spans and transaction names lose their query
    // strings and credential path segments; body PII keys are redacted; the
    // user is reduced to id + ip. See src/lib/sentry-scrub.ts.
    beforeSend: (event) => scrubEvent(event),
    beforeSendTransaction: (event) => scrubEvent(event),
    beforeBreadcrumb: (crumb) => scrubBreadcrumb(crumb),
  });
}
