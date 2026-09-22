/**
 * Included AI allowance — dollars per paired screen per month, pooled per organisation (2026-09-22).
 *
 * WHY. Greg (2026-09-22): "we need to build in a limiter so customers only get so much usage
 * included with a $25 per mo per screen cost." The old ceiling was a flat 200 GENERATIONS per
 * tenant per month: a one-line caption and a full 4K board counted the same, a 40-screen
 * organisation got exactly what a 1-screen trial got, and a model price change moved nothing.
 *
 * NOW
 *   * Usage is metered in DOLLARS — every platform-key call writes its real cost to
 *     `ai_usage_events` (ai-usage-meter.service.ts) at the catalog price of the model that served
 *     it. When the catalog adopts a cheaper model, every allowance stretches the same day.
 *   * The allowance is `AI_INCLUDED_USD_PER_SCREEN` (default $2 — 8% of the $25 plan) × paired
 *     screens, never below `AI_INCLUDED_USD_FLOOR` (default $5, so a trial or a 1-screen venue can
 *     still set up with the Concierge and a handful of board sets).
 *   * It is POOLED at the organisation (the root of the tenant tree): a district's schools and a
 *     chain's locations share one allowance sized by every screen they own, so the corporate
 *     account that designs for 40 locations is not stuck on a zero-screen floor.
 *   * Only OUR key is metered against it. A tenant with its own provider key pays its provider and
 *     is unlimited here (the hourly abuse cap still applies).
 *
 * The public unit is a CREDIT = one US cent of AI at list price. Credits are what the existing
 * `{ used, cap, resetAt }` usage envelope carries, so every cap check and every UI badge keeps its
 * shape; only the unit changed.
 *
 * Month = UTC calendar month (same boundary the old counter used). Reads are cached for 30s per
 * organisation — a burst of checks during one board generation costs one query — and the cache is
 * dropped whenever this process records spend for that organisation.
 */
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { collectDescendantTenantIds, MAX_TENANT_TREE_DEPTH } from '../emergency/tenant-hierarchy';

export interface AllowanceSnapshot {
  /** Root of the tenant tree the allowance is pooled under. */
  orgTenantId: string;
  /** Paired screens across the whole organisation. */
  screens: number;
  includedMicros: number;
  usedMicros: number;
  /** 1 credit = 1 US cent. */
  includedCredits: number;
  usedCredits: number;
  /** First instant of next UTC month, ISO. */
  resetAt: string;
  perScreenUsd: number;
  floorUsd: number;
}

const ORG_CACHE_MS = 10 * 60_000;
const SNAPSHOT_CACHE_MS = 30_000;

function envUsd(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw == null || raw.trim() === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 && n <= 10_000 ? n : fallback;
}

/** Start of the current UTC month and of the next one. */
export function utcMonthWindow(now: Date = new Date()): { start: Date; next: Date } {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { start, next };
}

/** Pure allowance math — exported for the spec. */
export function includedMicrosFor(screens: number, perScreenUsd: number, floorUsd: number): number {
  const byScreens = Math.max(0, Math.floor(screens)) * perScreenUsd;
  return Math.round(Math.max(floorUsd, byScreens) * 1_000_000);
}

@Injectable()
export class AiAllowanceService {
  private readonly logger = new Logger(AiAllowanceService.name);
  private readonly orgCache = new Map<string, { org: string; at: number }>();
  private readonly snapCache = new Map<string, { snap: AllowanceSnapshot; at: number }>();

  constructor(private readonly prisma: PrismaService) {}

  get perScreenUsd(): number {
    return envUsd('AI_INCLUDED_USD_PER_SCREEN', 2);
  }

  get floorUsd(): number {
    return envUsd('AI_INCLUDED_USD_FLOOR', 5);
  }

  /** Root of the tenant tree (the tenant itself when it has no parent). Cached 10 min. */
  async orgTenantIdFor(tenantId: string): Promise<string> {
    const hit = this.orgCache.get(tenantId);
    if (hit && Date.now() - hit.at < ORG_CACHE_MS) return hit.org;
    let current = tenantId;
    const seen = new Set<string>([tenantId]);
    try {
      for (let depth = 0; depth < MAX_TENANT_TREE_DEPTH; depth++) {
        // ten-ok: walks UP the caller's OWN tenant chain to find its organisation root; reads only
        // parentId, and the id is the authenticated tenant (or its ancestor), never caller input.
        const row = (await this.prisma.client.tenant.findUnique({
          where: { id: current },
          select: { parentId: true } as any,
        })) as { parentId?: string | null } | null;
        const parent = row?.parentId || null;
        if (!parent || seen.has(parent)) break;
        seen.add(parent);
        current = parent;
      }
    } catch (e: any) {
      this.logger.warn(`org root lookup failed for ${tenantId}: ${e?.message}`);
    }
    this.orgCache.set(tenantId, { org: current, at: Date.now() });
    return current;
  }

  /** Paired screens across the organisation (root + every non-archived descendant). */
  private async screensInOrg(orgTenantId: string): Promise<number> {
    const descendants = await collectDescendantTenantIds(this.prisma.client.tenant as any, orgTenantId);
    return this.prisma.client.screen.count({
      where: { tenantId: { in: [orgTenantId, ...descendants] }, pairedAt: { not: null } },
    });
  }

  /** Current allowance + this month's platform-key spend for the tenant's organisation. */
  async snapshot(tenantId: string): Promise<AllowanceSnapshot> {
    const orgTenantId = await this.orgTenantIdFor(tenantId);
    const cached = this.snapCache.get(orgTenantId);
    if (cached && Date.now() - cached.at < SNAPSHOT_CACHE_MS) return cached.snap;

    const { start, next } = utcMonthWindow();
    const perScreenUsd = this.perScreenUsd;
    const floorUsd = this.floorUsd;
    let screens = 0;
    let usedMicros = 0;
    try {
      const [s, agg] = await Promise.all([
        this.screensInOrg(orgTenantId),
        this.prisma.client.aiUsageEvent.aggregate({
          _sum: { costMicros: true },
          where: { orgTenantId, source: 'platform', createdAt: { gte: start } },
        }),
      ]);
      screens = s;
      usedMicros = Number(agg?._sum?.costMicros || 0);
    } catch (e: any) {
      // A read failure must not hand out unlimited AI, and must not block a customer on a DB blip
      // either: report the floor as the allowance and nothing used — at worst one organisation gets
      // its floor's worth during an outage, which is the bounded choice.
      this.logger.warn(`allowance read failed for org ${orgTenantId}: ${e?.message}`);
    }
    const includedMicros = includedMicrosFor(screens, perScreenUsd, floorUsd);
    const snap: AllowanceSnapshot = {
      orgTenantId,
      screens,
      includedMicros,
      usedMicros,
      includedCredits: Math.floor(includedMicros / 10_000),
      usedCredits: Math.ceil(usedMicros / 10_000),
      resetAt: next.toISOString(),
      perScreenUsd,
      floorUsd,
    };
    this.snapCache.set(orgTenantId, { snap, at: Date.now() });
    return snap;
  }

  /** Drop the cached snapshot after this process records spend, so the next check sees it. */
  invalidate(orgTenantId: string): void {
    this.snapCache.delete(orgTenantId);
  }
}
