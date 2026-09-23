/**
 * Super Admin — the live AI model catalog and what AI costs (2026-09-22).
 *
 *   GET  /api/v1/super/ai/catalog           which model serves every tier today, every known model
 *                                            with price + status, the last sync report, the settings
 *   POST /api/v1/super/ai/catalog/sync      run the daily sync now (vendor feeds → canary → adopt)
 *   PUT  /api/v1/super/ai/catalog/settings  pins, tier ceilings, job → tier, effort, family patterns
 *   GET  /api/v1/super/ai/usage             this month's spend per organisation vs its allowance, and the
 *                                            AI board margin: pack revenue vs what AI cost us (2026-09-23)
 *
 * Every settings change is audited (AI_MODEL_CATALOG_CHANGED) with the before/after of what moved.
 * Nothing here can break generation: a bad pattern is ignored by the resolver, a pin to a model the
 * catalog cannot send is skipped, and an unset field falls back to the in-code default.
 */
import { Body, Controller, Get, HttpException, HttpStatus, Post, Put, Req, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { AppRole } from '@cms/database';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RbacGuard } from '../auth/rbac.guard';
import { RequireRoles } from '../auth/roles.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { AiCatalogStoreService } from './ai-catalog-store.service';
import { AiModelSyncCron } from './ai-model-sync.cron';
import { AiAllowanceService, utcMonthWindow } from './ai-allowance.service';
import { BOARD_COGS_FEATURES, BOARD_CREDIT_FEATURES } from './ai-board-credits';
import { AI_TIERS, getCatalog, type AiJob, type CatalogState } from './ai-model-catalog';
import { hasPlatformKey, platformKeysPresent, platformVisionProvider } from './ai-platform-keys';
import { visionModelFor, type AiProvider } from './ai-providers';

const PROVIDERS: AiProvider[] = ['anthropic', 'openai', 'google'];
const Tier = z.enum(['standard', 'balanced', 'premium']);
const Provider = z.enum(['anthropic', 'openai', 'google']);
const EFFORT = z.enum(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']);

// zod 4: `z.record(enum, …)` requires EVERY key — `partialRecord` is the "any subset" form.
const SettingsBody = z
  .object({
    /** provider → tier → model id; null clears the pin. */
    pins: z.partialRecord(Provider, z.partialRecord(Tier, z.string().max(80).nullable())).optional(),
    /**
     * Our key's routing per job, preference order. The first route whose vendor we hold a key for
     * wins; the catalog completes the list with the default routes for vendors it omits.
     */
    platformRoutes: z
      .object({
        fast: z.array(z.object({ provider: Provider, tier: Tier }).strict()).min(1).max(3).optional(),
        design: z.array(z.object({ provider: Provider, tier: Tier }).strict()).min(1).max(3).optional(),
      })
      .strict()
      .optional(),
    jobEffort: z.object({ fast: EFFORT.optional(), design: EFFORT.optional() }).strict().optional(),
    tierCeilings: z.partialRecord(Tier, z.number().positive().max(1000)).optional(),
    tierFamilies: z.partialRecord(Provider, z.partialRecord(Tier, z.string().min(1).max(60))).optional(),
    familyPatterns: z
      .array(z.object({ provider: Provider, family: z.string().min(1).max(60), pattern: z.string().min(2).max(200) }).strict())
      .max(60)
      .optional(),
    /** Image models per vendor, best first (image generation runs on tenants' own keys). */
    imageModels: z
      .object({
        openai: z.array(z.string().min(1).max(80)).min(1).max(6).optional(),
        google: z.array(z.string().min(1).max(80)).min(1).max(6).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

@Controller('api/v1/super/ai')
@UseGuards(JwtAuthGuard, RbacGuard)
@RequireRoles(AppRole.SUPER_ADMIN)
export class AiCatalogController {
  constructor(
    private readonly store: AiCatalogStoreService,
    private readonly sync: AiModelSyncCron,
    private readonly allowance: AiAllowanceService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('catalog')
  async getCatalog() {
    const { state, version, updatedAt } = await this.store.read();
    const cat = getCatalog();
    return {
      version,
      updatedAt,
      tiers: PROVIDERS.map((provider) => ({
        provider,
        tiers: AI_TIERS.map((tier) => {
          const { model, fallback } = cat.resolveTier(provider, tier);
          return {
            tier,
            family: cat.tierFamilies[provider][tier],
            ceilingOutputPer1M: cat.tierCeilings[tier],
            pinned: cat.pins[provider]?.[tier] ?? null,
            model: { id: model.id, label: model.label, status: model.status, inputPer1M: model.inputPer1M, outputPer1M: model.outputPer1M },
            fallback: fallback ? { id: fallback.id, label: fallback.label } : null,
          };
        }),
      })),
      // What each job runs on RIGHT NOW on our key (the first route we hold a key for), what it
      // would prefer, and which vendors we hold a key for — booleans only, never a key.
      platformKeys: platformKeysPresent(),
      jobs: (['fast', 'design'] as AiJob[]).map((job) => {
        const preferred = cat.platformRoutes[job][0];
        const active = cat.routeForJob(job, hasPlatformKey);
        const activeModel = active ? cat.resolveTier(active.provider, active.tier).model : null;
        const preferredModel = cat.resolveTier(preferred.provider, preferred.tier).model;
        return {
          job,
          routes: cat.platformRoutes[job],
          preferred: { ...preferred, model: { id: preferredModel.id, label: preferredModel.label } },
          active: active && activeModel
            ? {
                ...active,
                model: {
                  id: activeModel.id,
                  label: activeModel.label,
                  status: activeModel.status,
                  inputPer1M: activeModel.inputPer1M,
                  outputPer1M: activeModel.outputPer1M,
                },
              }
            : null,
          effort: cat.jobEffort[job],
        };
      }),
      // Image reading (alt text, "Upload a look", menu photos) on our key follows its OWN vendor
      // order — the cheapest vision model we hold a key for — not the fast route. Same answer the
      // alt-text service uses, so this line cannot drift from what actually runs.
      vision: (() => {
        const provider = platformVisionProvider();
        if (!provider) return null;
        const id = visionModelFor(provider);
        const m = cat.get(provider, id);
        return { provider, model: { id, label: m?.label ?? id } };
      })(),
      jobEffort: cat.jobEffort,
      familyPatterns: cat.patterns,
      imageModels: { openai: cat.imageModels('openai'), google: cat.imageModels('google') },
      models: cat
        .list()
        .map((m) => ({
          provider: m.provider,
          id: m.id,
          label: m.label,
          family: m.family,
          releasedAt: m.releasedAt,
          inputPer1M: m.inputPer1M,
          outputPer1M: m.outputPer1M,
          status: m.status,
          retiresAt: m.retiresAt,
          source: m.source,
          caps: m.caps,
        }))
        .sort((a, b) => a.provider.localeCompare(b.provider) || (b.releasedAt || '').localeCompare(a.releasedAt || '')),
      failures: state.failures || {},
      lastSync: state.lastSync || null,
      allowance: { perScreenUsd: this.allowance.perScreenUsd, floorUsd: this.allowance.floorUsd },
    };
  }

  @Post('catalog/sync')
  async syncNow() {
    try {
      return await this.sync.runOnce('admin');
    } catch (e: any) {
      throw new HttpException({ code: 'AI_CATALOG_SYNC_FAILED', message: e?.message || 'Sync failed.' }, HttpStatus.BAD_GATEWAY);
    }
  }

  @Put('catalog/settings')
  async updateSettings(@Req() req: any, @Body() body: unknown) {
    const parsed = SettingsBody.safeParse(body);
    if (!parsed.success) {
      throw new HttpException(
        { code: 'AI_CATALOG_SETTINGS_INVALID', message: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') },
        HttpStatus.BAD_REQUEST,
      );
    }
    const patch = parsed.data;
    for (const p of patch.familyPatterns || []) {
      try {
        new RegExp(p.pattern);
      } catch {
        throw new HttpException({ code: 'AI_CATALOG_PATTERN_INVALID', message: `Not a valid pattern: ${p.pattern}` }, HttpStatus.BAD_REQUEST);
      }
    }
    let before: CatalogState = {};
    // What our key's jobs actually ran on before this write (legacy settings included) — the
    // audit row's honest "before", whatever shape the stored state was in.
    const effectiveRoutesBefore = getCatalog().platformRoutes;
    const next = await this.store.update((s) => {
      before = s;
      const pins: CatalogState['pins'] = { ...(s.pins || {}) };
      for (const [provider, tiers] of Object.entries(patch.pins || {})) {
        const cur: Record<string, string> = { ...((pins as any)[provider] || {}) };
        for (const [tier, id] of Object.entries(tiers || {})) {
          if (id) cur[tier] = id;
          else delete cur[tier];
        }
        (pins as any)[provider] = cur;
      }
      return {
        ...s,
        pins,
        ...(patch.platformRoutes ? { platformRoutes: { ...(s.platformRoutes || {}), ...patch.platformRoutes } } : {}),
        ...(patch.jobEffort ? { jobEffort: { ...(s.jobEffort || {}), ...patch.jobEffort } } : {}),
        ...(patch.tierCeilings ? { tierCeilings: { ...(s.tierCeilings || {}), ...patch.tierCeilings } } : {}),
        ...(patch.tierFamilies
          ? {
              tierFamilies: Object.fromEntries(
                PROVIDERS.map((p) => [p, { ...((s.tierFamilies as any)?.[p] || {}), ...((patch.tierFamilies as any)?.[p] || {}) }]),
              ),
            }
          : {}),
        ...(patch.familyPatterns ? { familyPatterns: patch.familyPatterns } : {}),
        ...(patch.imageModels ? { imageModels: { ...(s.imageModels || {}), ...patch.imageModels } } : {}),
      } as CatalogState;
    });
    await this.prisma.client.auditLog
      .create({
        data: {
          action: 'AI_MODEL_CATALOG_CHANGED',
          targetType: 'ai-catalog',
          targetId: 'singleton',
          tenantId: req.user.tenantId,
          userId: req.user.id,
          details: JSON.stringify({
            patch,
            before: {
              pins: before.pins || {},
              platformRoutes: before.platformRoutes || {},
              platformJobs: before.platformJobs || {},
              effectiveRoutes: effectiveRoutesBefore,
              jobEffort: before.jobEffort || {},
              tierCeilings: before.tierCeilings || {},
            },
          }).slice(0, 8000),
        },
      })
      .catch(() => {
        /* audit best-effort, same as every other settings write */
      });
    return { ok: true, pins: next.pins || {}, platformRoutes: next.platformRoutes || {}, jobEffort: next.jobEffort || {} };
  }

  /**
   * This month's AI spend per organisation, platform key vs own key, against the allowance — and,
   * since 2026-09-23, the AI BOARD MARGIN (Greg: "I need to make profit, not just pass the cost to
   * them"). Per organisation and in total:
   *   packRevenueUsd   what board packs bought this month were paid (Stripe amount_total)
   *   boardsSold       the boards those packs added
   *   boardsUsed       board credits drawn on our key this month (candidates + refines)
   *   cogsUsd          every dollar our key spent for the organisation this month (metered at the
   *                    serving model's price) — boardCogsUsd is the board pipeline's share of it
   *   grossMarginUsd   packRevenueUsd − cogsUsd. AI-only: the plan's per-screen revenue is not in
   *                    this view, so an organisation living on its INCLUDED boards shows its AI cost
   *                    as a negative number — that is what its plan pays for.
   *   boardCostUsdTrailing  our cost of goods per board over the trailing 30 days (null = none drawn)
   * Read-only.
   */
  @Get('usage')
  async usage() {
    const { start, next } = utcMonthWindow();
    const [rows, packRows, boardRows, trailing] = await Promise.all([
      this.prisma.client.aiUsageEvent.groupBy({
        by: ['orgTenantId', 'source', 'provider'],
        where: { createdAt: { gte: start } },
        _sum: { costMicros: true },
        _count: { _all: true },
      }),
      this.prisma.client.aiCreditPurchase.groupBy({
        by: ['orgTenantId'],
        where: { createdAt: { gte: start } },
        _sum: { usdMicros: true, boards: true },
      }),
      this.prisma.client.aiUsageEvent.groupBy({
        by: ['orgTenantId', 'feature'],
        where: { createdAt: { gte: start }, source: 'platform', feature: { in: [...BOARD_COGS_FEATURES] } },
        _sum: { costMicros: true },
        _count: { _all: true },
      }),
      this.allowance.boardCostTrailing(),
    ]);
    const packsByOrg = new Map(
      packRows.map((p) => [p.orgTenantId, { revenueMicros: Number(p._sum?.usdMicros || 0), boards: Number(p._sum?.boards || 0) }]),
    );
    const boardsByOrg = new Map<string, { used: number; cogsMicros: number }>();
    for (const r of boardRows) {
      const cur = boardsByOrg.get(r.orgTenantId) || { used: 0, cogsMicros: 0 };
      cur.cogsMicros += Number(r._sum?.costMicros || 0);
      if (BOARD_CREDIT_FEATURES.includes(r.feature)) cur.used += Number(r._count?._all || 0);
      boardsByOrg.set(r.orgTenantId, cur);
    }
    // An organisation that bought a pack this month but has not spent yet is still on the board.
    const orgIds = Array.from(new Set([...rows.map((r) => r.orgTenantId), ...packsByOrg.keys()]));
    const tenants = orgIds.length
      ? await this.prisma.client.tenant.findMany({ where: { id: { in: orgIds } }, select: { id: true, name: true } })
      : [];
    const nameOf = new Map(tenants.map((t) => [t.id, t.name]));
    const byOrg = new Map<string, { orgTenantId: string; name: string; platformUsd: number; ownKeyUsd: number; calls: number }>();
    for (const orgTenantId of packsByOrg.keys()) {
      byOrg.set(orgTenantId, { orgTenantId, name: nameOf.get(orgTenantId) || orgTenantId, platformUsd: 0, ownKeyUsd: 0, calls: 0 });
    }
    // Our key's spend per vendor — what moving design from Claude to GPT-6 Sol actually cost.
    const platformByProvider: Record<string, number> = {};
    for (const r of rows) {
      if (r.source === 'platform') {
        platformByProvider[r.provider] = (platformByProvider[r.provider] || 0) + Number(r._sum.costMicros || 0) / 1_000_000;
      }
      const cur = byOrg.get(r.orgTenantId) || {
        orgTenantId: r.orgTenantId,
        name: nameOf.get(r.orgTenantId) || r.orgTenantId,
        platformUsd: 0,
        ownKeyUsd: 0,
        calls: 0,
      };
      const usd = Number(r._sum.costMicros || 0) / 1_000_000;
      if (r.source === 'platform') cur.platformUsd += usd;
      else cur.ownKeyUsd += usd;
      cur.calls += r._count._all;
      byOrg.set(r.orgTenantId, cur);
    }
    const orgs = await Promise.all(
      Array.from(byOrg.values()).map(async (o) => {
        const snap = await this.allowance.snapshot(o.orgTenantId);
        const packs = packsByOrg.get(o.orgTenantId) || { revenueMicros: 0, boards: 0 };
        const boards = boardsByOrg.get(o.orgTenantId) || { used: 0, cogsMicros: 0 };
        const packRevenueUsd = packs.revenueMicros / 1_000_000;
        return {
          ...o,
          platformUsd: round2(o.platformUsd),
          ownKeyUsd: round2(o.ownKeyUsd),
          screens: snap.screens,
          includedUsd: round2(snap.includedMicros / 1_000_000),
          packRevenueUsd: round2(packRevenueUsd),
          boardsSold: packs.boards,
          boardsUsed: boards.used,
          cogsUsd: round2(o.platformUsd),
          boardCogsUsd: round2(boards.cogsMicros / 1_000_000),
          grossMarginUsd: round2(packRevenueUsd - o.platformUsd),
          boardCostUsdTrailing: trailing.get(o.orgTenantId)?.usdPerBoard ?? null,
        };
      }),
    );
    orgs.sort((a, b) => b.platformUsd + b.ownKeyUsd - (a.platformUsd + a.ownKeyUsd));
    const fleet = Array.from(trailing.values()).reduce((s, c) => ({ cogs: s.cogs + c.cogsMicros, boards: s.boards + c.boards }), { cogs: 0, boards: 0 });
    const totalPackRevenueUsd = orgs.reduce((s, o) => s + o.packRevenueUsd, 0);
    const totalCogsUsd = orgs.reduce((s, o) => s + o.cogsUsd, 0);
    return {
      month: start.toISOString().slice(0, 7),
      resetAt: next.toISOString(),
      totalPlatformUsd: round2(orgs.reduce((s, o) => s + o.platformUsd, 0)),
      totalOwnKeyUsd: round2(orgs.reduce((s, o) => s + o.ownKeyUsd, 0)),
      platformByProvider: Object.fromEntries(Object.entries(platformByProvider).map(([k, v]) => [k, round2(v)])),
      totalPackRevenueUsd: round2(totalPackRevenueUsd),
      totalBoardsSold: orgs.reduce((s, o) => s + o.boardsSold, 0),
      totalBoardsUsed: orgs.reduce((s, o) => s + o.boardsUsed, 0),
      totalCogsUsd: round2(totalCogsUsd),
      totalGrossMarginUsd: round2(totalPackRevenueUsd - totalCogsUsd),
      boardCostUsdTrailing: fleet.boards ? Math.round(fleet.cogs / fleet.boards / 10_000) / 100 : null,
      orgs,
    };
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
