import * as Sentry from '@sentry/nestjs';
import { nodeProfilingIntegration } from '@sentry/profiling-node';
import { redactEvent, type RedactableEvent } from './sentry-redaction';

/**
 * SEC-011 (2026-09-04) — the scrubbing that used to live inline here walked
 * only request HEADERS and TOP-LEVEL body keys, and never touched URLs. It
 * therefore shipped nested integration `credentials` objects and the legacy
 * SSE `?token=` device JWT straight to Sentry. The real filter now lives in
 * `sentry-redaction.ts`, which recurses, matches on value shape as well as
 * key name, and strips query/hash from every captured URL. See that file for
 * the threat model; see `sentry-redaction.spec.ts` for the fixture table.
 *
 * This is not a theoretical hardening: `SENTRY_DSN` is set on the production
 * API service, so `beforeSend` is on the live path for every unhandled error.
 */

const dsn = process.env['SENTRY_DSN'];

if (!dsn) {
  console.warn('[sentry] SENTRY_DSN not set — error tracking disabled.');
} else {
  Sentry.init({
    dsn,
    environment: process.env['NODE_ENV'] ?? 'development',
    release: process.env['GIT_COMMIT_SHA'] ?? 'dev',
    tracesSampleRate: 0.1,
    profilesSampleRate: 0.1,
    integrations: [nodeProfilingIntegration()],
    // Belt to the braces of `beforeSend`: tell the SDK not to collect request
    // bodies or IPs it does not need in the first place. Redaction is the
    // control we rely on; not collecting is the control that cannot regress.
    sendDefaultPii: false,
    beforeSend(event) {
      return redactEvent(event as RedactableEvent) as typeof event;
    },
    beforeSendTransaction(event) {
      return redactEvent(event as RedactableEvent) as typeof event;
    },
    beforeBreadcrumb(breadcrumb) {
      // Breadcrumbs also reach Sentry attached to TRANSACTIONS and sessions,
      // not only to the error events `beforeSend` sees, so they are filtered
      // at the source as well.
      const wrapped: RedactableEvent = { breadcrumbs: [breadcrumb] };
      redactEvent(wrapped);
      return breadcrumb;
    },
  });
}

export {};
