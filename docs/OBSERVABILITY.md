# Observability

## Sentry error tracking

Sentry is integrated into both `apps/api` (NestJS) and `apps/web` (Next.js). It captures unhandled exceptions and samples 10% of traces for performance monitoring. No session replay or source-map upload is configured — those are opt-in when budget allows.

### What is tracked

- **Errors:** all unhandled exceptions in the API (via `SentryGlobalFilter`) and in the Next.js server and client runtimes.
- **Traces:** 10% of requests (`tracesSampleRate: 0.1`) to give performance insight without consuming the free-tier quota.
- **PII scrubbing:** the `beforeSend` hook in `apps/api/src/sentry.ts` strips `Authorization`, `Cookie`, and any header or body field whose name matches `/secret|token|key|password/i` before the event leaves the process. Do not remove this hook.

### Sign up (free tier)

1. Go to https://sentry.io and create a free account (5,000 errors/month included).
2. Create two projects: one for **Node.js** (API) and one for **Next.js** (web).
3. Copy the DSN from each project's **Settings → Client Keys**.

### Set DSNs

**Local development** — add to your `.env` at the repo root (gitignored):

```
SENTRY_DSN=https://...@o0.ingest.sentry.io/...
NEXT_PUBLIC_SENTRY_DSN=https://...@o0.ingest.sentry.io/...
GIT_COMMIT_SHA=local
```

**Vercel (web)** — add in the Vercel dashboard under **Settings → Environment Variables**:
- `NEXT_PUBLIC_SENTRY_DSN` — the Next.js project DSN
- `SENTRY_DSN` — same or a separate server-only DSN
- `GIT_COMMIT_SHA` — set to `$VERCEL_GIT_COMMIT_SHA` in the Vercel UI

**Railway (API)** — add in the Railway service's **Variables** panel:
- `SENTRY_DSN` — the Node.js project DSN
- `GIT_COMMIT_SHA` — can be injected by your CI pipeline at deploy time

### Test it

Throw a deliberate error from any API endpoint (e.g., add `throw new Error('sentry smoke test')` to the health controller temporarily) and confirm it appears in the Sentry dashboard within ~30 seconds. Remove the test throw before committing.

### Enabling source-map upload (when funded)

Source maps let Sentry show original TypeScript line numbers in stack traces instead of compiled JS. To enable:

1. Create a Sentry internal integration and copy the auth token.
2. Set `SENTRY_AUTH_TOKEN` in your CI environment (Railway build step / Vercel build env).
3. In `apps/web/next.config.ts`, update the `withSentryConfig` options:
   - Remove `sourcemaps: { disable: true }` (or set `disable: false`)
   - Set `hideSourceMaps: false` if you want the maps served publicly (not recommended)
4. For the API, add `@sentry/webpack-plugin` to the NestJS build and point it at `SENTRY_AUTH_TOKEN`.

The auth token is only needed at build time and should never be committed to the repo.
