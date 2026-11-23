/**
 * Options for the browser Sentry SDK, initialised from
 * `src/instrumentation-client.ts` on every page (2026-11-23, launch audit
 * LIV-03 / OPS-04 / PLW-02 / SSC-06).
 *
 * The browser init used to live in `sentry.client.config.ts`. The Turbopack
 * build (Next 16 default) never loads that file — `@sentry/nextjs` 10 says so
 * in its own webpack config — so the browser SDK did not start in production.
 * The options below are that file's options, unchanged for operator pages,
 * plus a lean profile for screens.
 *
 * SCREENS (`/player`, and the public sports surfaces that a stadium or LED
 * screen loads as its document) run all day on metered links and on
 * Chromium-83 LED controllers. They keep error capture (global handlers, the
 * player's error boundary, breadcrumbs) and drop everything that would add
 * network traffic or work beyond the error report itself:
 *   - no release-health session (`BrowserSession` sends one per page load and
 *     one per URL change);
 *   - no tracing (`BrowserTracing`: pageload spans, web-vitals observers and
 *     the `sentry-trace` / `baggage` headers it adds to same-origin requests,
 *     which include the same-origin gateway's API calls); `tracesSampleRate`
 *     is 0;
 *   - no client reports (counts of dropped events, flushed when the page is
 *     hidden);
 *   - at most `SCREEN_EVENT_CAP` error events per browser tab session, so a
 *     screen that crash-loops reports its first crashes and then goes quiet
 *     instead of sending one event per reload for as long as it loops.
 *
 * Everywhere: fetch error messages are left as the browser wrote them
 * (`enhanceFetchErrorMessages: 'report-only'`). The SDK's default appends the
 * request host to "Failed to fetch" on the live error object, which would
 * change the text the player and the dashboard classify and show.
 *
 * Kill switch: unset `NEXT_PUBLIC_SENTRY_DSN` (build time) and the SDK is not
 * initialised at all. Failure direction: open — if the SDK cannot start, the
 * page carries on without error reporting (`instrumentation-client.ts` wraps
 * the init in try/catch).
 */
import type { BrowserOptions } from '@sentry/nextjs';
import { scrubBreadcrumb, scrubEvent } from './sentry-scrub';

/** Document paths that are a screen, not an operator's browser. */
export const SCREEN_PATH_PREFIXES = ['/player', '/board', '/ribbon', '/scorebug', '/overlay'] as const;

/** Default integrations a screen does not run (see the header). */
export const SCREEN_DROPPED_INTEGRATIONS: readonly string[] = ['BrowserSession', 'BrowserTracing'];

/** Error events one screen tab may send before it stops reporting. */
export const SCREEN_EVENT_CAP = 20;

/** sessionStorage key for the per-tab event count (survives a reload). */
export const SCREEN_EVENT_COUNT_KEY = '__edu_sentry_screen_events';

/** Same sample rate the legacy client config used, for operator pages. */
export const OPERATOR_TRACES_SAMPLE_RATE = 0.1;

export function isScreenPath(pathname: string): boolean {
  return SCREEN_PATH_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/**
 * A per-tab admission counter for screen events. sessionStorage carries the
 * count across the player's own crash-recovery reloads; when storage is
 * unavailable the count is per document.
 */
export function makeScreenEventGate(cap: number = SCREEN_EVENT_CAP): () => boolean {
  let inMemory = 0;
  return () => {
    let stored = 0;
    try {
      stored = parseInt(window.sessionStorage.getItem(SCREEN_EVENT_COUNT_KEY) || '0', 10) || 0;
    } catch { /* storage unavailable: per-document count */ }
    const seen = Math.max(inMemory, stored);
    if (seen >= cap) return false;
    inMemory = seen + 1;
    try {
      window.sessionStorage.setItem(SCREEN_EVENT_COUNT_KEY, String(inMemory));
    } catch { /* storage unavailable */ }
    return true;
  };
}

export function sentryClientOptions(dsn: string, pathname: string): BrowserOptions {
  const common: BrowserOptions = {
    dsn,
    environment: process.env.NODE_ENV ?? 'development',
    // NEXT_PUBLIC_BUILD_SHA is the deploy's commit, inlined by next.config.ts.
    release: process.env.NEXT_PUBLIC_GIT_COMMIT_SHA || process.env.NEXT_PUBLIC_BUILD_SHA || 'dev',
    replaysOnErrorSampleRate: 0,
    replaysSessionSampleRate: 0,
    enhanceFetchErrorMessages: 'report-only',
    // Request URL, breadcrumbs, spans and transaction names lose their query
    // strings and credential path segments; body PII keys are redacted; the
    // user is reduced to id + ip. See src/lib/sentry-scrub.ts.
    beforeSendTransaction: (event) => scrubEvent(event),
    beforeBreadcrumb: (crumb) => scrubBreadcrumb(crumb),
  };

  if (!isScreenPath(pathname)) {
    return {
      ...common,
      tracesSampleRate: OPERATOR_TRACES_SAMPLE_RATE,
      beforeSend: (event) => scrubEvent(event),
    };
  }

  const admit = makeScreenEventGate();
  return {
    ...common,
    tracesSampleRate: 0,
    sendClientReports: false,
    integrations: (defaults) => defaults.filter((i) => !SCREEN_DROPPED_INTEGRATIONS.includes(i.name)),
    beforeSend: (event) => (admit() ? scrubEvent(event) : null),
  };
}
