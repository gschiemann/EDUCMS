/**
 * Per-tenant hourly AI IMAGE-generation cap (2026-06-26).
 *
 * AI image generation is materially more expensive than text:
 *   - OpenAI gpt-image-1 / dall-e-3 ≈ $0.04–$0.12 per 1024² image
 *   - Google Imagen 3 ≈ $0.03–$0.04 per image
 * vs text generation at ~$0.005/call. So images get their OWN, TIGHTER
 * hourly ceiling (15/hr/tenant) on a SEPARATE Redis sorted set, rather
 * than sharing the 30/hr text window — a tenant churning out images
 * shouldn't be able to spend 30× the image budget by riding the text cap,
 * and a normal text-gen session shouldn't eat into the image allowance.
 *
 * Implementation mirrors ai-hourly-cap.ts EXACTLY (same sliding-window
 * ZADD/ZCARD/ZREMRANGEBYSCORE machinery, same FAIL-OPEN-on-Redis-loss
 * contract) — we just delegate to that module's helpers with a distinct
 * key prefix so there's a single, audited implementation of the window.
 *
 * FAIL-OPEN: if Redis is unreachable the cap is SKIPPED, never enforced
 * — a blip must not block a paying customer. The real spend ceiling is
 * the durable monthly platform cap (Postgres) for platform-paid tenants;
 * BYOK tenants pay their own provider. This hourly cap is a runaway/abuse
 * guard on top of those.
 */

import {
  aiWindowCount,
  aiRecordEvent,
  type AiCapRedisClient,
} from './ai-hourly-cap';

/**
 * Tighter hourly ceiling for image generation. 15 images/hr at ~$0.04
 * each caps a runaway tenant at ~$0.60/hr of platform spend. Tunable via
 * AI_IMAGE_HOURLY_CAP without a deploy.
 */
export function imageHourlyCap(): number {
  const fromEnv = parseInt(process.env.AI_IMAGE_HOURLY_CAP || '', 10);
  return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : 15;
}

/**
 * Redis key prefix for the image sliding window. DISTINCT from the shared
 * text-gen success prefix (`ai:rl:gen:`) so the two budgets are isolated.
 */
export const AI_RL_IMAGE_PREFIX = 'ai:rl:img:';

/** Count image generations in the trailing 1h window. Fails open (0) on Redis loss. */
export async function aiImageWindowCount(
  publisher: AiCapRedisClient | null | undefined,
  tenantId: string,
): Promise<number> {
  return aiWindowCount(publisher, tenantId, AI_RL_IMAGE_PREFIX);
}

/** Record one image generation in the tenant's window. Best-effort. */
export async function aiImageRecordEvent(
  publisher: AiCapRedisClient | null | undefined,
  tenantId: string,
): Promise<void> {
  await aiRecordEvent(publisher, tenantId, AI_RL_IMAGE_PREFIX);
}
