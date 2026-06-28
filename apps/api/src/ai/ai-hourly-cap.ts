/**
 * Shared per-tenant hourly AI rate-limit window (audit §3 P3, 2026-05-30).
 *
 * The 30/hr "successful AI generation" cap is a SINGLE per-tenant budget
 * that must be shared across EVERY AI surface that spends a generation:
 *   - sparkle / text-gen      (AiService.generate)
 *   - touch-template synth     (AiService.generateTouchTemplate)
 *   - image alt-text           (AiAltTextService.generateImageAltText)
 *
 * Before this module each service kept its own copy of the window logic
 * and alt-text bypassed the hourly cap entirely — so an operator could
 * blow past 30/hr by mixing the sparkle button with a bulk image upload.
 * Centralizing the key + the ZADD/ZCARD/ZREMRANGEBYSCORE sliding-window
 * here means all three count against the EXACT SAME Redis sorted set
 * (`ai:rl:gen:<tenantId>`), so the cap is one shared ceiling.
 *
 * Design notes (carried over verbatim from the original AiService
 * implementation so behavior is unchanged for the existing callers):
 *   - Members are `${now}-<nonce>` so two events in the same millisecond
 *     both count (score == member-timestamp).
 *   - windowCount() prunes expired members as a side effect, then ZCARDs.
 *   - PEXPIRE on record self-evicts idle tenants' keys (2× the window).
 *   - FAIL-OPEN: if the Redis publisher is unavailable, the cap is
 *     SKIPPED, never enforced — a Redis blip must never block a paying
 *     customer. The durable monthly platform cap (Postgres) +
 *     max_tokens per call remain the real spend ceiling.
 *
 * `publisher` is `RedisService.publisher` (ioredis | null). Typed as a
 * minimal structural interface so this helper has no dependency on the
 * realtime module.
 */

/** The trailing window for the hourly cap: 1 hour, in ms. */
export const AI_HOURLY_WINDOW_MS = 60 * 60 * 1000;

/**
 * The shared per-tenant hourly "successful generation" cap, env-overridable via
 * `AI_HOURLY_CAP` (a higher tier / paid plan can raise it without a deploy).
 *
 * 2026-06-28 — default raised 30 → 120. The old 30 was sized for the
 * single-call sparkle button; the Signage Concierge is a MULTI-TURN
 * conversation PLUS a 3-candidate generation, so one finished template is
 * ~6-10 successful calls. At 30/hr an operator hit the wall after ~3-4
 * templates ("You've hit this hour's AI limit") — unacceptable for the flagship
 * "create beautiful templates" flow. The cap is a runaway/abuse guard, NOT the
 * cost ceiling: the durable spend limit is the MONTHLY platform cap
 * (Tenant.aiPlatformUsage*, Postgres) for platform-key tenants + per-call
 * max_tokens. For BYOK tenants (own provider key) the hourly cap is purely an
 * abuse guard — no platform cost — so raising it is safe.
 */
export function resolveAiHourlyCap(): number {
  const n = parseInt(process.env.AI_HOURLY_CAP || '', 10);
  return Number.isFinite(n) && n > 0 ? n : 120;
}

/**
 * Redis key prefix for the shared "successful generation" sliding
 * window. Tenant id is appended. MUST match across every AI surface so
 * the 30/hr cap is one shared ceiling — do not fork this string.
 */
export const AI_RL_SUCCESS_PREFIX = 'ai:rl:gen:';

/** Minimal structural type for the ioredis client we use. */
export interface AiCapRedisClient {
  zremrangebyscore(key: string, min: number, max: number): Promise<number>;
  zcard(key: string): Promise<number>;
  zadd(key: string, score: number, member: string): Promise<number>;
  pexpire(key: string, ms: number): Promise<number>;
}

/**
 * Count events in the trailing window for a tenant, pruning expired
 * members as a side effect. Returns the live count. Fails OPEN (returns
 * 0) when Redis is unavailable.
 *
 * @param prefix defaults to the shared success-cap prefix; pass a
 *   different prefix to reuse the same window machinery for another
 *   counter (AiService's failure cap does this).
 */
export async function aiWindowCount(
  publisher: AiCapRedisClient | null | undefined,
  tenantId: string,
  prefix: string = AI_RL_SUCCESS_PREFIX,
): Promise<number> {
  if (!publisher) return 0; // fail-open: no Redis → don't enforce the soft cap
  const key = `${prefix}${tenantId}`;
  const now = Date.now();
  try {
    await publisher.zremrangebyscore(key, 0, now - AI_HOURLY_WINDOW_MS);
    const count = await publisher.zcard(key);
    return typeof count === 'number' ? count : 0;
  } catch {
    // Caller logs if it cares; fail-open is the contract.
    return 0;
  }
}

/**
 * Record one event at `now` in the tenant's sliding window. Best-effort —
 * a write failure just means the next check undercounts, never throws.
 */
export async function aiRecordEvent(
  publisher: AiCapRedisClient | null | undefined,
  tenantId: string,
  prefix: string = AI_RL_SUCCESS_PREFIX,
): Promise<void> {
  if (!publisher) return;
  const key = `${prefix}${tenantId}`;
  const now = Date.now();
  // Unique member so two events in the same millisecond both count.
  const member = `${now}-${Math.random().toString(36).slice(2, 8)}`;
  try {
    await publisher.zadd(key, now, member);
    await publisher.pexpire(key, AI_HOURLY_WINDOW_MS * 2);
  } catch {
    // Best-effort — swallow.
  }
}
