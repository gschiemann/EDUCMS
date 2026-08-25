/**
 * Activation-funnel derivation — pure, DB-free (same discipline as
 * render-proof.ts / ScreenWedgeDetectorCron.decide: no Prisma import here,
 * so this is unit-testable with plain objects and safe to reuse anywhere).
 *
 * The full metric DEFINITION (why each milestone is sourced the way it is,
 * what's excluded and why) lives in the big comment at the top of
 * activation-funnel.service.ts — that's the one place to read before
 * changing behavior here. This file is just the math.
 */

import { SYSTEM_TENANT_ID } from '../security/system-tenant';

export const FUNNEL_STAGES = [
  'SIGNED_UP',
  'BOARD_CREATED',
  'SCREEN_PAIRED',
  'PUBLISHED',
  'RENDER_PROVEN',
] as const;

export type FunnelStage = (typeof FUNNEL_STAGES)[number];

export interface TenantMilestones {
  /** Tenant.createdAt — always present, every tenant reaches this. */
  signedUpAt: Date;
  /** MIN(Template.createdAt) WHERE tenantId=X AND isSystem=false.
   *  Null = tenant has never created/duplicated a custom board. */
  firstBoardAt: Date | null;
  /** MIN(Screen.pairedAt) WHERE tenantId=X AND pairedAt IS NOT NULL.
   *  Null = tenant has no paired screen yet. */
  firstScreenPairedAt: Date | null;
  /** Earliest evidence of a real publish (see activation-funnel.service.ts
   *  resolvePublishedAt() for how this is sourced from AuditLog + Schedule).
   *  Null = tenant has never published content to a screen. */
  firstPublishedAt: Date | null;
  /** MAX(Screen.lastRenderedAt) WHERE tenantId=X. The MOST RECENT
   *  render-proof heartbeat this fleet has ever reported for the tenant —
   *  deliberately NOT a "first-ever" timestamp (see the big comment in the
   *  service for why no true first-proof time is recoverable from this
   *  column). Null = no screen has ever proven a render. */
  lastRenderProofAt: Date | null;
}

export interface StageResult {
  stage: FunnelStage;
  /** The milestone timestamp backing `stage`. */
  stageReachedAt: Date;
  /** Whole days between stageReachedAt and "now" (>= 0, floored). For
   *  RENDER_PROVEN this reads as "days since the fleet last proved a
   *  render" — a freshness/health signal, not a funnel-timing one (see
   *  the service comment). */
  daysInStage: number;
}

/**
 * Derive a tenant's funnel stage from its raw milestone timestamps.
 *
 * STRICTLY MONOTONIC: reaching stage N requires EVERY earlier milestone to
 * also be non-null, not just stage N's own timestamp. Concretely: a tenant
 * with a render-proof heartbeat but no Schedule row ever created (e.g. the
 * player is showing its idle/splash screen, which still proves pixels are
 * painting) is capped at whatever their last TRUE consecutive milestone is
 * — it does NOT jump ahead to RENDER_PROVEN. Same logic applies at every
 * gate (a screen paired before any board was built caps the tenant at
 * SIGNED_UP from this funnel's point of view, even though
 * firstScreenPairedAt is non-null).
 *
 * This is a deliberate simplification that keeps the stage buckets mutually
 * exclusive and summable to 100% for the funnel-bar chart. It is NOT lossy
 * at the data layer — callers still get every raw milestone timestamp
 * alongside `stage`, so an operator can always see e.g. "stage=SIGNED_UP
 * but firstScreenPairedAt is set" and understand exactly what happened.
 */
export function deriveStage(input: TenantMilestones, nowMs: number = Date.now()): StageResult {
  if (input.firstBoardAt && input.firstScreenPairedAt && input.firstPublishedAt && input.lastRenderProofAt) {
    return finalizeStage('RENDER_PROVEN', input.lastRenderProofAt, nowMs);
  }
  if (input.firstBoardAt && input.firstScreenPairedAt && input.firstPublishedAt) {
    return finalizeStage('PUBLISHED', input.firstPublishedAt, nowMs);
  }
  if (input.firstBoardAt && input.firstScreenPairedAt) {
    return finalizeStage('SCREEN_PAIRED', input.firstScreenPairedAt, nowMs);
  }
  if (input.firstBoardAt) {
    return finalizeStage('BOARD_CREATED', input.firstBoardAt, nowMs);
  }
  return finalizeStage('SIGNED_UP', input.signedUpAt, nowMs);
}

function finalizeStage(stage: FunnelStage, reachedAt: Date, nowMs: number): StageResult {
  const daysInStage = Math.max(0, Math.floor((nowMs - reachedAt.getTime()) / 86_400_000));
  return { stage, stageReachedAt: reachedAt, daysInStage };
}

/**
 * Known demo/fixture tenant slug prefixes to exclude from the funnel.
 * Currently just the 5-location POS integration-test fixture seeded by
 * packages/database/prisma/seed-multilocation-demo.mjs ('acme-austin',
 * 'acme-coffee-corporate', etc — see that file's ID table). It ships its
 * own `--clean` flag, i.e. it self-identifies as throwaway fixture data,
 * not a customer. Add a prefix here (with a comment citing the seed
 * script) if a future demo seed needs the same treatment — see the
 * "NOT excluded" notes in activation-funnel.service.ts before adding
 * Walnut Creek or anything else you can't verify a pattern for.
 */
export const DEMO_TENANT_SLUG_PREFIXES = ['acme-'];

export interface TenantExclusionInput {
  id: string;
  slug: string;
  archivedAt: Date | null;
}

/**
 * Should this tenant be hidden from the activation funnel entirely?
 *
 * Three reasons, in order: soft-deleted (archived), the platform's own
 * no-tenant sentinel row, or a known demo-seed fixture. See the big
 * comment at the top of activation-funnel.service.ts for the full
 * evidence trail behind each of these (including what was deliberately
 * NOT added here, and why).
 */
export function isExcludedFromFunnel(tenant: TenantExclusionInput): boolean {
  if (tenant.archivedAt) return true;
  if (tenant.id === SYSTEM_TENANT_ID) return true;
  if (DEMO_TENANT_SLUG_PREFIXES.some((prefix) => tenant.slug.startsWith(prefix))) return true;
  return false;
}

/** Median of a number array. Null for an empty array (no data, not zero). */
export function medianOf(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Hours between two dates (`to` - `from`), can be negative if misordered. */
export function hoursBetween(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / 3_600_000;
}

/** reached/total as a rounded-to-1-decimal percentage; null pct when total=0 (no data, not 0%). */
export function rateOf(reached: number, total: number): { reached: number; total: number; pct: number | null } {
  return { reached, total, pct: total > 0 ? Math.round((reached / total) * 1000) / 10 : null };
}
