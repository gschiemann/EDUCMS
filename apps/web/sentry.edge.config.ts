import * as Sentry from '@sentry/nextjs';
import { scrubBreadcrumb, scrubEvent } from './src/lib/sentry-scrub';

const dsn = process.env['SENTRY_DSN'];

if (!dsn) {
  // Edge runtime runs before console is always available; suppress if missing
} else {
  Sentry.init({
    dsn,
    environment: process.env['NODE_ENV'] ?? 'development',
    release: process.env['GIT_COMMIT_SHA'] ?? 'dev',
    tracesSampleRate: 0.1,
    // Same scrubbing as the browser and Node configs (src/lib/sentry-scrub.ts).
    beforeSend: (event) => scrubEvent(event),
    beforeSendTransaction: (event) => scrubEvent(event),
    beforeBreadcrumb: (crumb) => scrubBreadcrumb(crumb),
  });
}
