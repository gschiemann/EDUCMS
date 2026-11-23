/**
 * Runs in the browser before any application code (Next.js
 * `instrumentation-client`), on every page: the dashboard and the player.
 *
 * Zod 4 probes whether `new Function` is allowed the first time it parses an
 * object schema, to pick its JIT fast path (`allowsEval` in
 * zod/v4/core/util.js). Our CSP never allows eval, so that probe filed a
 * `script-src blocked=eval` violation report on every page load that parsed
 * with Zod — ~1,500 `/api/csp-report` calls a day, about 15% of the free
 * Vercel plan's Active CPU (2026-09-28). The probe already failed and Zod
 * already fell back to its interpreted path, so turning the JIT off changes
 * nothing except that the probe — and its report — never happen.
 *
 * Import `config` by name, never the `z` namespace (2026-10-23): this file
 * runs on every page, and the namespace object pulled the whole of Zod into
 * the root chunk every page loads. The named export tree-shakes to Zod's
 * global config, the same object every schema reads.
 *
 * BROWSER SENTRY (2026-11-23, launch audit LIV-03 / OPS-04 / PLW-02 / SSC-06).
 * This file is the only place the browser SDK is initialised. The Turbopack
 * build never loads a `sentry.client.config.ts` (the server and edge configs
 * are still loaded by `instrumentation.ts`). The options, including the lean
 * screen profile, are in `src/lib/sentry-client-options.ts`. No DSN at build
 * time = no SDK and one console warning; an init that throws is swallowed so
 * reporting can never stop a page, or the player, from booting.
 */
import { config } from 'zod';
import { captureRouterTransitionStart, init } from '@sentry/nextjs';
import { sentryClientOptions } from './lib/sentry-client-options';

config({ jitless: true });

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (!dsn) {
  console.warn('[sentry] NEXT_PUBLIC_SENTRY_DSN not set — client error tracking disabled.');
} else {
  try {
    init(sentryClientOptions(dsn, window.location.pathname));
  } catch {
    /* error reporting is optional; the page is not */
  }
}

// Navigation spans on operator pages (a no-op where tracing is off).
export const onRouterTransitionStart = captureRouterTransitionStart;
