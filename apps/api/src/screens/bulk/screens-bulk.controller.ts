/**
 * BULK SCREEN ACTIONS (2026-10-11) — select-all / select-group and push.
 *
 *   POST /api/v1/screens/bulk/resync        Resync (REFRESH_WEB, realtime + durable)
 *   POST /api/v1/screens/bulk/update        Send Player update (force OTA check)
 *   POST /api/v1/screens/bulk/power         Turn panels on / off ({ state })
 *   POST /api/v1/screens/bulk/auto-update   Automatic Player updates ({ mode })
 *
 * Body: `{ screenIds?: string[], screenGroupId?: string, dryRun?: boolean, ... }`.
 * `dryRun: true` answers the SAME per-screen plan without sending or writing
 * anything — the dashboard's confirm sheet ("12 screens — 3 already current
 * will be skipped") is the server's own decision, never a client guess.
 *
 * AUTHORIZATION IS PER SCREEN, and nothing here is new:
 *   - roles: the same @RequireRoles as each single-screen endpoint;
 *   - tenant: every screen is read with the caller's ACTIVE tenant in the
 *     where; another tenant's id answers `not-found` for that row (never a
 *     hint that it exists);
 *   - user scope: UserScopeInterceptor refuses the request when it names a
 *     screen/group outside a screen-scoped person's scope (policy rule
 *     `/screens/bulk/:action`), and this controller filters again per screen
 *     (`out-of-scope`) so the guarantee does not hang on one layer;
 *   - support access: a SUPER_ADMIN needs reach to the active tenant
 *     (SupportAccessInterceptor) and `assertSupportReach` is asserted here too.
 *
 * THE COMMANDS ARE NOT RE-IMPLEMENTED. Each screen runs the single-screen
 * function the per-screen endpoint runs (`screen-commands.ts`,
 * `runDisplayControl`), so the emergency interlock, never-interrupt semantics,
 * the signed message and the audit vocabulary are identical. On top of the
 * per-screen audit rows each real push writes ONE summary row
 * (`BULK_SCREEN_ACTION`).
 *
 * Never a silent partial failure: every requested id comes back with
 * `sent` / `skipped` (with a reason) / `failed` (with a reason).
 */
import { Body, Controller, HttpException, HttpStatus, Post, Request, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AppRole } from '@cms/database';

import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RbacGuard } from '../../auth/rbac.guard';
import { RequireRoles } from '../../auth/roles.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../realtime/redis.service';
import { WebsocketSignerService } from '../../security/websocket-signer.service';
import { DisplayService, DisplayActionUnsupportedError, DISPLAY_EMERGENCY_HOLD_CODE } from '../../display/display.service';
import { runDisplayControl } from '../../display/display.controller';
import { silentUpdateReadiness } from '../../player-ota/auto-update-policy';
import { overrideToMode } from '../../player-ota/auto-update-report';
import { resolveLatestReleaseInfo } from '../../player-ota/player-ota.controller';
import { screenScopeOf } from '../../user-scope/user-scope.context';
import { assertSupportReach } from '../../support-access/support-access.context';
import { recordPushDeployment } from '../deployment-record';
import { armScreenApkUpdate, newCorrId, publishScreenRefresh, setScreenAutoUpdateMode } from '../screen-commands';
import {
  BULK_DEFAULT_CONCURRENCY,
  BULK_OTA_CONCURRENCY,
  BulkInputError,
  REASON_MESSAGE,
  mapWithConcurrency,
  mergeTargetIds,
  parseAutoUpdateMode,
  parseBulkTargets,
  parsePowerState,
  summarize,
  updateDecision,
  type BulkAction,
  type BulkBody,
  type BulkReason,
  type BulkScreenResult,
} from './bulk-screen-actions';

interface BulkScreenRow {
  id: string;
  name: string | null;
  tenantId: string;
  screenGroupId: string | null;
  playerVersion: string | null;
  playerVersionCode: number | null;
  autoUpdatePlayerOverride: boolean | null;
  displayCapabilities: unknown;
  lastPushConnectedAt: Date | null;
}

interface Resolved {
  tenantId: string;
  dryRun: boolean;
  screenGroupId: string | null;
  /** Every id the request named (group expanded), in order. */
  ids: string[];
  /** In-tenant, in-scope screens, in request order. */
  targets: BulkScreenRow[];
  /** Requested ids that are refused up front (not-found / out-of-scope). */
  refused: BulkScreenResult[];
}

export interface BulkResponse {
  action: BulkAction;
  dryRun: boolean;
  corrId: string | null;
  summary: ReturnType<typeof summarize>;
  results: BulkScreenResult[];
  /** update only */
  latestPlayerVersion?: string | null;
}

const ADMIN_ROLES = [AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN] as const;

const skip = (row: { id: string; name: string | null }, reason: BulkReason, extra: Partial<BulkScreenResult> = {}): BulkScreenResult => ({
  screenId: row.id, name: row.name, outcome: 'skipped', reason, message: REASON_MESSAGE[reason], ...extra,
});
const fail = (row: { id: string; name: string | null }, reason: BulkReason, extra: Partial<BulkScreenResult> = {}): BulkScreenResult => ({
  screenId: row.id, name: row.name, outcome: 'failed', reason, message: REASON_MESSAGE[reason], ...extra,
});
const sent = (row: { id: string; name: string | null }, extra: Partial<BulkScreenResult> = {}): BulkScreenResult => ({
  screenId: row.id, name: row.name, outcome: 'sent', ...extra,
});

@Controller('api/v1/screens')
export class ScreensBulkController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly signer: WebsocketSignerService,
    private readonly display: DisplayService,
  ) {}

  /** The newest published Player version. Best-effort: null = unknown. Overridable in specs. */
  protected async latestPlayerVersion(): Promise<string | null> {
    try {
      return (await resolveLatestReleaseInfo())?.versionName ?? null;
    } catch {
      return null;
    }
  }

  // ─── Resync ───────────────────────────────────────────────────────────
  @UseGuards(JwtAuthGuard, RbacGuard)
  @Post('bulk/resync')
  @RequireRoles(...ADMIN_ROLES)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async resync(@Request() req: any, @Body() body: BulkBody): Promise<BulkResponse> {
    const r = await this.resolve(req, body);
    if (r.dryRun) {
      return this.respond('resync', r, null, r.targets.map((t) => sent(t)));
    }
    const corrId = newCorrId('rw-bulk');
    // ONE instant for the whole push: the value every target is stamped with,
    // the Deployment row records, and each player echoes back to ack (rule 6 —
    // identity, never a clock comparison).
    const value = new Date();
    // Spread a many-screen reload like the tenant-wide push does, so N kiosks
    // never hit the web origin and the API in the same second.
    const jitterMs = r.targets.length > 1 ? 8000 : 0;
    const requestedBy = req.user.userId || req.user.id || null;
    const published = await mapWithConcurrency(r.targets, BULK_DEFAULT_CONCURRENCY, (t) =>
      publishScreenRefresh({ signer: this.signer, redis: this.redisService }, t, { requestedBy, corrId, jitterMs }),
    );
    // The durable ride (manifest `refreshRequestedAt`) — one deployment for
    // the whole push, so the convergence card tracks it as one thing.
    if (r.targets.length > 0) {
      await recordPushDeployment(this.prisma, {
        tenantId: r.tenantId,
        targetTenantIds: [r.tenantId],
        createdById: req.user.id ?? null,
        value,
        corrId,
        scope: 'screen',
        screenIds: r.targets.map((t) => t.id),
        label: `Resync · ${r.targets.length} screen${r.targets.length === 1 ? '' : 's'}`,
      });
    }
    // Read the durable stamp back: a screen is `sent` when EITHER path left —
    // the realtime publish or the manifest flag. Neither → failed, named.
    const stamped = new Set<string>();
    if (r.targets.length > 0) {
      const rows = await this.prisma.client.screen.findMany({
        where: { id: { in: r.targets.map((t) => t.id) }, tenantId: r.tenantId },
        select: { id: true, pendingRefreshAt: true } as any,
      }).catch(() => [] as any[]);
      for (const row of rows as any[]) {
        if (row.pendingRefreshAt && new Date(row.pendingRefreshAt).getTime() === value.getTime()) stamped.add(row.id);
      }
    }
    const results = await mapWithConcurrency(r.targets, BULK_DEFAULT_CONCURRENCY, async (t, i) => {
      const ok = published[i] || stamped.has(t.id);
      await this.audit({
        action: 'REFRESH_WEB', targetId: t.id, tenantId: r.tenantId, userId: req.user.id,
        details: { scope: 'screen', screenName: t.name, corrId, bulk: true, outcome: ok ? 'sent' : 'failed', realtime: published[i], durable: stamped.has(t.id) },
      });
      return ok ? sent(t) : fail(t, 'not-delivered');
    });
    return this.finish(req, 'resync', r, corrId, results);
  }

  // ─── Send Player update ───────────────────────────────────────────────
  @UseGuards(JwtAuthGuard, RbacGuard)
  @Post('bulk/update')
  @RequireRoles(...ADMIN_ROLES)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async update(@Request() req: any, @Body() body: BulkBody): Promise<BulkResponse> {
    const r = await this.resolve(req, body);
    // Only ask GitHub when a target has a Player version to grade against it.
    const latest = r.targets.some((t) => !!t.playerVersion) ? await this.latestPlayerVersion() : null;
    const prompts = await this.installPromptMap(r);
    const plan = r.targets.map((t) => ({ t, d: updateDecision(t.playerVersion, latest) }));
    if (r.dryRun) {
      const results = plan.map(({ t, d }) => (d.send ? sent(t, { installPrompt: prompts.get(t.id) }) : skip(t, d.reason)));
      return { ...this.respond('update', r, null, results), latestPlayerVersion: latest };
    }
    const corrId = newCorrId('ota-bulk');
    const requestedBy = req.user.userId || req.user.id || null;
    // Bounded: each push is a DB write + a signed publish; 500 at once would
    // queue the whole pool behind one click.
    const results = await mapWithConcurrency(plan, BULK_OTA_CONCURRENCY, async ({ t, d }) => {
      if (!d.send) return skip(t, d.reason);
      try {
        const pushed = await armScreenApkUpdate(
          { prisma: this.prisma, signer: this.signer, redis: this.redisService },
          t,
          { requestedBy, corrId, overrideWindow: false },
        );
        await this.audit({
          action: 'FORCE_APK_UPDATE', targetId: t.id, tenantId: r.tenantId, userId: req.user.id,
          details: { scope: 'screen', screenName: t.name, corrId, bulk: true, armed: pushed.armed, published: pushed.published },
        });
        // The armed flag IS the push (the screen's own update-check reads it);
        // the realtime nudge only makes it sooner.
        return pushed.armed ? sent(t, { installPrompt: prompts.get(t.id) }) : fail(t, 'not-delivered');
      } catch (e) {
        return fail(t, 'error', { message: (e as Error)?.message || REASON_MESSAGE.error });
      }
    });
    return { ...(await this.finish(req, 'update', r, corrId, results, { latestPlayerVersion: latest })), latestPlayerVersion: latest };
  }

  // ─── Turn panels on / off ─────────────────────────────────────────────
  @UseGuards(JwtAuthGuard, RbacGuard)
  @Post('bulk/power')
  @RequireRoles(...ADMIN_ROLES)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async power(@Request() req: any, @Body() body: BulkBody): Promise<BulkResponse> {
    const state = this.input(() => parsePowerState(body?.state));
    const r = await this.resolve(req, body);
    if (r.dryRun) return this.respond('power', r, null, r.targets.map((t) => sent(t)));
    const action = state === 'on' ? 'POWER_ON' : 'POWER_OFF';
    const corrId = newCorrId('pwr-bulk');
    const results = await mapWithConcurrency(r.targets, BULK_DEFAULT_CONCURRENCY, async (t) => {
      try {
        // The single-screen implementation: emergency interlock first, then
        // the capability gate, then the audited dispatch (DisplayService
        // writes the per-screen DISPLAY_CONTROL audit row, refusals included).
        const res = await runDisplayControl(
          { prisma: this.prisma, display: this.display },
          t,
          { userId: req.user?.id ?? req.user?.userId ?? null },
          { action, reason: `bulk ${corrId}` } as any,
        );
        if (res.delivered === false) {
          return fail(t, res.deliveryReason === 'no_push_socket' ? 'no-live-connection' : 'not-delivered', { code: res.deliveryReason ?? undefined });
        }
        return sent(t);
      } catch (e) {
        if (e instanceof DisplayActionUnsupportedError) {
          const reason: BulkReason = e.code === DISPLAY_EMERGENCY_HOLD_CODE ? 'emergency-hold' : 'unsupported';
          return skip(t, reason, { code: e.code, message: e.message });
        }
        return fail(t, 'error', { message: (e as Error)?.message || REASON_MESSAGE.error });
      }
    });
    return this.finish(req, 'power', r, corrId, results, { state });
  }

  // ─── Automatic Player updates: on / off / inherit ─────────────────────
  @UseGuards(JwtAuthGuard, RbacGuard)
  @Post('bulk/auto-update')
  @RequireRoles(...ADMIN_ROLES)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async autoUpdate(@Request() req: any, @Body() body: BulkBody): Promise<BulkResponse> {
    const mode = this.input(() => parseAutoUpdateMode(body?.mode));
    const r = await this.resolve(req, body);
    const plan = r.targets.map((t) => ({ t, unchanged: overrideToMode(t.autoUpdatePlayerOverride) === mode }));
    if (r.dryRun) {
      return this.respond('auto-update', r, null, plan.map(({ t, unchanged }) => (unchanged ? skip(t, 'unchanged') : sent(t))));
    }
    const corrId = newCorrId('au-bulk');
    const results = await mapWithConcurrency(plan, BULK_DEFAULT_CONCURRENCY, async ({ t, unchanged }) => {
      if (unchanged) return skip(t, 'unchanged');
      try {
        const done = await setScreenAutoUpdateMode(this.prisma, {
          tenantId: r.tenantId, screenId: t.id, mode, userId: req.user.id, auditExtra: { corrId, bulk: true },
        });
        return done ? sent(t) : skip(t, 'not-found');
      } catch (e) {
        return fail(t, 'error', { message: (e as Error)?.message || REASON_MESSAGE.error });
      }
    });
    return this.finish(req, 'auto-update', r, corrId, results, { mode });
  }

  // ─── shared ───────────────────────────────────────────────────────────

  private input<T>(fn: () => T): T {
    try {
      return fn();
    } catch (e) {
      if (e instanceof BulkInputError) throw new HttpException({ code: e.code, message: e.message }, e.status);
      throw e;
    }
  }

  /**
   * Which screens this request may act on. Every read carries the caller's
   * active tenant; a scoped person is narrowed to their screens.
   */
  private async resolve(req: any, body: BulkBody): Promise<Resolved> {
    const tenantId: string | undefined = req.user?.tenantId;
    if (!tenantId) {
      throw new HttpException({ code: 'SCREEN_NO_TENANT_CONTEXT', message: 'No tenant context' }, HttpStatus.BAD_REQUEST);
    }
    await assertSupportReach(req.user, tenantId); // SUPPORT ACCESS (2026-10-11)
    const parsed = this.input(() => parseBulkTargets(body));

    let groupIds: string[] = [];
    if (parsed.screenGroupId) {
      const group = await this.prisma.client.screenGroup.findFirst({
        where: { id: parsed.screenGroupId, tenantId },
        select: { id: true },
      });
      if (!group) {
        throw new HttpException({ code: 'SCREEN_GROUP_NOT_FOUND', message: 'Screen group not found' }, HttpStatus.NOT_FOUND);
      }
      const members = await this.prisma.client.screen.findMany({
        where: { tenantId, screenGroupId: group.id },
        select: { id: true },
        orderBy: { name: 'asc' },
      });
      groupIds = members.map((m) => m.id);
    }
    const ids = this.input(() => mergeTargetIds(parsed.screenIds, groupIds));

    const rows = (await this.prisma.client.screen.findMany({
      where: { id: { in: ids }, tenantId },
      select: {
        id: true, name: true, tenantId: true, screenGroupId: true,
        playerVersion: true, playerVersionCode: true, autoUpdatePlayerOverride: true,
        displayCapabilities: true, lastPushConnectedAt: true,
      } as any,
    })) as unknown as BulkScreenRow[];
    const byId = new Map(rows.map((row) => [row.id, row]));
    const scope = screenScopeOf(req);
    const inScope = scope ? new Set(scope.screenIds) : null;

    const targets: BulkScreenRow[] = [];
    const refused: BulkScreenResult[] = [];
    for (const id of ids) {
      const row = byId.get(id);
      // Another tenant's id is indistinguishable from a made-up one.
      if (!row) refused.push(skip({ id, name: null }, 'not-found'));
      else if (inScope && !inScope.has(id)) refused.push(skip({ id, name: null }, 'out-of-scope'));
      else targets.push(row);
    }
    return { tenantId, dryRun: parsed.dryRun, screenGroupId: parsed.screenGroupId, ids, targets, refused };
  }

  /** screenId → true when Android will show an Install prompt (not armed for silent install). */
  private async installPromptMap(r: Resolved): Promise<Map<string, boolean>> {
    const out = new Map<string, boolean>();
    if (r.targets.length === 0) return out;
    const inv: any[] = await (this.prisma.client as any).screenDeviceInventory.findMany({
      where: { tenantId: r.tenantId, screenId: { in: r.targets.map((t) => t.id) } },
      select: { screenId: true, report: true },
    }).catch(() => []);
    const by = new Map(inv.map((row) => [row.screenId, row.report]));
    for (const t of r.targets) {
      out.set(t.id, silentUpdateReadiness(by.get(t.id) ?? null, t.playerVersionCode).readiness !== 'silent');
    }
    return out;
  }

  /** Every requested id once, in the order it was asked for. */
  private order(r: Resolved, results: BulkScreenResult[]): BulkScreenResult[] {
    const idx = new Map(r.ids.map((id, i) => [id, i] as const));
    return [...results, ...r.refused].sort((a, b) => (idx.get(a.screenId) ?? 0) - (idx.get(b.screenId) ?? 0));
  }

  private respond(action: BulkAction, r: Resolved, corrId: string | null, results: BulkScreenResult[]): BulkResponse {
    const all = this.order(r, results);
    return { action, dryRun: r.dryRun, corrId, summary: summarize(all), results: all };
  }

  private async finish(
    req: any,
    action: BulkAction,
    r: Resolved,
    corrId: string,
    results: BulkScreenResult[],
    params: Record<string, unknown> = {},
  ): Promise<BulkResponse> {
    const out = this.respond(action, r, corrId, results);
    const failedIds = out.results.filter((x) => x.outcome !== 'sent').slice(0, 200).map((x) => ({ id: x.screenId, outcome: x.outcome, reason: x.reason }));
    await this.audit({
      action: 'BULK_SCREEN_ACTION',
      targetType: r.screenGroupId ? 'screen_group' : 'tenant',
      targetId: r.screenGroupId ?? r.tenantId,
      tenantId: r.tenantId,
      userId: req.user.id,
      details: { action, corrId, ...params, screenGroupId: r.screenGroupId, ...out.summary, notSent: failedIds },
    });
    return out;
  }

  /** Audit is best-effort, like every per-screen command's own audit row. */
  private async audit(row: { action: string; targetType?: string; targetId: string; tenantId: string; userId: string | null; details: Record<string, unknown> }) {
    await this.prisma.client.auditLog.create({
      data: {
        action: row.action,
        targetType: row.targetType ?? 'screen',
        targetId: row.targetId,
        tenantId: row.tenantId,
        userId: row.userId,
        details: JSON.stringify(row.details),
      },
    }).catch((e: unknown) => {
      console.warn(`[bulk-screens] audit ${row.action} failed for ${row.targetId}: ${(e as Error)?.message}`);
    });
  }
}
