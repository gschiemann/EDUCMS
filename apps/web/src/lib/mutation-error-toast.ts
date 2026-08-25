/**
 * Plain-English surfacing for failed mutations (operator-trust wave).
 *
 * Until now dozens of mutations failed SILENTLY: `use-api.ts` rolls the
 * optimistic update back in its per-mutation `onError`, so the toggle just
 * flips back and the operator is left staring at a control that "didn't
 * work" with zero explanation. During an API outage every click felt broken.
 *
 * The QueryClient's `MutationCache.onError` (providers.tsx) now runs IN
 * ADDITION to those per-mutation handlers — the rollbacks are untouched, the
 * operator just finally SEES the failure. This module holds the two pure
 * pieces of that behavior so they're unit-testable without React:
 *
 *   1. `humanizeMutationError` — pick the server's own sentence when it reads
 *      like something a human wrote; otherwise fall back to plain English.
 *   2. `planErrorToast` — when an outage fires one error per in-flight
 *      mutation, swap the specific wording for one "several changes didn't
 *      save" line rather than naming each failure.
 *
 * Errors thrown by `apiFetch` (lib/api-client.ts) carry `.status`, `.code`
 * and `.body` alongside `.message`, so we can branch on structure rather
 * than regex-matching prose.
 */

/** Generic "we couldn't save it" line — the safe default. */
export const FALLBACK_ERROR_MESSAGE =
  "That change didn't save — check your connection and try again.";

/** apiFetch throws this shape when fetch itself fails (offline / API down). */
export const OFFLINE_ERROR_MESSAGE =
  "Can't reach the server — check your connection and try again.";

/** 401 — AuthExpirationGuard is already redirecting; say why. */
export const SESSION_ERROR_MESSAGE =
  'Your session expired — please sign in again.';

/** 5xx with no useful server sentence. */
export const SERVER_ERROR_MESSAGE =
  "The server had a problem saving that — please try again.";

/** Replaces the specific message once several failures land at once. */
export const BURST_ERROR_MESSAGE =
  "Several changes didn't save — connection trouble?";

/** How long a toast sits on screen. Long enough to read on a phone. */
export const ERROR_TOAST_DURATION_MS = 7000;

/** Rolling window used to detect a burst. */
export const BURST_WINDOW_MS = 2000;

/** Errors within the window before we swap to the collapsed message. */
export const BURST_THRESHOLD = 3;

/**
 * ONE stable toast id for every mutation error.
 *
 * sonner REPLACES a toast whose id is reused (verified live: five
 * `toast.error(msg, { id })` calls in a single tick leave exactly one toast,
 * showing the last message), which is what keeps an outage from stacking a
 * dozen near-identical failures on top of the operator's page.
 *
 * The obvious alternative — give each error its own id, then
 * `toast.dismiss(theOldOnes)` when the burst threshold trips — DOES NOT
 * WORK: in sonner 2.0.8 `toast.dismiss(id)` is a no-op here, whether called
 * in the same tick as the toast, a macrotask later, or a full second later
 * (only the toast's own close button removes it). That was measured in a
 * real browser, not assumed. Do not "fix" this back to per-error ids without
 * re-testing that dismiss actually removes a toast.
 */
export const MUTATION_ERROR_TOAST_ID = 'mutation-error';

/** The subset of an apiFetch error we actually read. */
interface ApiErrorish {
  message?: unknown;
  status?: unknown;
  body?: { message?: unknown } | null;
}

function asErrorish(err: unknown): ApiErrorish | null {
  if (!err || typeof err !== 'object') return null;
  return err as ApiErrorish;
}

/**
 * Does this string read like a sentence a person wrote, or like machine
 * exhaust? We only forward the former to the operator.
 */
export function isHumanReadable(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const s = value.trim();
  if (s.length < 4 || s.length > 240) return false;
  // A bare token (`FORBIDDEN`, `AUTH_NO_BEARER_TOKEN`) or a single word is a
  // code, not a sentence.
  if (!/\s/.test(s)) return false;
  // apiFetch's own "no server sentence" placeholder.
  if (/^API error:/i.test(s)) return false;
  // Raw HTML (a proxy/CDN error page) or a stack trace.
  if (s.startsWith('<')) return false;
  if (/\n\s*at\s/.test(s)) return false;
  // ALL-CAPS_SNAKE tokens joined by spaces are still codes.
  if (/^[A-Z0-9_\s]+$/.test(s)) return false;
  return true;
}

/**
 * `body.message` is a string for our HttpExceptions but an ARRAY for
 * class-validator failures (`['name must be shorter than…', …]`). `new
 * Error(array)` stringifies to a comma-joined blob, so read the body
 * directly and join with proper punctuation.
 */
function pickServerMessage(e: ApiErrorish): string | null {
  const fromBody = e.body && typeof e.body === 'object' ? e.body.message : undefined;
  if (Array.isArray(fromBody)) {
    const joined = fromBody.filter((m) => typeof m === 'string').join('. ');
    return joined ? joined : null;
  }
  if (typeof fromBody === 'string') return fromBody;
  return typeof e.message === 'string' ? e.message : null;
}

/** apiFetch's network-failure message (it embeds the API URL — don't show that). */
function isNetworkMessage(message: unknown): boolean {
  return typeof message === 'string' && /^Can't reach the server at /.test(message);
}

/**
 * Turn whatever a mutation threw into one sentence the operator can act on.
 * Prefers the server's own wording when it's human-readable.
 */
export function humanizeMutationError(err: unknown): string {
  const e = asErrorish(err);
  if (!e) return FALLBACK_ERROR_MESSAGE;

  // Network failure first: its message IS a sentence, but it leaks the raw
  // API origin, which means nothing to a non-technical operator.
  if (isNetworkMessage(e.message)) return OFFLINE_ERROR_MESSAGE;

  const status = typeof e.status === 'number' ? e.status : null;
  if (status === 401) return SESSION_ERROR_MESSAGE;

  const serverMessage = pickServerMessage(e);
  if (isHumanReadable(serverMessage)) return serverMessage;

  if (status !== null && status >= 500) return SERVER_ERROR_MESSAGE;
  return FALLBACK_ERROR_MESSAGE;
}

/**
 * `meta: { suppressGlobalError: true }` on a mutation opts it out — for
 * surfaces that already render their own inline error so the operator
 * doesn't get told twice.
 */
export function isGlobalErrorSuppressed(meta: unknown): boolean {
  if (!meta || typeof meta !== 'object') return false;
  return (meta as { suppressGlobalError?: unknown }).suppressGlobalError === true;
}

/** Timestamps of the mutation errors still inside the rolling window. */
export interface BurstState {
  readonly recent: readonly number[];
}

export const initialBurstState: BurstState = { recent: [] };

/**
 * Decide what the (single, id-stable) error toast should say next.
 *
 * `collapsed: false` → show this error's own plain-English message.
 * `collapsed: true`  → enough failures landed at once that naming each one is
 *                      noise; say "several changes didn't save" instead.
 *
 * Pure: the caller supplies the clock and threads the returned state back in,
 * so a burst can be replayed deterministically in tests.
 */
export function planErrorToast(
  state: BurstState,
  now: number,
  opts: { windowMs?: number; threshold?: number } = {},
): { state: BurstState; collapsed: boolean } {
  const windowMs = opts.windowMs ?? BURST_WINDOW_MS;
  const threshold = opts.threshold ?? BURST_THRESHOLD;

  const live = state.recent.filter((t) => now - t < windowMs);
  const recent = [...live, now];
  return { state: { recent }, collapsed: recent.length >= threshold };
}
