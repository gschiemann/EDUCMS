/**
 * Included AI allowance — pooled per organisation (2026-09-22), in two units since 2026-09-23.
 *
 * WHY. Greg (2026-09-22): "we need to build in a limiter so customers only get so much usage
 * included with a $25 per mo per screen cost." The old ceiling was a flat 200 GENERATIONS per
 * tenant per month: a one-line caption and a full 4K board counted the same, a 40-screen
 * organisation got exactly what a 1-screen trial got, and a model price change moved nothing.
 *
 * TWO UNITS (2026-09-23 — "I need to make profit, not just pass the cost to them"):
 *
 *   * BOARDS — the AI Designer. One credit per board the model draws for the tenant on our key
 *     (each candidate, each Regenerate candidate, each "edit with words" refine), counted from the
 *     `ai_usage_events` ledger by feature; included `max(10, 5 × paired screens)` per UTC month plus
 *     any board packs bought through Stripe (ai-board-credits.ts — the unit, the packs and the
 *     settlement math live there). `boards()` / `assertBoardsAvailable()` below.
 *
 *   * DOLLARS — every other AI feature on our key (Sparkle, the Concierge, rewrite, translate,
 *     alt text, the brief read, …). Every platform-key call writes its real cost to
 *     `ai_usage_events` (ai-usage-meter.service.ts) at the catalog price of the model that served
 *     it; the allowance is `AI_INCLUDED_USD_PER_SCREEN` (default $2) × paired screens, never below
 *     `AI_INCLUDED_USD_FLOOR` (default $5). The Designer's own pipeline (BOARD_PIPELINE_FEATURES) is
 *     NOT summed here — the board cap governs it — so designing the boards a customer bought can
 *     never run Sparkle dry. `snapshot()` below; exposed as CREDITS (1 credit = 1 US cent) in the
 *     old `{ used, cap, resetAt }` envelope every existing caller reads.
 *
 *   Both are POOLED at the organisation (the root of the tenant tree): a district's schools and a
 *   chain's locations share one allowance sized by every screen they own. Only OUR key is metered
 *   against either; a tenant with its own provider key pays its provider and is unlimited here (the
 *   hourly abuse cap still applies).
 *
 * Month = UTC calendar month. Dollar reads are cached for 30s per organisation (a burst of checks
 * during one generation costs one query) and dropped whenever this process records spend. Board
 * reads are NOT cached: they happen once per batch / refine / page load, and a pack bought a moment
 * ago must show up on the very next read.
 */
import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { collectDescendantTenantIds, MAX_TENANT_TREE_DEPTH } from '../emergency/tenant-hierarchy';
import { findTenantAiKeyRow } from './ai-tenant-key';
import {
  AI_BOARD_PACKS,
  BOARD_COGS_FEATURES,
  BOARD_CREDIT_FEATURES,
  BOARD_PACK_VALID_MONTHS,
  BOARD_PIPELINE_FEATURES,
  BOARDS_FLOOR,
  addMonthsUtc,
  boardPackById,
  boardPurchaseAvailability,
  boardsCapMessage,
  boardsLeftFor,
  includedBoardsFor,
  monthKey,
  platformDesignRouteAvailable,
  settleBoardPacks,
  type BoardPurchaseAvailability,
  type BoardSource,
} from './ai-board-credits';

export interface AllowanceSnapshot {
  /** Root of the tenant tree the allowance is pooled under. */
  orgTenantId: string;
  /** Paired screens across the whole organisation. */
  screens: number;
  includedMicros: number;
  /** This month's platform-key spend OUTSIDE the Designer's board pipeline (that one is capped in boards). */
  usedMicros: number;
  /** 1 credit = 1 US cent. */
  includedCredits: number;
  usedCredits: number;
  /** First instant of next UTC month, ISO. */
  resetAt: string;
  perScreenUsd: number;
  floorUsd: number;
}

/** One board pack as the organisation sees it (newest first in `BoardSnapshot.packs`). */
export interface BoardPackBalance {
  id: string;
  pack: string;
  boards: number;
  /** Boards of this pack not yet drawn (0 once expired or used up). */
  remaining: number;
  /** What was paid, USD. */
  usd: number;
  purchasedAt: string;
  expiresAt: string;
  expired: boolean;
}

/** The organisation's AI Designer allowance this month, in BOARDS. */
export interface BoardSnapshot {
  orgTenantId: string;
  /** Paired screens across the organisation. */
  screens: number;
  /** 'YYYY-MM' (UTC). */
  month: string;
  /** This month's included boards — max(10, 5 × screens), the month's high-water mark. */
  included: number;
  /** Boards drawn on our key this month (candidates + refines). */
  used: number;
  /** Unexpired pack boards not yet drawn. */
  purchasedRemaining: number;
  /** Boards that can still be drawn: the rest of the included, then the packs. */
  left: number;
  /** First instant of next UTC month, ISO — when the INCLUDED boards reset (packs keep their own expiry). */
  resetAt: string;
  /** Packs bought in the last 24 months, newest first. */
  packs: BoardPackBalance[];
  /** A read failed: the numbers are the floor, not the truth (never unlimited, never a thrown 500). */
  degraded?: true;
}

/** `GET /api/v1/ai/allowance` — what the dashboard shows an operator. */
export interface AiAllowanceView {
  source: BoardSource;
  /** True only on the tenant's own key. */
  unlimited: boolean;
  boardsIncluded: number | null;
  boardsUsed: number | null;
  boardsPurchasedRemaining: number | null;
  boardsLeft: number | null;
  resetAt: string;
  screens: number | null;
  packs: Array<{ id: string; boards: number; usd: number }>;
  purchaseEnabled: boolean;
  /** Present when purchaseEnabled is false (or source is not 'platform'): one line the web can show. */
  reason?: string;
  reasonCode?: 'OWN_KEY' | 'NO_PLATFORM_KEY' | 'STRIPE_NOT_CONFIGURED';
  degraded?: true;
  /** SUPER_ADMIN callers only: our trailing-30-day cost of goods per board, USD (null = no history). */
  boardCostUsdTrailing?: number | null;
}

/** Our cost of goods per board over a trailing window, per organisation (super-admin margin view). */
export interface BoardCost {
  cogsMicros: number;
  boards: number;
  /** cogs ÷ boards, USD, rounded to the cent; null with no boards in the window. */
  usdPerBoard: number | null;
}

const ORG_CACHE_MS = 10 * 60_000;
const SNAPSHOT_CACHE_MS = 30_000;
/** The trailing window our cost per board is averaged over. */
export const BOARD_COST_WINDOW_DAYS = 30;
/** Only these constant, code-owned feature names are ever inlined into SQL — asserted, never trusted. */
const SAFE_FEATURE = /^[a-z0-9-]+$/;

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

/** 'YYYY-MM' → the naive-UTC timestamp literal a `timestamp(3)` column compares against. */
function naiveUtcMonthStart(key: string): string {
  return `${key}-01 00:00:00`;
}

function sqlFeatureList(features: readonly string[]): string {
  for (const f of features) {
    if (!SAFE_FEATURE.test(f)) throw new Error(`unsafe feature name in SQL: ${f}`);
  }
  return features.map((f) => `'${f}'`).join(', ');
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

  /**
   * DOLLARS: current allowance + this month's platform-key spend for the tenant's organisation,
   * excluding the Designer's board pipeline (capped in boards — see `boards()`).
   */
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
          where: {
            orgTenantId,
            source: 'platform',
            createdAt: { gte: start },
            feature: { notIn: [...BOARD_PIPELINE_FEATURES] },
          },
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

  /** Drop the cached dollar snapshot after this process records spend, so the next check sees it. */
  invalidate(orgTenantId: string): void {
    this.snapCache.delete(orgTenantId);
  }

  // ── BOARDS ────────────────────────────────────────────────────────────────────────────────────

  /**
   * The organisation's AI Designer allowance this month, in boards: included (the month's
   * high-water mark of max(10, 5 × paired screens)), used (ledger rows on our key whose feature
   * costs a credit), and the packs' balance after every month's overage was drawn from them.
   */
  async boards(tenantId: string, now: Date = new Date()): Promise<BoardSnapshot> {
    const orgTenantId = await this.orgTenantIdFor(tenantId);
    const month = monthKey(now);
    const resetAt = utcMonthWindow(now).next.toISOString();
    try {
      // Packs that can matter: every pack still live, and every pack that was live alongside one
      // (bought within the last 24 months). An older pack cannot change today's balance.
      const packFloor = addMonthsUtc(now, -BOARD_PACK_VALID_MONTHS);
      const [screens, purchases, monthRows] = await Promise.all([
        this.screensInOrg(orgTenantId),
        this.prisma.client.aiCreditPurchase.findMany({
          where: { orgTenantId, expiresAt: { gt: packFloor } },
          orderBy: { createdAt: 'asc' },
          take: 500,
        }),
        this.prisma.client.aiBoardMonth.findMany({
          where: { orgTenantId, month: { gte: monthKey(addMonthsUtc(now, -2 * BOARD_PACK_VALID_MONTHS)) } },
          select: { month: true, includedBoards: true },
        }),
      ]);

      // This month's included boards only ever RISE within the month: pairing a screen adds its
      // boards at once, unpairing one does not take boards back until the month turns.
      const computed = includedBoardsFor(screens);
      const includedByMonth = new Map<string, number>(monthRows.map((r) => [r.month, r.includedBoards]));
      const stored = includedByMonth.get(month) ?? 0;
      const included = Math.max(computed, stored);
      includedByMonth.set(month, included);
      if (computed > stored) await this.raiseMonthIncluded(orgTenantId, month, computed);

      const sinceMonth = purchases.length ? monthKey(purchases[0].createdAt) : month;
      const usedByMonth = await this.boardsUsedByMonth(orgTenantId, sinceMonth, month, now);
      const settled = settleBoardPacks({
        packs: purchases.map((p) => ({ id: p.id, boards: p.boards, createdAt: p.createdAt, expiresAt: p.expiresAt })),
        usedByMonth,
        includedByMonth,
        now,
      });
      if (settled.unfunded > 0) {
        this.logger.warn(`AI boards: org ${orgTenantId} drew ${settled.unfunded} board(s) past its allowance and packs (a race past the pre-check)`);
      }
      const used = usedByMonth.get(month) ?? 0;
      return {
        orgTenantId,
        screens,
        month,
        included,
        used,
        purchasedRemaining: settled.purchasedRemaining,
        left: boardsLeftFor(included, used, settled.purchasedRemaining),
        resetAt,
        packs: [...purchases].reverse().map((p) => {
          const expired = p.expiresAt <= now;
          return {
            id: p.id,
            pack: p.pack,
            boards: p.boards,
            remaining: expired ? 0 : settled.remaining.get(p.id) ?? p.boards,
            usd: Math.round(p.usdMicros / 10_000) / 100,
            purchasedAt: p.createdAt.toISOString(),
            expiresAt: p.expiresAt.toISOString(),
            expired,
          };
        }),
      };
    } catch (e: any) {
      // Same bounded choice as the dollar snapshot: never unlimited, never a thrown 500 — the floor,
      // nothing used, no packs (a pack balance we could not read is shown as none, never invented).
      this.logger.warn(`board allowance read failed for org ${orgTenantId}: ${e?.message}`);
      return {
        orgTenantId,
        screens: 0,
        month,
        included: BOARDS_FLOOR,
        used: 0,
        purchasedRemaining: 0,
        left: BOARDS_FLOOR,
        resetAt,
        packs: [],
        degraded: true,
      };
    }
  }

  /**
   * Board credits drawn on our key per UTC month, from `sinceMonth` through `month`. The current
   * month alone (no packs — the common case) is one indexed count; a pack history is ONE grouped
   * statement over the ledger (never a row per event over the wire).
   */
  private async boardsUsedByMonth(orgTenantId: string, sinceMonth: string, month: string, now: Date): Promise<Map<string, number>> {
    if (sinceMonth >= month) {
      const n = await this.prisma.client.aiUsageEvent.count({
        where: {
          orgTenantId,
          source: 'platform',
          feature: { in: [...BOARD_CREDIT_FEATURES] },
          createdAt: { gte: utcMonthWindow(now).start },
        },
      });
      return new Map([[month, n]]);
    }
    // created_at is timestamp(3) WITHOUT time zone, written by Prisma in UTC — so the bound is a
    // naive-UTC literal cast to timestamp, never a JS Date (a Date is sent as timestamptz and
    // shifted through the session zone — the 8f4ae760 lesson). Feature names are code constants,
    // asserted safe before they are inlined.
    const rows = await this.prisma.client.$queryRawUnsafe<Array<{ month: string; boards: number }>>(
      `SELECT to_char(date_trunc('month', "created_at"), 'YYYY-MM') AS "month", COUNT(*)::int AS "boards"
         FROM "ai_usage_events"
        WHERE "org_tenant_id" = $1
          AND "source" = 'platform'
          AND "feature" IN (${sqlFeatureList(BOARD_CREDIT_FEATURES)})
          AND "created_at" >= $2::timestamp
        GROUP BY 1`,
      orgTenantId,
      naiveUtcMonthStart(sinceMonth),
    );
    return new Map((rows || []).map((r) => [String(r.month), Number(r.boards) || 0]));
  }

  /**
   * Record this month's included boards as a high-water mark (it only ever rises within a month).
   * One atomic statement, so two replicas racing can never write the lower value last. Best-effort:
   * a failed write costs nothing today (the value is already in memory) and, for a past month, the
   * settlement gives the benefit of a missing row to the customer.
   */
  private async raiseMonthIncluded(orgTenantId: string, month: string, included: number): Promise<void> {
    try {
      await this.prisma.client.$executeRawUnsafe(
        `INSERT INTO "ai_board_months" ("org_tenant_id", "month", "included_boards", "updated_at")
         VALUES ($1, $2, $3::int, (NOW() AT TIME ZONE 'UTC'))
         ON CONFLICT ("org_tenant_id", "month") DO UPDATE
            SET "included_boards" = GREATEST("ai_board_months"."included_boards", EXCLUDED."included_boards"),
                "updated_at" = (NOW() AT TIME ZONE 'UTC')
          WHERE "ai_board_months"."included_boards" < EXCLUDED."included_boards"`,
        orgTenantId,
        month,
        included,
      );
    } catch (e: any) {
      this.logger.warn(`board month allowance write failed for org ${orgTenantId} ${month}: ${e?.message}`);
    }
  }

  /**
   * The Designer's pre-check on OUR key: the WHOLE request must fit — a batch of `needed` boards
   * (or one refine) — or it is refused with the one AI_CAP_REACHED 402 every AI surface uses, naming
   * the numbers and the two ways forward. Nothing is spent before this passes.
   */
  async assertBoardsAvailable(tenantId: string, needed: number, kind: 'batch' | 'refine' = 'batch'): Promise<BoardSnapshot> {
    const b = await this.boards(tenantId);
    const want = Math.max(1, Math.floor(needed) || 1);
    if (want <= b.left) return b;
    const purchase = boardPurchaseAvailability('platform');
    throw new HttpException(
      {
        message: boardsCapMessage({ needed: want, left: b.left, resetAt: b.resetAt, purchaseEnabled: purchase.enabled, kind }),
        code: 'AI_CAP_REACHED',
        unit: 'boards',
        boardsNeeded: want,
        boardsLeft: b.left,
        used: b.used,
        cap: b.used + b.left,
        resetAt: b.resetAt,
        purchaseEnabled: purchase.enabled,
      },
      HttpStatus.PAYMENT_REQUIRED, // 402 — "your boards are used up: buy more, or bring your own key"
    );
  }

  /**
   * Whose key draws this tenant's boards: its own (or its organisation's — the same nearest-key walk
   * the dispatcher uses), else ours when we hold a key for the design route, else nobody.
   */
  async boardSourceFor(tenantId: string): Promise<BoardSource> {
    try {
      const key = await findTenantAiKeyRow(this.prisma.client as any, tenantId);
      if (key?.aiKeyEncrypted) return 'tenant';
    } catch (e: any) {
      this.logger.warn(`AI key lookup failed for ${tenantId}: ${e?.message}`);
    }
    return platformDesignRouteAvailable() ? 'platform' : 'none';
  }

  /** May this tenant buy a board pack right now (and if not, why)? Checkout and the view share it. */
  async purchaseAvailabilityFor(tenantId: string): Promise<BoardPurchaseAvailability> {
    return boardPurchaseAvailability(await this.boardSourceFor(tenantId));
  }

  /** `GET /api/v1/ai/allowance`. Tenant from the session only; `includeCost` for SUPER_ADMIN. */
  async operatorView(tenantId: string, opts: { includeCost?: boolean } = {}): Promise<AiAllowanceView> {
    const source = await this.boardSourceFor(tenantId);
    const purchase = boardPurchaseAvailability(source);
    const packs = AI_BOARD_PACKS.map(({ id, boards, usd }) => ({ id, boards, usd }));
    const blocked = purchase.enabled ? {} : { reason: purchase.reason, reasonCode: purchase.reasonCode };
    if (source !== 'platform') {
      return {
        source,
        unlimited: source === 'tenant',
        boardsIncluded: null,
        boardsUsed: null,
        boardsPurchasedRemaining: null,
        boardsLeft: null,
        resetAt: utcMonthWindow().next.toISOString(),
        screens: null,
        packs,
        purchaseEnabled: false,
        ...blocked,
      };
    }
    const b = await this.boards(tenantId);
    let boardCostUsdTrailing: number | null | undefined;
    if (opts.includeCost) {
      boardCostUsdTrailing = (await this.boardCostTrailing([b.orgTenantId])).get(b.orgTenantId)?.usdPerBoard ?? null;
    }
    return {
      source,
      unlimited: false,
      boardsIncluded: b.included,
      boardsUsed: b.used,
      boardsPurchasedRemaining: b.purchasedRemaining,
      boardsLeft: b.left,
      resetAt: b.resetAt,
      screens: b.screens,
      packs,
      purchaseEnabled: purchase.enabled,
      ...blocked,
      ...(b.degraded ? { degraded: true as const } : {}),
      ...(opts.includeCost ? { boardCostUsdTrailing } : {}),
    };
  }

  /**
   * OUR cost of goods per board over the trailing window, per organisation: every dollar the board
   * pipeline spent on our key (draws, redraws, refines, critiques, the review's revises, the brief
   * reads) ÷ the boards it produced. For the super-admin margin view only — never shown to operators.
   * One grouped query for any number of organisations.
   */
  async boardCostTrailing(orgTenantIds?: string[], now: Date = new Date()): Promise<Map<string, BoardCost>> {
    const since = new Date(now.getTime() - BOARD_COST_WINDOW_DAYS * 86_400_000);
    const rows = await this.prisma.client.aiUsageEvent.groupBy({
      by: ['orgTenantId', 'feature'],
      where: {
        source: 'platform',
        createdAt: { gte: since },
        feature: { in: [...BOARD_COGS_FEATURES] },
        ...(orgTenantIds ? { orgTenantId: { in: orgTenantIds } } : {}),
      },
      _sum: { costMicros: true },
      _count: { _all: true },
    });
    const out = new Map<string, BoardCost>();
    for (const r of rows) {
      const cur = out.get(r.orgTenantId) || { cogsMicros: 0, boards: 0, usdPerBoard: null };
      cur.cogsMicros += Number(r._sum?.costMicros || 0);
      if (BOARD_CREDIT_FEATURES.includes(r.feature)) cur.boards += Number(r._count?._all || 0);
      out.set(r.orgTenantId, cur);
    }
    for (const c of out.values()) {
      c.usdPerBoard = c.boards ? Math.round(c.cogsMicros / c.boards / 10_000) / 100 : null;
    }
    return out;
  }

  /** A pack id from a request body → the pack, or null (the caller answers 400). */
  packFor(id: unknown) {
    return boardPackById(id);
  }
}
