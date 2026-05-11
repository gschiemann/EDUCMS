/**
 * withDbRetry — wraps a Prisma call with bounded retry on transient errors.
 *
 * The problem this solves: the Supabase pgbouncer pooler occasionally
 * trips on prepared-statement reuse, connection-pool starvation under
 * heartbeat burst, or brief connection-reset moments during the pool's
 * own scaling events. Each one bubbles out as a Prisma error and 500s
 * the request — which is fine for a regular dashboard call (the user
 * retries), but bad for the high-frequency, kiosk-driven endpoints
 * (status heartbeat, manifest fetch) where a 500 cascade can flip a
 * fleet of kiosks to OFFLINE or trip the self-heal nativeReload chain.
 *
 * Observed 2026-05-11 Railway logs (Phase B impetus): 23 DATABASE_ERROR
 * responses on /screens/status/<fp> for a single kiosk over ~70min,
 * always transient, recovered fine on next heartbeat. Each one was a
 * one-shot pgbouncer hiccup; a single in-process retry would have
 * eliminated all of them.
 *
 * Strategy:
 *   - Retry up to 2 extra times (3 total attempts)
 *   - 50ms → 150ms backoff with ±20% jitter
 *   - ONLY retry on the prefix-classified transient errors. NEVER retry
 *     on logic errors (P2002 unique constraint, P2025 not found) — those
 *     are real and a retry would just produce the same failure plus log
 *     noise.
 *   - Hard cap total wall-clock at 600ms so the heartbeat endpoint
 *     stays responsive (Vercel/Railway timeout is 30s but kiosks expect
 *     subsecond response).
 *
 * Usage:
 *   const screen = await withDbRetry(
 *     () => this.prisma.client.screen.findUnique({ where: { id } }),
 *     { label: 'screen.findUnique', logger: console },
 *   );
 *
 * The wrapper logs every retry so we can see in Railway logs how often
 * the pooler is flaking — if retries become frequent we know to look
 * at pool sizing or upstream Supabase health.
 */

export interface WithDbRetryOptions {
  /** Short label for logs ("screen.findUnique"). */
  label?: string;
  /** Override max attempts (default 3 — original + 2 retries). */
  maxAttempts?: number;
  /** Override base backoff in ms (default 50). */
  baseDelayMs?: number;
  /** Pluggable logger for Nest's Logger or console. */
  logger?: { warn: (msg: string) => void };
}

// Error codes / message fragments that signal a transient pool blip
// rather than a logic / schema error. Sourced from Prisma's docs +
// Railway log corpus.
const TRANSIENT_PRISMA_CODES = new Set([
  'P1001', // Can't reach DB server
  'P1002', // DB connection closed unexpectedly
  'P1008', // Operation timed out
  'P1017', // Server closed connection
  'P2024', // Connection pool timeout
  'P2034', // Transaction failed due to write conflict / deadlock (retryable)
]);

const TRANSIENT_MESSAGE_HINTS = [
  'connection terminated',
  'connection reset',
  'connection closed',
  'server closed the connection',
  'too many connections',
  'connection pool timeout',
  'remaining connection slots',
  'cached plan must not change',     // Postgres EAGAIN on prepared-stmt reuse
  'prepared statement', // pgbouncer + pgjs prepared-statement collision
  'ECONNRESET',
  'ETIMEDOUT',
  'ENETUNREACH',
];

export function isTransientDbError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { code?: string; message?: string };
  if (e.code && TRANSIENT_PRISMA_CODES.has(e.code)) return true;
  const msg = (e.message || '').toLowerCase();
  return TRANSIENT_MESSAGE_HINTS.some((hint) => msg.includes(hint.toLowerCase()));
}

export async function withDbRetry<T>(
  fn: () => Promise<T>,
  opts: WithDbRetryOptions = {},
): Promise<T> {
  const maxAttempts = Math.max(1, opts.maxAttempts ?? 3);
  const baseDelayMs = Math.max(5, opts.baseDelayMs ?? 50);
  const label = opts.label || 'db';
  const log = opts.logger || console;

  let lastErr: unknown;
  const startedAt = Date.now();
  // Cap total wall-clock so a flapping pool doesn't pile up retries
  // past the point where the caller would prefer to fail fast.
  const HARD_DEADLINE_MS = 600;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const transient = isTransientDbError(err);
      const elapsed = Date.now() - startedAt;
      const haveBudget = elapsed < HARD_DEADLINE_MS;
      if (!transient || attempt >= maxAttempts || !haveBudget) {
        throw err;
      }
      // 50ms, 150ms, 350ms... — but jittered ±20% so retries from
      // 1000 kiosks aren't all stacked on the same millisecond.
      const base = baseDelayMs * (Math.pow(3, attempt - 1));
      const jitter = base * (0.8 + Math.random() * 0.4);
      const delay = Math.round(Math.min(jitter, HARD_DEADLINE_MS - elapsed));
      try {
        log.warn(
          `[withDbRetry] ${label} attempt ${attempt}/${maxAttempts} transient, retrying in ${delay}ms: ${(err as Error)?.message?.slice(0, 120)}`,
        );
      } catch { /* noop logger */ }
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}
