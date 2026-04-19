import * as Sentry from '@sentry/nextjs';

const dsn = process.env['SENTRY_DSN'];

const PII_KEY = /email|firstName|lastName|phone|ssn|password|secret|token|key/i;

function redactPII(data: unknown): unknown {
  if (!data) return data;
  if (Array.isArray(data)) return data.map((d) => redactPII(d));
  if (typeof data === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
      if (PII_KEY.test(k)) {
        out[k] = '[redacted]';
      } else if (v && typeof v === 'object') {
        out[k] = redactPII(v);
      } else {
        out[k] = v;
      }
    }
    return out;
  }
  return data;
}

if (!dsn) {
  console.warn('[sentry] SENTRY_DSN not set — server error tracking disabled.');
} else {
  Sentry.init({
    dsn,
    environment: process.env['NODE_ENV'] ?? 'development',
    release: process.env['GIT_COMMIT_SHA'] ?? 'dev',
    tracesSampleRate: 0.1,
    beforeSend(event) {
      if (event.request?.data) {
        event.request.data = redactPII(event.request.data) as typeof event.request.data;
      }
      if (event.breadcrumbs) {
        for (const b of event.breadcrumbs) {
          if (b.data) b.data = redactPII(b.data) as typeof b.data;
        }
      }
      if (event.user) {
        const { id, ip_address } = event.user;
        event.user = { id, ip_address };
      }
      return event;
    },
  });
}
