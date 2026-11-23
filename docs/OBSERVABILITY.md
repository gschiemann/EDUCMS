# Observability

**Last verified against code:** 2026-11-23

## Sentry error tracking

Sentry is integrated into both `apps/api` (NestJS) and `apps/web` (Next.js). It captures unhandled exceptions and samples 10% of traces for performance monitoring (operator pages; screens send none). No session replay or source-map upload is configured — those are opt-in when budget allows.

### What is tracked

- **Errors:** all unhandled exceptions in the API (`SentryModule.forRoot()` and the global `SentryGlobalFilter` registered in `apps/api/src/app.module.ts`) and in the Next.js server and edge runtimes (`apps/web/src/instrumentation.ts` loads `sentry.server.config.ts` / `sentry.edge.config.ts`), and in the browser on every page (`apps/web/src/instrumentation-client.ts`, options in `apps/web/src/lib/sentry-client-options.ts`; 2026-11-23). Until then the browser init lived in `sentry.client.config.ts`, which the Turbopack build never loads, so the browser SDK did not start. A deliberate client error reaching the ingest host is proven on a production build by `apps/web/tests/e2e/sentry-client-init.spec.ts`; `apps/web/tools/check-client-sentry.cjs` checks after a build that the init is in the chunks every page loads and that the player's first-load chunks parse at ES2020 (the Chromium-83 floor). Whether production events arrive depends on `NEXT_PUBLIC_SENTRY_DSN` being set in Vercel at build time: **unverified** until a test event is seen in the Sentry project.
- **Screens** (`/player`, `/board`, `/ribbon`, `/scorebug`, `/overlay`) run a lean profile: error capture and breadcrumbs only, no release-health session, no tracing (no pageload spans, no `sentry-trace` / `baggage` headers on the screen's own requests), no client reports, and at most 20 error events per browser tab session. Operator pages keep the defaults.
- **Traces:** 10% of requests (`tracesSampleRate: 0.1`) in every config except screens (0); the API also samples profiles at 10% (`profilesSampleRate: 0.1`). No session replay (`replaysSessionSampleRate` and `replaysOnErrorSampleRate` are 0 in the browser options).
- **Release:** the API tags events with `GIT_COMMIT_SHA` (default `dev`); the browser uses `NEXT_PUBLIC_GIT_COMMIT_SHA`, then `NEXT_PUBLIC_BUILD_SHA` (the deploy's commit, inlined by `next.config.ts`), then `dev`.
- **PII scrubbing (API):** `sendDefaultPii: false`, plus `redactEvent` from `apps/api/src/sentry-redaction.ts` applied in `beforeSend`, `beforeSendTransaction` and `beforeBreadcrumb`. It recurses, matches on value shape as well as key name, and strips query strings and hashes from captured URLs (fixture table: `apps/api/src/sentry-redaction.spec.ts`). Do not remove these hooks. (An earlier version of this page described a header/body regex in `sentry.ts`; that code was replaced.)
- **PII scrubbing (web):** all three web inits (browser, server, edge) call `scrubEvent` / `scrubBreadcrumb` from `apps/web/src/lib/sentry-scrub.ts`: query strings and credential path segments are dropped from URLs, breadcrumbs and spans, body PII keys are redacted, and user data is cut to `id` and `ip_address`. In the browser, fetch error messages are left as the browser wrote them (`enhanceFetchErrorMessages: 'report-only'`).

### Sign up (free tier)

1. Go to https://sentry.io and create an account (free-tier quota is a vendor figure, unverified here).
2. Create two projects: one for **Node.js** (API) and one for **Next.js** (web).
3. Copy the DSN from each project's **Settings → Client Keys**.

### Set DSNs

`SENTRY_DSN` (API) is in the generated section of `docs/ENVIRONMENT.md` and `NEXT_PUBLIC_SENTRY_DSN` (browser, build time) in its hand-kept table; the web `SENTRY_DSN` appears in `.env.example`. With no DSN set, the API logs a warning at boot and Sentry stays off; production sets `SENTRY_DSN` on the API service.

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

Browser: on the deployed site (an operator page, and a bench screen's `/player`), open the devtools console and run `setTimeout(() => { throw new Error('sentry browser smoke test') })`. The Network panel shows one POST to the DSN's ingest host (`/api/<project>/envelope/`), and the event appears in the Next.js project. With no DSN in the build the console shows `[sentry] NEXT_PUBLIC_SENTRY_DSN not set` once per page load and nothing is sent. Locally, the same proof without a real project: build with a fake DSN (`NEXT_PUBLIC_SENTRY_DSN=https://public@o0.ingest.sentry.io/0`, plus the e2e `NEXT_PUBLIC_API_URL`), then run `tests/e2e/sentry-client-init.spec.ts` with the same DSN in the environment; it intercepts the envelope, so nothing leaves the machine.

### Enabling source-map upload (when funded)

Source maps let Sentry show original TypeScript line numbers in stack traces instead of compiled JS. To enable:

1. Create a Sentry internal integration and copy the auth token.
2. Set `SENTRY_AUTH_TOKEN` in the web build environment (Vercel).
3. In `apps/web/next.config.ts`, the `withSentryConfig` options currently contain `sourcemaps: { disable: true }`; remove it (or set `disable: false`). Other option names (for example `hideSourceMaps`) vary by SDK version (`@sentry/nextjs` is `^10.76.2`): check the SDK docs for that version before relying on them, unverified here.
4. API source maps are not set up; the approach (a build plugin or `sentry-cli`) is undecided.

The auth token is only needed at build time and must never be committed to the repo.
