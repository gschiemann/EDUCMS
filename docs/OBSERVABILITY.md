# Observability

**Last verified against code:** 2026-11-09

## Sentry error tracking

Sentry is integrated into both `apps/api` (NestJS) and `apps/web` (Next.js). It captures unhandled exceptions and samples 10% of traces for performance monitoring. No session replay or source-map upload is configured — those are opt-in when budget allows.

### What is tracked

- **Errors:** all unhandled exceptions in the API (`SentryModule.forRoot()` and the global `SentryGlobalFilter` registered in `apps/api/src/app.module.ts`) and in the Next.js server and edge runtimes (`apps/web/src/instrumentation.ts` loads `sentry.server.config.ts` / `sentry.edge.config.ts`). The browser config `apps/web/sentry.client.config.ts` exists, but `apps/web/src/instrumentation-client.ts` does not import it, so whether client-side errors reach Sentry on this Next.js version is **unverified**.
- **Traces:** 10% of requests (`tracesSampleRate: 0.1`) in every config; the API also samples profiles at 10% (`profilesSampleRate: 0.1`). No session replay (`replaysSessionSampleRate` and `replaysOnErrorSampleRate` are 0 in the client config).
- **Release:** the API tags events with `GIT_COMMIT_SHA` (default `dev`); the browser config uses `NEXT_PUBLIC_GIT_COMMIT_SHA`.
- **PII scrubbing (API):** `sendDefaultPii: false`, plus `redactEvent` from `apps/api/src/sentry-redaction.ts` applied in `beforeSend`, `beforeSendTransaction` and `beforeBreadcrumb`. It recurses, matches on value shape as well as key name, and strips query strings and hashes from captured URLs (fixture table: `apps/api/src/sentry-redaction.spec.ts`). Do not remove these hooks. (An earlier version of this page described a header/body regex in `sentry.ts`; that code was replaced.)
- **PII scrubbing (web):** a `redactPII` key regex in `sentry.server.config.ts` and `sentry.client.config.ts` on request data and breadcrumbs, and user data cut to `id` and `ip_address`. The edge config has no scrubbing hook.

### Sign up (free tier)

1. Go to https://sentry.io and create an account (free-tier quota is a vendor figure, unverified here).
2. Create two projects: one for **Node.js** (API) and one for **Next.js** (web).
3. Copy the DSN from each project's **Settings → Client Keys**.

### Set DSNs

Only `SENTRY_DSN` (API) is declared in `docs/ENVIRONMENT.md`; `NEXT_PUBLIC_SENTRY_DSN` and the web `SENTRY_DSN` appear in `.env.example` but are not yet in that table (gap to close). With no DSN set, the API logs a warning at boot and Sentry stays off; production sets `SENTRY_DSN` on the API service.

**Local development** — add to your `.env` at the repo root (gitignored):

```
SENTRY_DSN=https://...@o0.ingest.sentry.io/...
NEXT_PUBLIC_SENTRY_DSN=https://...@o0.ingest.sentry.io/...
GIT_COMMIT_SHA=local
```

**Vercel (web)** — add in the Vercel dashboard under **Settings → Environment Variables**:
- `NEXT_PUBLIC_SENTRY_DSN` — the Next.js project DSN
- `SENTRY_DSN` — same or a separate server-only DSN
- `GIT_COMMIT_SHA` (server and edge) and `NEXT_PUBLIC_GIT_COMMIT_SHA` (browser) — set to `$VERCEL_GIT_COMMIT_SHA` in the Vercel UI

**Railway (API)** — add in the Railway service's **Variables** panel:
- `SENTRY_DSN` — the Node.js project DSN
- `GIT_COMMIT_SHA` — optional: when unset the API falls back to `RAILWAY_GIT_COMMIT_SHA` for `/api/v1/health`, but the Sentry release in `apps/api/src/sentry.ts` reads only `GIT_COMMIT_SHA`

### Test it

Throw a deliberate error from any API endpoint (e.g., add `throw new Error('sentry smoke test')` to `apps/api/src/health/health.controller.ts` temporarily) and confirm it appears in the Sentry dashboard within ~30 seconds. Remove the test throw before committing.

### Enabling source-map upload (when funded)

Source maps let Sentry show original TypeScript line numbers in stack traces instead of compiled JS. To enable:

1. Create a Sentry internal integration and copy the auth token.
2. Set `SENTRY_AUTH_TOKEN` in the web build environment (Vercel).
3. In `apps/web/next.config.ts`, the `withSentryConfig` options currently contain `sourcemaps: { disable: true }`; remove it (or set `disable: false`). Other option names (for example `hideSourceMaps`) vary by SDK version (`@sentry/nextjs` is `^10.76.2`): check the SDK docs for that version before relying on them, unverified here.
4. API source maps are not set up; the approach (a build plugin or `sentry-cli`) is undecided.

The auth token is only needed at build time and must never be committed to the repo.
