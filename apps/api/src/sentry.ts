import * as Sentry from '@sentry/nestjs';
import { nodeProfilingIntegration } from '@sentry/profiling-node';

const PII_PATTERN = /secret|token|key|password/i;

function scrubHeaders(
  headers: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!headers) return headers;
  const scrubbed: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    const lower = k.toLowerCase();
    if (lower === 'authorization' || lower === 'cookie' || PII_PATTERN.test(lower)) {
      scrubbed[k] = '[Filtered]';
    } else {
      scrubbed[k] = v;
    }
  }
  return scrubbed;
}

function scrubBody(
  body: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!body || typeof body !== 'object') return body;
  const scrubbed: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    if (PII_PATTERN.test(k)) {
      scrubbed[k] = '[Filtered]';
    } else {
      scrubbed[k] = v;
    }
  }
  return scrubbed;
}

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
    beforeSend(event) {
      if (event.request) {
        event.request.headers = scrubHeaders(
          event.request.headers as Record<string, string> | undefined,
        );
        if (event.request.data && typeof event.request.data === 'object') {
          event.request.data = scrubBody(
            event.request.data as Record<string, unknown>,
          );
        }
      }
      return event;
    },
  });
}

export {};
