/**
 * Per-tenant hourly caps for the Google Reviews integration.
 *
 * Implementation mirrors `ai/ai-image-cap.ts` EXACTLY: it delegates to
 * `ai/ai-hourly-cap.ts`'s sliding-window helpers with a DISTINCT key prefix,
 * so there is a single, audited implementation of the window in the codebase
 * rather than a third hand-rolled copy. Same FAIL-OPEN-on-Redis-loss contract:
 * a Redis blip must never block a paying customer's board.
 *
 * ── WHY TWO SEPARATE CAPS ────────────────────────────────────────────────
 * They guard different spend, at wildly different volumes.
 *
 * SEARCH is always an upstream Text Search call and is always an operator
 * sitting at a keyboard. 30/hr is generous for "find my business" and tight
 * enough that a scripted loop cannot mine the Places index on our key.
 *
 * REVIEWS is polled by every screen in the fleet, but almost every one of
 * those polls is answered from the 6-hour cache and spends NOTHING. So the cap
 * is charged ONLY on a cache MISS — i.e. only when we are about to buy a
 * Place Details **Enterprise + Atmosphere** call, the most expensive Places
 * SKU. A tenant showing reviews for ten locations spends ~40 calls a DAY; the
 * 60/hr ceiling is therefore invisible in normal operation and exists purely
 * so a runaway or a malicious loop cannot turn one tenant into an unbounded
 * bill. Charging every poll instead would mean a 150-screen fleet tripped its
 * own limit while costing Google nothing.
 */

import {
  aiWindowCount,
  aiRecordEvent,
  type AiCapRedisClient,
} from '../../ai/ai-hourly-cap';

/** Redis key prefixes. Distinct from every AI prefix so the budgets never mix. */
export const GREVIEWS_RL_SEARCH_PREFIX = 'greviews:rl:search:';
export const GREVIEWS_RL_FETCH_PREFIX = 'greviews:rl:fetch:';

/** Operator-initiated place lookups per tenant per hour. */
export function reviewsSearchHourlyCap(): number {
  const n = parseInt(process.env.GOOGLE_REVIEWS_SEARCH_HOURLY_CAP || '', 10);
  return Number.isFinite(n) && n > 0 ? n : 30;
}

/** UPSTREAM (cache-miss) review fetches per tenant per hour. */
export function reviewsFetchHourlyCap(): number {
  const n = parseInt(process.env.GOOGLE_REVIEWS_FETCH_HOURLY_CAP || '', 10);
  return Number.isFinite(n) && n > 0 ? n : 60;
}

export async function reviewsSearchWindowCount(
  publisher: AiCapRedisClient | null | undefined,
  tenantId: string,
): Promise<number> {
  return aiWindowCount(publisher, tenantId, GREVIEWS_RL_SEARCH_PREFIX);
}

export async function reviewsSearchRecordEvent(
  publisher: AiCapRedisClient | null | undefined,
  tenantId: string,
): Promise<void> {
  await aiRecordEvent(publisher, tenantId, GREVIEWS_RL_SEARCH_PREFIX);
}

export async function reviewsFetchWindowCount(
  publisher: AiCapRedisClient | null | undefined,
  tenantId: string,
): Promise<number> {
  return aiWindowCount(publisher, tenantId, GREVIEWS_RL_FETCH_PREFIX);
}

export async function reviewsFetchRecordEvent(
  publisher: AiCapRedisClient | null | undefined,
  tenantId: string,
): Promise<void> {
  await aiRecordEvent(publisher, tenantId, GREVIEWS_RL_FETCH_PREFIX);
}
