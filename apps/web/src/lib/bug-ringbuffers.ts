/**
 * Bug-reporter ringbuffers — always-on, in-memory diagnostic capture.
 *
 * 2026-05-27. Powers the one-click Bug Reporter
 * (`apps/web/src/components/bug-reporter/BugReporterButton.tsx`). When the
 * operator hits "Report a bug," we ship the contents of these four
 * buffers in the capture bundle so the AI analyzer can reason about what
 * the user was doing immediately before they hit the issue:
 *
 *   1. Breadcrumbs    — user actions (clicks, route changes, explicit
 *                       pushBreadcrumb() markers).
 *   2. Console        — every console.error / console.warn (the native
 *                       behavior is preserved — we forward and tee).
 *   3. NetworkFails   — every fetch that returned 4xx/5xx or threw.
 *   4. ReactQuery     — snapshot of QueryCache state captured at bug
 *                       submit time (not a live mirror — too noisy).
 *
 * Buffers are FIFO and capped at MAX_ENTRIES so a long-lived dashboard
 * session can't OOM the tab.
 *
 * Every public API in this module is SAFE to call before
 * `installBugCaptureRingbuffers()` runs (returns empty / no-ops). The
 * client-side providers component (BugCaptureProviders.tsx) calls install
 * once on mount; SSR never calls it (typeof window guard).
 */

import type {
  BugBreadcrumb,
  BugConsoleEntry,
  BugNetworkFailure,
  BugReactQueryEntry,
} from '@cms/api-types';
import type { QueryClient } from '@tanstack/react-query';

// ─── Configuration ────────────────────────────────────────────────────

/** Max entries kept per ringbuffer. Hit by the FIFO trim on every push. */
const MAX_ENTRIES = 50;

/** Per-message truncation caps — mirror the contract in bugs.ts. */
const CONSOLE_MSG_MAX = 1000;
const CONSOLE_STACK_MAX = 2000;
const NETWORK_MSG_MAX = 500;
const BREADCRUMB_LABEL_MAX = 200;

// ─── Buffers ──────────────────────────────────────────────────────────

const breadcrumbs: BugBreadcrumb[] = [];
const consoleEntries: BugConsoleEntry[] = [];
const networkFailures: BugNetworkFailure[] = [];

/** The bug reporter modal sets this so click events INSIDE the modal
 *  don't spam the breadcrumb buffer with self-references. */
let ignoreBreadcrumbsSelector: string | null = null;

/** Set by the providers component once React Query's QueryClient is in
 *  scope. Without it the React Query snapshot at capture time is empty
 *  (we never throw — this is a diagnostic surface, not load-bearing). */
let queryClientRef: QueryClient | null = null;

/** Guard so install() is idempotent — Next.js Strict Mode can re-mount a
 *  client component twice in dev, and we don't want to double-wrap the
 *  global console / fetch. */
let installed = false;

// ─── Buffer helpers ───────────────────────────────────────────────────

function push<T>(buf: T[], entry: T): void {
  buf.push(entry);
  if (buf.length > MAX_ENTRIES) buf.splice(0, buf.length - MAX_ENTRIES);
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + '…';
}

function safeStringify(arg: unknown): string {
  if (arg == null) return String(arg);
  if (typeof arg === 'string') return arg;
  if (typeof arg === 'number' || typeof arg === 'boolean') return String(arg);
  if (arg instanceof Error) return arg.message;
  try {
    return JSON.stringify(arg);
  } catch {
    // Cyclic / unserializable — best-effort tag.
    return `[unserializable ${Object.prototype.toString.call(arg)}]`;
  }
}

// ─── Public API ───────────────────────────────────────────────────────

/**
 * Push an explicit breadcrumb. Use sparingly for "the user just submitted
 * the schedule" type markers that pair with auto-captured clicks.
 */
export function pushBreadcrumb(label: string, type: BugBreadcrumb['type'] = 'state-change', data?: Record<string, unknown>): void {
  if (typeof window === 'undefined') return;
  push(breadcrumbs, {
    ts: Date.now(),
    type,
    label: truncate(label, BREADCRUMB_LABEL_MAX),
    data,
  });
}

/** Snapshot the current ringbuffer state for the bug capture bundle. */
export function snapshotBugRingbuffers(): {
  breadcrumbs: BugBreadcrumb[];
  consoleEntries: BugConsoleEntry[];
  networkFailures: BugNetworkFailure[];
  reactQuery: BugReactQueryEntry[];
} {
  return {
    breadcrumbs: breadcrumbs.slice(),
    consoleEntries: consoleEntries.slice(),
    networkFailures: networkFailures.slice(),
    reactQuery: snapshotReactQuery(),
  };
}

/** Set the QueryClient ref so reactQuery snapshots work. Called once by
 *  the providers component on mount. */
export function setBugCaptureQueryClient(qc: QueryClient | null): void {
  queryClientRef = qc;
}

/** Toggle whether clicks inside `selector` are skipped by the breadcrumb
 *  logger. The bug modal sets this so opening / typing in the modal
 *  doesn't spam the buffer with its own UI events. Pass `null` to
 *  resume capture. */
export function setBugCaptureIgnoreSelector(selector: string | null): void {
  ignoreBreadcrumbsSelector = selector;
}

// ─── Install (call once at app boot) ──────────────────────────────────

/**
 * Wire up the global click / route / console / fetch interceptors.
 * Idempotent — second + subsequent calls are no-ops.
 *
 * SSR guard: returns immediately when `window` is undefined.
 */
export function installBugCaptureRingbuffers(): void {
  if (installed) return;
  if (typeof window === 'undefined') return;
  installed = true;

  installClickListener();
  installRouteListener();
  installConsoleWrappers();
  installFetchWrapper();
}

// ─── Implementation ──────────────────────────────────────────────────

function installClickListener(): void {
  // Capture phase so we see clicks before stopPropagation kills them.
  document.addEventListener(
    'click',
    (ev) => {
      try {
        const target = ev.target as Element | null;
        if (!target) return;

        // Skip clicks inside the bug modal (self-reference noise).
        if (ignoreBreadcrumbsSelector) {
          const within = target.closest(ignoreBreadcrumbsSelector);
          if (within) return;
        }

        // Skip clicks on password inputs / fields explicitly tagged
        // password / secret — never log around credentials.
        if (target instanceof HTMLInputElement && target.type === 'password') return;
        const ariaLabel = target.closest('[aria-label]')?.getAttribute('aria-label') || '';
        if (/password|secret|token|api[\s-]?key/i.test(ariaLabel)) return;

        const label = describeClickTarget(target);
        if (!label) return;
        push(breadcrumbs, {
          ts: Date.now(),
          type: 'click',
          label: truncate(label, BREADCRUMB_LABEL_MAX),
        });
      } catch {
        /* swallow — diagnostic surface must never throw */
      }
    },
    true,
  );
}

function describeClickTarget(target: Element): string | null {
  // Walk up the tree looking for the most useful description.
  const interactive =
    target.closest('button, a[href], [role="button"], [data-testid]') || target;

  const testId = interactive.getAttribute('data-testid');
  if (testId) return `[data-testid=${testId}]`;

  const ariaLabel = interactive.getAttribute('aria-label');
  if (ariaLabel) return `aria:${ariaLabel}`;

  if (interactive instanceof HTMLAnchorElement && interactive.href) {
    const text = (interactive.textContent || '').trim().slice(0, 50);
    return text ? `Link "${text}" → ${interactive.pathname}` : `Link → ${interactive.pathname}`;
  }

  if (interactive instanceof HTMLButtonElement || interactive.getAttribute('role') === 'button') {
    const text = (interactive.textContent || '').trim().slice(0, 60);
    if (text) return `Button "${text}"`;
  }

  const tag = interactive.tagName.toLowerCase();
  const text = (interactive.textContent || '').trim().slice(0, 40);
  return text ? `<${tag}> "${text}"` : null;
}

function installRouteListener(): void {
  // Next.js App Router doesn't ship a public router-events bus, but we
  // can capture navigation by tapping into history.pushState /
  // replaceState + the `popstate` event. Same approach Sentry uses.
  let lastUrl = window.location.pathname + window.location.search;
  const recordNav = () => {
    try {
      const url = window.location.pathname + window.location.search;
      if (url === lastUrl) return;
      lastUrl = url;
      push(breadcrumbs, {
        ts: Date.now(),
        type: 'nav',
        label: truncate(url, BREADCRUMB_LABEL_MAX),
      });
    } catch {
      /* swallow */
    }
  };
  window.addEventListener('popstate', recordNav);

  // Monkey-patch pushState / replaceState since those don't fire popstate.
  const origPush = history.pushState.bind(history);
  const origReplace = history.replaceState.bind(history);
  history.pushState = function (...args: Parameters<typeof history.pushState>) {
    const ret = origPush(...args);
    recordNav();
    return ret;
  };
  history.replaceState = function (...args: Parameters<typeof history.replaceState>) {
    const ret = origReplace(...args);
    recordNav();
    return ret;
  };
}

function installConsoleWrappers(): void {
  const origError = console.error.bind(console);
  const origWarn = console.warn.bind(console);

  // CRITICAL: always forward to the original. The wrapper exists to
  // capture, never to suppress.
  console.error = (...args: unknown[]) => {
    try {
      captureConsole('error', args);
    } catch {
      /* swallow */
    }
    origError(...args);
  };
  console.warn = (...args: unknown[]) => {
    try {
      captureConsole('warn', args);
    } catch {
      /* swallow */
    }
    origWarn(...args);
  };
}

function captureConsole(level: 'error' | 'warn', args: unknown[]): void {
  const joined = args.map(safeStringify).join(' ');
  // Best-effort stack: if an Error was thrown into the args, prefer its
  // .stack; otherwise capture the call site for triage.
  let stack: string | undefined;
  for (const a of args) {
    if (a instanceof Error && a.stack) {
      stack = a.stack;
      break;
    }
  }
  if (!stack) {
    try {
      stack = new Error().stack;
      // Trim the first two frames (this wrapper + captureConsole) — they're noise.
      if (stack) {
        const lines = stack.split('\n');
        stack = [lines[0], ...lines.slice(3)].join('\n');
      }
    } catch {
      stack = undefined;
    }
  }

  push(consoleEntries, {
    ts: Date.now(),
    level,
    message: truncate(joined, CONSOLE_MSG_MAX),
    stack: stack ? truncate(stack, CONSOLE_STACK_MAX) : undefined,
  });
}

function installFetchWrapper(): void {
  const origFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const started = Date.now();
    const method = (init?.method || (typeof input !== 'string' && 'method' in input ? input.method : 'GET') || 'GET').toUpperCase();
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    try {
      // Cast through Request/URL/string union — TS's lib.dom.d.ts
      // typings for fetch's first arg are overloaded in a way that
      // doesn't accept `RequestInfo | URL` directly as a single arg in
      // every TS version. The cast preserves runtime behavior; the
      // browser fetch implementation accepts the same union we declare.
      const res = await origFetch(input as RequestInfo, init);
      if (res.status >= 400) {
        // Try to capture a snippet of the body for triage WITHOUT
        // consuming it — clone() so the caller still gets a fresh
        // response body.
        let message: string | undefined;
        try {
          const clone = res.clone();
          const text = await clone.text();
          message = text ? truncate(text, NETWORK_MSG_MAX) : undefined;
        } catch {
          message = undefined;
        }
        push(networkFailures, {
          ts: started,
          method,
          url: truncate(url, BREADCRUMB_LABEL_MAX),
          status: res.status,
          durationMs: Date.now() - started,
          message,
        });
      }
      return res;
    } catch (err) {
      // Thrown — network error, CORS, abort, etc.
      push(networkFailures, {
        ts: started,
        method,
        url: truncate(url, BREADCRUMB_LABEL_MAX),
        status: null,
        durationMs: Date.now() - started,
        message: truncate(err instanceof Error ? err.message : String(err), NETWORK_MSG_MAX),
      });
      throw err;
    }
  };
}

function snapshotReactQuery(): BugReactQueryEntry[] {
  const qc = queryClientRef;
  if (!qc) return [];
  try {
    const queries = qc.getQueryCache().getAll();
    return queries.slice(0, MAX_ENTRIES).map((q): BugReactQueryEntry => {
      // Map the tanstack status enum to our compact contract:
      //   tanstack: 'pending' | 'error' | 'success'
      //   ours:     'idle' | 'loading' | 'success' | 'error'
      let state: BugReactQueryEntry['state'];
      const s = q.state;
      if (s.status === 'error') state = 'error';
      else if (s.status === 'success') state = 'success';
      else if (s.fetchStatus === 'fetching') state = 'loading';
      else state = 'idle';

      let errorMessage: string | undefined;
      if (s.error) {
        errorMessage = s.error instanceof Error ? s.error.message : String(s.error);
        errorMessage = truncate(errorMessage, 200);
      }

      return {
        queryKey: truncate(JSON.stringify(q.queryKey), BREADCRUMB_LABEL_MAX),
        state,
        dataPresent: s.data !== undefined,
        errorMessage,
        fetchedAt: s.dataUpdatedAt || undefined,
      };
    });
  } catch {
    return [];
  }
}
