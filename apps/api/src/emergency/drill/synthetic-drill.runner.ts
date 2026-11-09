/**
 * SYNTHETIC EMERGENCY DRILL — the runner (2026-11-01).
 *
 * Design: docs/governance/decisions/2026-10-31-synthetic-emergency-drill-design.md
 * (§1–§8, as modified by the lead's §9 and the owner's §10). CHANGE class on
 * the life-safety path: this file adds NO trigger path — no route, no button,
 * no webhook, no token. It is an in-process timer that calls the emergency
 * controller's OWN `triggerEmergency` / `clearEmergency` / `broadcastText` /
 * `clearMessage` (resolved through `ModuleRef`; the controller is untouched)
 * on bench screens of INTERNAL organisations only, reads back the paint
 * evidence the render-proof handler records for every screen in the fleet,
 * and writes its verdict as append-only `audit_logs` rows.
 *
 * ONE TICK (every minute, leader-leased; no Redis = no drill):
 *   orphan sweep → which listed displays have a local slot due (each screen's
 *   OWN time zone, default 10:30) → for each, serially: a device-scoped
 *   OVERRIDE drill, then a pushed-message (TEXT_BROADCAST) drill, then — where
 *   a bench DISTRICT exists — a district-copy drill → one owner email listing
 *   every FAIL / INCONCLUSIVE (modes alert / on) → the daily dead-man check.
 *
 * ONE RUN: guards (all five, fresh) → the service identity → STARTED row →
 * the guards that can change re-checked → dispatch → link 1 (+5 s) → link 2
 * (to +135 s) → the all-clear in `finally` (by +150 s, on EVERY exit) → link 3
 * (clear + 150 s) → RESULT row. Three releases protect the glass: the payload
 * expires at +180 s, the all-clear in `finally`, and the orphan sweep.
 *
 * IN DOUBT: NEVER TRIGGER, ALWAYS CLEAR.
 *
 * Kill switches (subtractive): EMERGENCY_DRILL_CRON_DISABLED=1 beats
 * everything; EMERGENCY_DRILL_SCREENS unset = the job does nothing;
 * EMERGENCY_DRILL_MODE=off. Off under NODE_ENV=test.
 */
import { HttpException, Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { randomUUID } from 'crypto';
import { ClearEmergencyInputSchema, overrideAlertPaintIdentity } from '@cms/api-types';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../realtime/redis.service';
import { LEASE, LeaderLeaseService, leadThisTick, type LeaseStatus } from '../../realtime/leader-lease.service';
import { PlatformAlertMailer } from '../../email/platform-alert-mailer.service';
import { degradedPlatformComponents } from '../../health/platform-degradation';
import { CustomerAlertEmailsService } from '../../notifications/customer-alerts/customer-alert-emails.service';
import { intendedDowntime } from '../../notifications/customer-alerts/customer-alert-policy';
import { manifestTimeZone } from '../../screens/screen-time-zone';
import { EmergencyController } from '../emergency.controller';
import { DRILL_BLOCKED_CODE } from '../emergency-drill';
import { collectDescendantTenantIds, resolveRootTenantId } from '../tenant-hierarchy';
import { readDrillConfig, type DrillConfig } from './synthetic-drill.config';
import {
  DAILY_SCREEN_KINDS,
  DRILL_RESULT_ACTION,
  DRILL_RUNNER_CREATED_ACTION,
  DRILL_RUNNER_FIRST_NAME,
  DRILL_RUNNER_LAST_NAME,
  DRILL_RUNNER_NO_PASSWORD,
  DRILL_RUNNER_ROLE,
  DRILL_RUNNER_STATUS,
  DRILL_SEVERITY,
  DRILL_STARTED_ACTION,
  DRILL_SWEPT_ACTION,
  DRILL_TIMING,
  DrillResultDetailsSchema,
  DrillStartedDetailsSchema,
  DrillSweptDetailsSchema,
  PLAYER_NO_PAINT_ACTION,
  PLAYER_PAINTED_ACTION,
  benchDistrictEligible,
  buildBroadcastDrillBody,
  buildDistrictCopyBody,
  buildOverrideDrillBody,
  deadManGaps,
  drillHardwareClass,
  drillRunnerEmail,
  drillTypeFor,
  dueSlots,
  evaluateDrillGuards,
  gradeRun,
  link1Settled,
  link2Settled,
  link3Settled,
  liveAlertOnPanes,
  orphanRuns,
  runnerIdentityProblem,
  runnerPrincipal,
  tickEmailKey,
  unitPaneIds,
  verdictAlertsOwner,
  type DrillKind,
  type DrillResultDetails,
  type DrillStartedDetails,
  type DrillType,
  type DrillVerdict,
  type DueSlot,
  type ExpectedIdentity,
  type FailedLink,
  type GradeInput,
  type GuardPane,
  type GuardVerdict,
  type PaneGrade,
  type PaneSample,
  type PaneTransition,
  type RunnerUserRow,
} from './synthetic-drill.policy';
import {
  clearRunInFlight,
  isRunInFlightHere,
  markRunInFlight,
  mintDrillOverrideId,
} from './synthetic-drill.registry';
import {
  renderDeadManEmail,
  renderIdentityProblemEmail,
  renderNotInternalEmail,
  renderTickEmail,
  type DrillEmailRun,
} from './synthetic-drill.copy';

const SEC = 1_000;
const MIN = 60 * SEC;
const TICK_MS = MIN;
const BOOT_SWEEP_DELAY_MS = 2 * MIN;
/** A slot attempt that was SKIPPED (guards) may be retried this much later, inside the slot's grace. */
const SKIP_RETRY_S = 30 * 60;
const CLAIM_TTL_S = 3 * 24 * 60 * 60;
const KEY = 'venueos:emergency-drill:v1';

/** The controller methods the runner calls — `EmergencyController`'s own, in-process. */
export interface DrillEmergencyPort {
  triggerEmergency(body: unknown, req: unknown): Promise<unknown>;
  clearEmergency(overrideId: string, body: unknown, req: unknown): Promise<unknown>;
  broadcastText(body: unknown, req: unknown): Promise<unknown>;
  clearMessage(messageId: string, req: unknown): Promise<unknown>;
}

export interface DrillRunResult {
  runId: string;
  kind: DrillKind;
  verdict: DrillVerdict;
  reason: string;
  failedLink: FailedLink | null;
  /** The display named (override / broadcast); null for a district-copy run. */
  screenId: string | null;
  rootTenantId: string | null;
  label: string;
  slot: string;
  type: DrillType | null;
  paneIds: string[];
  panes: PaneGrade[];
  overrideId: string | null;
  messageId: string | null;
  dispatchAtMs: number | null;
  clearAtMs: number | null;
  cleared: boolean | null;
  alerted: boolean;
}

export interface DrillTickReport {
  status: 'disabled' | 'busy' | 'not-leader' | 'no-redis' | 'ran' | 'error';
  results: DrillRunResult[];
  swept: number;
  emailed: boolean;
}

const PANE_SELECT = {
  id: true,
  name: true,
  tenantId: true,
  status: true,
  pairedAt: true,
  lastPingAt: true,
  lastRenderedHash: true,
  lastRenderedAt: true,
  faceOfScreenId: true,
  screenGroupId: true,
  hardwareModel: true,
  displayCapabilities: true,
  playerVersion: true,
  timezone: true,
  latitude: true,
  longitude: true,
  screenGroup: { select: { latitude: true, longitude: true } },
  tenant: { select: { timezone: true, latitude: true, longitude: true } },
} as const;

interface PaneRow extends GuardPane {
  name: string;
  faceOfScreenId: string | null;
  screenGroupId: string | null;
  hardwareModel: string | null;
  displayCapabilities: unknown;
  playerVersion: string | null;
  timezone: string | null;
  latitude: number | null;
  longitude: number | null;
  screenGroup: { latitude: number | null; longitude: number | null } | null;
  tenant: { timezone: string | null; latitude: number | null; longitude: number | null } | null;
}

const RUNNER_SELECT = {
  id: true,
  tenantId: true,
  email: true,
  role: true,
  status: true,
  passwordHash: true,
  canTriggerPanic: true,
  deletedAt: true,
} as const;

interface PlanItem {
  kind: DrillKind;
  /** override / broadcast: the display named. */
  screenId: string | null;
  /** district-copy: the bench district root. */
  rootTenantId: string | null;
  due: DueSlot;
  type: DrillType | null;
  label: string;
}

/** An internal root whose whole subtree is listed bench glass (§9.2). */
interface BenchDistrict {
  rootTenantId: string;
  label: string;
  paneIds: string[];
  tenantIds: string[];
}

interface Plan {
  items: PlanItem[];
  displays: Array<{ screenId: string; label: string }>;
  districtRoots: Array<{ rootTenantId: string; label: string }>;
  benchTenantIds: string[];
}

type Dispatched =
  | { status: 'sent'; messageId: string | null }
  | { status: 'refused'; liveAlert: boolean; reason: string }
  | { status: 'unknown'; reason: string };

function errorText(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  return msg.replace(/\s+/g, ' ').slice(0, 160);
}

/** Resolve within `ms`, or report a time-out — never throws. */
async function bounded<T>(p: Promise<T>, ms: number): Promise<{ ok: true; value: T } | { ok: false; timedOut: boolean; error: unknown }> {
  let timer: NodeJS.Timeout | null = null;
  try {
    const timeout = new Promise<{ ok: false; timedOut: true; error: unknown }>((resolve) => {
      timer = setTimeout(() => resolve({ ok: false, timedOut: true, error: new Error('timed out') }), ms);
      timer.unref?.();
    });
    return await Promise.race([p.then((value) => ({ ok: true as const, value })), timeout]);
  } catch (error) {
    return { ok: false, timedOut: false, error };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

@Injectable()
export class SyntheticDrillRunner implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SyntheticDrillRunner.name);
  private timer: NodeJS.Timeout | null = null;
  private bootTimer: NodeJS.Timeout | null = null;
  private running = false;
  private destroyed = false;
  /** The lease term the current tick runs under (null when driven by hand). */
  private term: LeaseStatus | null = null;
  private readonly notInternalAlerted = new Set<string>();
  private readonly identityAlerted = new Set<string>();
  private readonly noZoneWarned = new Set<string>();
  private districtCache: { atMs: number; key: string; value: BenchDistrict[] } | null = null;
  private readonly rootCache = new Map<string, { atMs: number; rootId: string }>();

  /** Seams for tests. */
  now: () => number = () => Date.now();
  sleep: (ms: number) => Promise<void> = (ms) =>
    new Promise((resolve) => {
      const t = setTimeout(resolve, Math.max(0, ms));
      t.unref?.();
    });
  config: () => DrillConfig = () => readDrillConfig(process.env);

  constructor(
    private readonly prisma: PrismaService,
    private readonly moduleRef: ModuleRef,
    @Optional() private readonly redis?: RedisService,
    @Optional() private readonly lease?: LeaderLeaseService,
    @Optional() private readonly mailer?: PlatformAlertMailer,
    @Optional() private readonly alerts?: CustomerAlertEmailsService,
  ) {}

  onModuleInit(): void {
    const cfg = this.config();
    for (const e of cfg.errors) this.logger.error(`[synthetic-drill] ${e}`);
    if (!cfg.enabled) {
      this.logger.log(`[synthetic-drill] off (${cfg.disabledReason})`);
      return;
    }
    this.logger.log(
      `[synthetic-drill] on: mode=${cfg.mode} screens=${cfg.screenIds.length} slots=${cfg.slots.map((s) => s.label).join(',') || 'NONE (schedule invalid)'} (each screen's own time zone)`,
    );
    this.timer = setInterval(() => void this.tick().catch(() => undefined), TICK_MS);
    this.timer.unref?.();
    this.bootTimer = setTimeout(() => void this.bootSweep().catch(() => undefined), BOOT_SWEEP_DELAY_MS);
    this.bootTimer.unref?.();
  }

  onModuleDestroy(): void {
    this.destroyed = true;
    if (this.timer) clearInterval(this.timer);
    if (this.bootTimer) clearTimeout(this.bootTimer);
    this.timer = null;
    this.bootTimer = null;
  }

  // ═════════════════════════════════════════════════════════════════════
  // The tick
  // ═════════════════════════════════════════════════════════════════════

  async tick(): Promise<DrillTickReport> {
    const report: DrillTickReport = { status: 'ran', results: [], swept: 0, emailed: false };
    const cfg = this.config();
    if (!cfg.enabled) return { ...report, status: 'disabled' };
    if (this.running) return { ...report, status: 'busy' };
    this.running = true;
    try {
      const status = await leadThisTick(this.lease, LEASE.EMERGENCY_DRILL);
      if (!status.leader) return { ...report, status: 'not-leader' };
      // No Redis, no drill: the realtime path is what a drill proves, and a
      // degraded lease is no proof that another replica is not drilling too.
      if (status.degraded || !this.redisConnected()) return { ...report, status: 'no-redis' };
      this.term = status;
      const plan = await this.plan(cfg);
      report.swept = await this.sweepOrphans(plan.benchTenantIds);
      for (const item of plan.items) {
        if (!this.stillLeading()) break;
        if (!(await this.claimSlot(item))) continue;
        const result =
          item.kind === 'district-copy'
            ? await this.runDistrictCopy(item.rootTenantId as string, { slot: item.due.key, label: item.label })
            : await this.runOnce(item.screenId as string, {
                kind: item.kind,
                slot: item.due.key,
                type: item.type ?? undefined,
                label: item.label,
              });
        await this.settleSlot(item, result);
        report.results.push(result);
      }
      report.emailed = await this.emailTick(cfg, report.results);
      if (this.stillLeading()) await this.deadManCheck(cfg, plan);
      return report;
    } catch (e) {
      this.logger.warn(`[synthetic-drill] tick failed: ${errorText(e)}`);
      return { ...report, status: 'error' };
    } finally {
      this.term = null;
      this.running = false;
    }
  }

  /** The boot sweep (boot + 2 min): leased, Redis required, like the tick. */
  async bootSweep(): Promise<number> {
    const cfg = this.config();
    if (!cfg.enabled || this.running) return 0;
    const status = await leadThisTick(this.lease, LEASE.EMERGENCY_DRILL);
    if (!status.leader || status.degraded || !this.redisConnected()) return 0;
    const screens = await this.prisma.client.screen.findMany({
      where: { id: { in: [...cfg.screenIds] } },
      select: { tenantId: true },
    });
    const tenantIds = [...new Set(screens.map((s) => s.tenantId).filter((t): t is string => !!t))];
    const roots = await Promise.all(tenantIds.map((t) => resolveRootTenantId(this.prisma.client.tenant as never, t).catch(() => t)));
    return this.sweepOrphans([...new Set([...tenantIds, ...roots])]);
  }

  // ═════════════════════════════════════════════════════════════════════
  // One run on one display (override or pushed message)
  // ═════════════════════════════════════════════════════════════════════

  /**
   * Drill the display `screenId` names. GUARD 1 IS HERE: an id that is not in
   * EMERGENCY_DRILL_SCREENS is refused before anything is read or written, so
   * no caller can point a drill at any other screen.
   */
  async runOnce(
    screenId: string,
    opts: { kind: 'override' | 'broadcast'; slot: string; type?: DrillType; label?: string },
  ): Promise<DrillRunResult> {
    const cfg = this.config();
    const runId = randomUUID();
    const result = this.emptyResult(runId, opts.kind, opts.slot, screenId, opts.label ?? screenId);
    if (!cfg.enabled) return { ...result, verdict: 'SKIPPED', reason: `disabled:${cfg.disabledReason}` };
    if (!cfg.screenIds.includes(screenId)) return { ...result, verdict: 'SKIPPED', reason: 'guard1:not-listed' };
    if (cfg.slots.length === 0) return { ...result, verdict: 'SKIPPED', reason: 'schedule-invalid' };

    // ── The display, fresh ──
    const display = await this.loadDisplay(screenId).catch(() => null);
    if (!display) return { ...result, verdict: 'SKIPPED', reason: 'display-unreadable' };
    const { named, panes, paneIds, rootTenantId, rootInternal } = display;
    const tenantId = named.tenantId as string;
    result.label = opts.label ?? named.name;
    result.rootTenantId = rootTenantId;
    result.paneIds = paneIds;

    // ── Guard 2 first: a non-internal organisation gets no row and no identity ──
    if (rootInternal !== true) {
      await this.alertNotInternal(screenId, rootTenantId);
      this.logger.warn(`[synthetic-drill] ${screenId}: refused — organisation ${rootTenantId ?? '?'} is not internal (guard 2)`);
      return { ...result, verdict: 'SKIPPED', reason: rootInternal === null ? 'guard2:root-unreadable' : 'guard2:root-not-internal' };
    }

    // ── The service identity (§9.1) ──
    const runner = await this.ensureRunnerIdentity(tenantId);
    if (!runner.ok) {
      await this.alertIdentity(tenantId, runner.problem);
      return { ...result, verdict: 'SKIPPED', reason: `runner-identity:${runner.problem}` };
    }
    const principal = runnerPrincipal(runner.user.id, tenantId);

    // ── Guards 1–5, fresh, right before dispatch ──
    const guard = await this.evaluateGuards(cfg, panes, [{ id: rootTenantId as string, isInternal: rootInternal }]);
    if (!guard.ok) {
      const skipped = { ...result, verdict: 'SKIPPED' as const, reason: `guard${guard.guard}:${guard.reason}${guard.paneId ? `:${guard.paneId}` : ''}` };
      await this.writeResult(tenantId, runner.user.id, skipped, cfg, named);
      return skipped;
    }

    const type: DrillType = opts.type ?? drillTypeFor(Math.floor(this.now() / (24 * 60 * MIN)), 0, 1);
    const overrideId = opts.kind === 'override' ? mintDrillOverrideId(this.now()) : null;
    const expected: ExpectedIdentity =
      opts.kind === 'override'
        ? { rule: 'identity', identity: overrideAlertPaintIdentity({ type, severity: DRILL_SEVERITY, isDrill: true }) }
        : { rule: 'first-painted' };
    result.type = opts.kind === 'override' ? type : null;
    result.overrideId = overrideId;

    // ── STARTED: no row written → nothing dispatched ──
    const dispatchPlanAt = this.now();
    const started: DrillStartedDetails = {
      v: 1,
      runId,
      kind: opts.kind,
      overrideId,
      slot: opts.slot,
      mode: cfg.mode,
      type: result.type,
      screenId,
      paneIds,
      hardwareModel: named.hardwareModel ?? null,
      deviceClass: drillHardwareClass(named),
      playerVersion: named.playerVersion ?? null,
      dispatchAt: new Date(dispatchPlanAt).toISOString(),
      expiresAt: new Date(dispatchPlanAt + DRILL_TIMING.EXPIRES_AFTER_S * SEC).toISOString(),
      runnerUserId: runner.user.id,
      rootTenantId: rootTenantId as string,
    };
    if (!(await this.writeStarted(tenantId, runner.user.id, 'Screen', screenId, started))) {
      return { ...result, verdict: 'SKIPPED', reason: 'audit-unwritable' };
    }
    markRunInFlight(runId, paneIds, this.now());
    try {
      // The guards that can move in the last few hundred ms: still listed,
      // root still internal (fresh), realtime still up.
      const recheck = await this.recheckBeforeDispatch(screenId, tenantId);
      if (recheck) {
        const skipped = { ...result, verdict: 'SKIPPED' as const, reason: recheck };
        await this.writeResult(tenantId, runner.user.id, skipped, cfg, named);
        return skipped;
      }

      const paneTenantIds = [...new Set(panes.map((p) => p.tenantId).filter((t): t is string => !!t))];
      let messageId: string | null = null;
      const outcome = await this.execute({
        paneIds,
        tenantIds: paneTenantIds,
        expected,
        drillOverrideId: overrideId,
        runnerUserId: runner.user.id,
        dispatch: async () => {
          if (opts.kind === 'override') {
            const body = buildOverrideDrillBody({ screenId, type, overrideId: overrideId as string, nowMs: this.now() });
            await this.emergency().triggerEmergency(body, { user: principal });
            return null;
          }
          const body = buildBroadcastDrillBody({ screenId, nowMs: this.now() });
          const res = (await this.emergency().broadcastText(body, { user: principal })) as { messageId?: unknown } | null;
          messageId = typeof res?.messageId === 'string' ? res.messageId : null;
          return messageId;
        },
        clear: async (dispatchAtMs: number) => {
          if (opts.kind === 'override') {
            const body = ClearEmergencyInputSchema.parse({ scopeType: 'device', scopeId: screenId, isDrill: true });
            await this.emergency().clearEmergency(overrideId as string, body, { user: principal });
            return true;
          }
          return this.clearMessages(messageId, runner.user.id, paneTenantIds, dispatchAtMs, principal);
        },
      });
      const final: DrillRunResult = {
        ...result,
        verdict: outcome.verdict,
        reason: outcome.reason,
        failedLink: outcome.failedLink,
        panes: outcome.panes,
        messageId: outcome.messageId ?? messageId,
        dispatchAtMs: outcome.dispatchAtMs,
        clearAtMs: outcome.clearAtMs,
        cleared: outcome.cleared,
      };
      final.alerted = verdictAlertsOwner(cfg.mode, final.verdict);
      await this.writeResult(tenantId, runner.user.id, final, cfg, named, expected);
      return final;
    } finally {
      clearRunInFlight(runId);
    }
  }

  // ═════════════════════════════════════════════════════════════════════
  // The district-copy run (§9.2) — only where a bench district exists
  // ═════════════════════════════════════════════════════════════════════

  async runDistrictCopy(rootTenantId: string, opts: { slot: string; label?: string }): Promise<DrillRunResult> {
    const cfg = this.config();
    const runId = randomUUID();
    const result = this.emptyResult(runId, 'district-copy', opts.slot, null, opts.label ?? rootTenantId);
    result.rootTenantId = rootTenantId;
    if (!cfg.enabled) return { ...result, verdict: 'SKIPPED', reason: `disabled:${cfg.disabledReason}` };
    if (cfg.slots.length === 0) return { ...result, verdict: 'SKIPPED', reason: 'schedule-invalid' };

    const roots = await this.readRoots([rootTenantId]);
    const root = roots[0];
    if (!root || root.isInternal !== true) {
      return { ...result, verdict: 'SKIPPED', reason: root ? 'guard2:root-not-internal' : 'guard2:root-unreadable' };
    }
    const district = await this.analyseDistrict(rootTenantId, cfg).catch(() => null);
    if (!district || !district.eligible) {
      return { ...result, verdict: 'SKIPPED', reason: `no-bench-district:${district?.reason ?? 'unreadable'}` };
    }
    const runner = await this.ensureRunnerIdentity(rootTenantId);
    if (!runner.ok) {
      await this.alertIdentity(rootTenantId, runner.problem);
      return { ...result, verdict: 'SKIPPED', reason: `runner-identity:${runner.problem}` };
    }
    const principal = runnerPrincipal(runner.user.id, rootTenantId);
    const panes = await this.readPanes(district.paneIds, district.tenantIds);
    result.paneIds = district.paneIds;
    const guard = await this.evaluateGuards(cfg, panes, roots);
    if (!guard.ok) {
      const skipped = { ...result, verdict: 'SKIPPED' as const, reason: `guard${guard.guard}:${guard.reason}${guard.paneId ? `:${guard.paneId}` : ''}` };
      await this.writeResult(rootTenantId, runner.user.id, skipped, cfg, null);
      return skipped;
    }
    const dispatchPlanAt = this.now();
    const started: DrillStartedDetails = {
      v: 1,
      runId,
      kind: 'district-copy',
      overrideId: null,
      slot: opts.slot,
      mode: cfg.mode,
      type: null,
      screenId: null,
      paneIds: district.paneIds,
      hardwareModel: null,
      deviceClass: null,
      playerVersion: null,
      dispatchAt: new Date(dispatchPlanAt).toISOString(),
      expiresAt: new Date(dispatchPlanAt + DRILL_TIMING.EXPIRES_AFTER_S * SEC).toISOString(),
      runnerUserId: runner.user.id,
      rootTenantId,
    };
    if (!(await this.writeStarted(rootTenantId, runner.user.id, 'Tenant', rootTenantId, started))) {
      return { ...result, verdict: 'SKIPPED', reason: 'audit-unwritable' };
    }
    markRunInFlight(runId, district.paneIds, this.now());
    try {
      const again = await this.readRoots([rootTenantId]);
      if (again[0]?.isInternal !== true || !this.redisConnected() || !this.config().enabled) {
        const skipped = { ...result, verdict: 'SKIPPED' as const, reason: 'recheck-failed' };
        await this.writeResult(rootTenantId, runner.user.id, skipped, cfg, null);
        return skipped;
      }
      let messageId: string | null = null;
      const outcome = await this.execute({
        paneIds: district.paneIds,
        tenantIds: district.tenantIds,
        expected: { rule: 'first-painted' },
        drillOverrideId: null,
        runnerUserId: runner.user.id,
        dispatch: async () => {
          const res = (await this.emergency().broadcastText(buildDistrictCopyBody({ rootTenantId, nowMs: this.now() }), { user: principal })) as
            | { messageId?: unknown }
            | null;
          messageId = typeof res?.messageId === 'string' ? res.messageId : null;
          return messageId;
        },
        clear: (dispatchAtMs: number) => this.clearMessages(messageId, runner.user.id, district.tenantIds, dispatchAtMs, principal),
      });
      const final: DrillRunResult = {
        ...result,
        verdict: outcome.verdict,
        reason: outcome.reason,
        failedLink: outcome.failedLink,
        panes: outcome.panes,
        messageId: outcome.messageId ?? messageId,
        dispatchAtMs: outcome.dispatchAtMs,
        clearAtMs: outcome.clearAtMs,
        cleared: outcome.cleared,
      };
      final.alerted = verdictAlertsOwner(cfg.mode, final.verdict);
      await this.writeResult(rootTenantId, runner.user.id, final, cfg, null, { rule: 'first-painted' });
      return final;
    } finally {
      clearRunInFlight(runId);
    }
  }

  // ═════════════════════════════════════════════════════════════════════
  // Dispatch → links 1, 2 → all-clear (finally) → link 3
  // ═════════════════════════════════════════════════════════════════════

  private async execute(args: {
    paneIds: string[];
    tenantIds: string[];
    expected: ExpectedIdentity;
    drillOverrideId: string | null;
    runnerUserId: string;
    dispatch: () => Promise<string | null>;
    clear: (dispatchAtMs: number) => Promise<boolean>;
  }): Promise<{
    verdict: DrillVerdict;
    reason: string;
    failedLink: FailedLink | null;
    panes: PaneGrade[];
    dispatchAtMs: number;
    clearAtMs: number | null;
    cleared: boolean | null;
    messageId: string | null;
  }> {
    const samples = new Map<string, PaneSample[]>(args.paneIds.map((id) => [id, []]));
    const grade = (clearAtMs: number | null, dispatchAtMs: number, transitions: GradeInput['transitions'] = null): GradeInput => ({
      paneIds: args.paneIds,
      expected: args.expected,
      dispatchAtMs,
      clearAtMs,
      samples,
      transitions,
    });
    const dispatchAtMs = this.now();
    let dispatched: Dispatched = { status: 'unknown', reason: 'not-started' };
    let clearAtMs: number | null = null;
    let cleared: boolean | null = null;
    let aborted: string | null = null;
    let inconclusive: string | null = null;
    let messageId: string | null = null;

    let dispatchCall: Promise<string | null> | null = null;
    try {
      dispatchCall = args.dispatch();
      const sent = await bounded(dispatchCall, DRILL_TIMING.CALL_TIMEOUT_MS);
      if (sent.ok) {
        messageId = sent.value;
        dispatched = { status: 'sent', messageId };
      } else if (!sent.timedOut && sent.error instanceof HttpException && sent.error.getStatus() < 500) {
        // Every 4xx the controller throws is thrown BEFORE its fan-out (scope,
        // ownership, media allowlist, the live-alert refusal): nothing went out.
        const body = sent.error.getResponse() as { code?: unknown } | string;
        const liveAlert = sent.error.getStatus() === 409 && typeof body === 'object' && body?.code === DRILL_BLOCKED_CODE;
        dispatched = { status: 'refused', liveAlert, reason: `${sent.error.getStatus()}:${errorText(sent.error)}` };
      } else {
        dispatched = { status: 'unknown', reason: sent.timedOut ? 'dispatch-timed-out' : `dispatch-failed:${errorText(sent.error)}` };
      }

      if (dispatched.status === 'sent') {
        // Link 1 — delivery + paint, read every second until +5 s.
        const link1At = dispatchAtMs + DRILL_TIMING.LINK1_DEADLINE_MS;
        for (;;) {
          aborted = await this.sample({ ...args, dispatchAtMs }, samples, true);
          if (aborted || link1Settled(grade(null, dispatchAtMs))) break;
          const left = link1At - this.now();
          if (left <= 0) break;
          await this.sleep(Math.min(DRILL_TIMING.LINK1_POLL_MS, left));
          if (!this.stillLeading()) aborted = this.destroyed ? 'shutdown' : 'lease-lost';
          if (aborted) break;
        }
        // Link 2 — persistence, every 5 s until a dated proof (or a drop), at most to +135 s.
        const link2Until = dispatchAtMs + DRILL_TIMING.LINK2_UNTIL_MS;
        while (!aborted && !link2Settled(grade(null, dispatchAtMs))) {
          const left = link2Until - this.now();
          if (left <= 0) break;
          await this.sleep(Math.min(DRILL_TIMING.POLL_MS, left));
          if (!this.stillLeading()) {
            aborted = this.destroyed ? 'shutdown' : 'lease-lost';
            break;
          }
          aborted = await this.sample({ ...args, dispatchAtMs }, samples, true);
        }
      }
    } catch (e) {
      inconclusive = `run-error:${errorText(e)}`;
    } finally {
      // THE ALL-CLEAR, ON EVERY EXIT that may have put anything on glass —
      // a throw, a lost lease, a live alert, the deadline. A drill all-clear
      // (`isDrill: true`) can only ever end drill state.
      if (dispatched.status !== 'refused') {
        clearAtMs = this.now();
        cleared = await this.clearWithRetry(() => args.clear(dispatchAtMs));
      }
    }

    if (dispatched.status === 'unknown' && dispatched.reason === 'dispatch-timed-out' && dispatchCall) {
      // A trigger that did not answer in time may still be writing: once it
      // settles (or at the +150 s deadline) clear AGAIN, so rows it wrote after
      // our first all-clear do not hold the glass until their own expiry.
      const late = await bounded(dispatchCall, Math.max(0, dispatchAtMs + DRILL_TIMING.CLEAR_BY_MS - this.now()));
      if (late.ok || !late.timedOut) {
        clearAtMs = this.now();
        cleared = (await this.clearWithRetry(() => args.clear(dispatchAtMs))) && cleared !== false;
      }
    }
    if (dispatched.status !== 'sent') return this.dispatchOutcome(dispatched, dispatchAtMs, clearAtMs, cleared);

    // Link 3 — release, every 5 s until every pane left the alert, at most clear + 150 s.
    if (!aborted && clearAtMs !== null) {
      const link3Until = clearAtMs + DRILL_TIMING.LINK3_WINDOW_MS;
      for (;;) {
        const left = link3Until - this.now();
        if (left <= 0) break;
        await this.sleep(Math.min(DRILL_TIMING.POLL_MS, left));
        const a = await this.sample({ ...args, dispatchAtMs }, samples, false);
        if (a) {
          aborted = a;
          break;
        }
        if (link3Settled(grade(clearAtMs, dispatchAtMs))) break;
        if (this.destroyed) {
          aborted = 'shutdown';
          break;
        }
      }
    }

    if (aborted) {
      return { verdict: 'ABORTED', reason: aborted, failedLink: null, panes: [], dispatchAtMs, clearAtMs, cleared, messageId };
    }
    const transitions = await this.readTransitions(args.paneIds, args.tenantIds, dispatchAtMs);
    const g = gradeRun({ ...grade(clearAtMs, dispatchAtMs, transitions), cleared });
    if (inconclusive && g.verdict !== 'FAIL') {
      return { verdict: 'INCONCLUSIVE', reason: inconclusive, failedLink: null, panes: g.panes, dispatchAtMs, clearAtMs, cleared, messageId };
    }
    return { verdict: g.verdict, reason: g.reason, failedLink: g.failedLink, panes: g.panes, dispatchAtMs, clearAtMs, cleared, messageId };
  }

  private dispatchOutcome(d: Dispatched, dispatchAtMs: number, clearAtMs: number | null, cleared: boolean | null) {
    if (d.status === 'refused') {
      // "A 409 → ABORTED" (a live alert in the organisation); any other refusal: nothing went out.
      return {
        verdict: (d.liveAlert ? 'ABORTED' : 'SKIPPED') as DrillVerdict,
        reason: d.liveAlert ? `live-alert-refused:${d.reason}` : `refused:${d.reason}`,
        failedLink: null,
        panes: [] as PaneGrade[],
        dispatchAtMs,
        clearAtMs,
        cleared,
        messageId: null,
      };
    }
    // The trigger did not answer cleanly: it may or may not have reached the
    // glass. The all-clear has been sent; the run proves nothing either way.
    return {
      verdict: 'INCONCLUSIVE' as DrillVerdict,
      reason: d.status === 'unknown' ? d.reason : 'dispatch-unknown',
      failedLink: null,
      panes: [] as PaneGrade[],
      dispatchAtMs,
      clearAtMs,
      cleared,
      messageId: null,
    };
  }

  /** One point read of every pane; returns an ABORT reason when a live alert reached them. */
  private async sample(
    args: { paneIds: string[]; tenantIds: string[]; drillOverrideId: string | null; runnerUserId: string; dispatchAtMs: number },
    samples: Map<string, PaneSample[]>,
    beforeClear: boolean,
  ): Promise<string | null> {
    const atMs = this.now();
    const read = await bounded(
      Promise.all([
        this.prisma.client.emergencyMessage.findMany({
          where: {
            tenantId: { in: args.tenantIds },
            clearedAt: null,
            triggeredByUserId: { not: args.runnerUserId },
            createdAt: { gte: new Date(args.dispatchAtMs - 24 * 60 * MIN) },
          },
          select: { id: true, expiresAt: true },
          take: 20,
        }),
        this.prisma.client.screen.findMany({
          where: { id: { in: args.paneIds }, tenantId: { in: args.tenantIds } },
          select: { id: true, lastRenderedHash: true, lastRenderedAt: true },
        }),
        this.prisma.client.screenEmergencyOverride.findMany({
          where: { tenantId: { in: args.tenantIds }, screenId: { in: args.paneIds } },
        }),
        this.prisma.client.tenant.findMany({
          where: { id: { in: args.tenantIds } },
          select: { id: true, emergencyStatus: true, emergencyIsDrill: true },
        }),
      ]),
      DRILL_TIMING.READ_TIMEOUT_MS,
    );
    if (!read.ok) return null; // unreadable: simply no sample (the grade says INCONCLUSIVE if it matters)
    const [foreignMessages, rows, overrides, tenants] = read.value as [
      Array<{ id: string; expiresAt: Date | null }>,
      Array<{ id: string; lastRenderedHash: string | null; lastRenderedAt: Date | null }>,
      unknown[],
      Array<{ id: string; emergencyStatus: string | null; emergencyIsDrill: boolean | null }>,
    ];
    for (const r of rows) {
      samples.get(r.id)?.push({ atMs, hash: r.lastRenderedHash ?? null, renderedAtMs: r.lastRenderedAt ? new Date(r.lastRenderedAt).getTime() : null });
    }
    return liveAlertOnPanes({
      nowMs: atMs,
      overrideRows: overrides,
      tenants,
      // Our own drill entry must be on every pane until OUR all-clear; after
      // it, only a live alert can abort.
      drillOverrideId: beforeClear ? args.drillOverrideId : null,
      paneIds: args.paneIds,
      foreignMessages: foreignMessages.map((m) => ({ id: m.id, expiresAt: m.expiresAt ? new Date(m.expiresAt) : null })),
    });
  }

  /** The render-proof handler's transition rows for the panes since dispatch; null when unreadable. */
  private async readTransitions(paneIds: string[], tenantIds: string[], dispatchAtMs: number): Promise<Map<string, PaneTransition[]> | null> {
    const read = await bounded(
      this.prisma.client.auditLog.findMany({
        where: {
          tenantId: { in: tenantIds },
          action: { in: [PLAYER_PAINTED_ACTION, PLAYER_NO_PAINT_ACTION] },
          targetType: 'Screen',
          targetId: { in: paneIds },
          createdAt: { gte: new Date(dispatchAtMs - SEC) },
        },
        select: { targetId: true, action: true, details: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
        take: 500,
      }),
      DRILL_TIMING.READ_TIMEOUT_MS,
    );
    if (!read.ok) return null;
    const out = new Map<string, PaneTransition[]>(paneIds.map((id) => [id, []]));
    for (const r of read.value as Array<{ targetId: string | null; action: string; details: string | null; createdAt: Date }>) {
      let identity: string | null = null;
      try {
        const d = r.details ? (JSON.parse(r.details) as { identity?: unknown }) : null;
        identity = typeof d?.identity === 'string' ? d.identity : null;
      } catch {
        identity = null;
      }
      out.get(r.targetId ?? '')?.push({ atMs: new Date(r.createdAt).getTime(), action: r.action, identity });
    }
    return out;
  }

  /** Up to three attempts, each bounded; true when one returned. Never throws. */
  private async clearWithRetry(fn: () => Promise<boolean>): Promise<boolean> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const r = await bounded(fn(), DRILL_TIMING.CALL_TIMEOUT_MS);
      if (r.ok) return r.value !== false;
      this.logger.warn(`[synthetic-drill] all-clear attempt ${attempt + 1} failed: ${errorText(r.error)}`);
      if (attempt < 2) await this.sleep(1_500);
    }
    return false;
  }

  /**
   * Clear the pushed message(s) a run sent. Known id → that send (its copies
   * clear with it). Unknown (the send did not answer) → every message the
   * runner identity sent since dispatch that is still uncleared.
   */
  private async clearMessages(
    messageId: string | null,
    runnerUserId: string,
    tenantIds: string[],
    dispatchAtMs: number,
    principal: ReturnType<typeof runnerPrincipal>,
  ): Promise<boolean> {
    if (messageId) {
      await this.emergency().clearMessage(messageId, { user: principal });
      return true;
    }
    const rows = (await this.prisma.client.emergencyMessage.findMany({
      where: {
        tenantId: { in: tenantIds },
        triggeredByUserId: runnerUserId,
        clearedAt: null,
        createdAt: { gte: new Date(dispatchAtMs - 5 * SEC) },
      },
      select: { id: true, scopeType: true, scopeId: true },
      take: 100,
    })) as Array<{ id: string; scopeType: string; scopeId: string }>;
    const seen = new Set<string>();
    for (const r of rows) {
      const group = r.scopeType === 'devices' ? `devices:${r.scopeId}` : r.id;
      if (seen.has(group)) continue;
      seen.add(group);
      await this.emergency().clearMessage(r.id, { user: principal });
    }
    return true;
  }

  // ═════════════════════════════════════════════════════════════════════
  // Guards, display, identity
  // ═════════════════════════════════════════════════════════════════════

  private async loadDisplay(screenId: string): Promise<{
    named: PaneRow;
    panes: PaneRow[];
    paneIds: string[];
    rootTenantId: string | null;
    rootInternal: boolean | null;
  } | null> {
    // System path, no caller tenant: the row's own tenant scopes every read
    // below, and the guards verify it (allowlist + internal root).
    const named = ((await this.prisma.client.screen.findMany({ where: { id: { in: [screenId] } }, select: PANE_SELECT })) as unknown as PaneRow[])[0];
    if (!named || !named.tenantId) return null;
    const unitRoot = named.faceOfScreenId || named.id;
    const unit = (await this.prisma.client.screen.findMany({
      where: { tenantId: named.tenantId, OR: [{ id: unitRoot }, { faceOfScreenId: unitRoot }] },
      select: PANE_SELECT,
    })) as unknown as PaneRow[];
    const rows = unit.some((r) => r.id === named.id) ? unit : [named, ...unit];
    const paneIds = unitPaneIds(screenId, rows);
    const panes = paneIds.map((id) => rows.find((r) => r.id === id)).filter((r): r is PaneRow => !!r);
    let rootTenantId: string | null = null;
    let rootInternal: boolean | null = null;
    try {
      rootTenantId = await resolveRootTenantId(this.prisma.client.tenant as never, named.tenantId);
      const roots = await this.readRoots([rootTenantId]);
      rootInternal = roots[0]?.isInternal ?? null;
    } catch {
      rootInternal = null;
    }
    return { named, panes, paneIds, rootTenantId, rootInternal };
  }

  private async readRoots(ids: string[]): Promise<Array<{ id: string; isInternal: boolean | null }>> {
    try {
      const rows = (await this.prisma.client.tenant.findMany({
        where: { id: { in: ids } },
        select: { id: true, isInternal: true },
      })) as Array<{ id: string; isInternal: boolean | null }>;
      return ids.map((id) => rows.find((r) => r.id === id) ?? { id, isInternal: null });
    } catch {
      return ids.map((id) => ({ id, isInternal: null }));
    }
  }

  private async readPanes(paneIds: string[], tenantIds: string[]): Promise<PaneRow[]> {
    return (await this.prisma.client.screen.findMany({
      where: { id: { in: paneIds }, tenantId: { in: tenantIds } },
      select: PANE_SELECT,
    })) as unknown as PaneRow[];
  }

  private async evaluateGuards(
    cfg: DrillConfig,
    panes: PaneRow[],
    roots: Array<{ id: string; isInternal: boolean | null }>,
  ): Promise<GuardVerdict> {
    const nowMs = this.now();
    const paneIds = panes.map((p) => p.id);
    const tenantIds = [...new Set(panes.map((p) => p.tenantId).filter((t): t is string => !!t))];
    let overrideRows: unknown[] = [];
    let tenants: Array<{ id: string; emergencyStatus: string | null }> = [];
    try {
      [overrideRows, tenants] = await Promise.all([
        this.prisma.client.screenEmergencyOverride.findMany({ where: { tenantId: { in: tenantIds }, screenId: { in: paneIds } } }),
        this.prisma.client.tenant.findMany({ where: { id: { in: tenantIds } }, select: { id: true, emergencyStatus: true } }) as Promise<
          Array<{ id: string; emergencyStatus: string | null }>
        >,
      ]);
    } catch {
      return { ok: false as const, guard: 4 as const, reason: 'state-unreadable' };
    }
    // "Meant to be off?" — the customer alerts' own facts and rule, minus the
    // drill's own tail (our previous kind on this display is not downtime).
    const downtime = new Map<string, string | null>();
    if (this.alerts && tenantIds.length > 0) {
      try {
        const tmap = await this.alerts.loadTenants(tenantIds);
        const facts = await this.alerts.loadFacts(
          panes.filter((p) => p.tenantId).map((p) => ({ screenId: p.id, tenantId: p.tenantId as string })),
          tmap,
          nowMs,
        );
        for (const p of panes) {
          const f = facts.get(p.id);
          if (f) downtime.set(p.id, intendedDowntime({ ...f.facts, syntheticDrill: null }, 'NO_CONTENT', nowMs, nowMs));
        }
      } catch {
        /* unreadable: the guard refuses */
      }
    }
    return evaluateDrillGuards({
      nowMs,
      allowlist: cfg.screenIds,
      panes,
      roots,
      overrideRows,
      tenants,
      downtime,
      redisConnected: this.redisConnected(),
      degradedComponents: degradedPlatformComponents(nowMs),
    });
  }

  /** The last-moment re-check: still listed, root still internal (fresh), realtime still up. */
  private async recheckBeforeDispatch(screenId: string, tenantId: string): Promise<string | null> {
    const cfg = this.config();
    if (!cfg.enabled || !cfg.screenIds.includes(screenId)) return 'recheck:guard1';
    if (!this.redisConnected()) return 'recheck:guard5:redis-not-connected';
    try {
      const rootId = await resolveRootTenantId(this.prisma.client.tenant as never, tenantId);
      const roots = await this.readRoots([rootId]);
      if (roots[0]?.isInternal !== true) return 'recheck:guard2:root-not-internal';
    } catch {
      return 'recheck:guard2:root-unreadable';
    }
    return null;
  }

  /**
   * The login-disabled service identity of one bench location (§9.1),
   * created idempotently — and only ever reached after guard 2 said the
   * organisation root is internal. A row someone made login-capable is never
   * used.
   */
  async ensureRunnerIdentity(tenantId: string): Promise<{ ok: true; user: RunnerUserRow } | { ok: false; problem: string }> {
    const email = drillRunnerEmail(tenantId);
    try {
      let row = (await this.prisma.client.user.findFirst({ where: { tenantId, email }, select: RUNNER_SELECT })) as RunnerUserRow | null;
      if (!row) {
        const id = randomUUID();
        try {
          await this.prisma.client.$transaction([
            this.prisma.client.user.create({
              data: {
                id,
                tenantId,
                email,
                passwordHash: DRILL_RUNNER_NO_PASSWORD,
                role: DRILL_RUNNER_ROLE,
                status: DRILL_RUNNER_STATUS,
                canTriggerPanic: true,
                firstName: DRILL_RUNNER_FIRST_NAME,
                lastName: DRILL_RUNNER_LAST_NAME,
                alertEmailsEnabled: false,
              },
            }),
            this.prisma.client.auditLog.create({
              data: {
                tenantId,
                userId: id,
                action: DRILL_RUNNER_CREATED_ACTION,
                targetType: 'User',
                targetId: id,
                details: JSON.stringify({
                  v: 1,
                  email,
                  role: DRILL_RUNNER_ROLE,
                  status: DRILL_RUNNER_STATUS,
                  why: 'synthetic emergency drill service identity — login disabled, no password',
                }),
              },
            }),
          ]);
        } catch {
          // A concurrent create (unique email): read what won.
        }
        row = (await this.prisma.client.user.findFirst({ where: { tenantId, email }, select: RUNNER_SELECT })) as RunnerUserRow | null;
      }
      const problem = runnerIdentityProblem(row, tenantId);
      return problem || !row ? { ok: false, problem: problem ?? 'missing' } : { ok: true, user: row };
    } catch (e) {
      return { ok: false, problem: `unreadable:${errorText(e)}` };
    }
  }

  // ═════════════════════════════════════════════════════════════════════
  // Rows
  // ═════════════════════════════════════════════════════════════════════

  private async writeStarted(
    tenantId: string,
    userId: string,
    targetType: 'Screen' | 'Tenant',
    targetId: string,
    details: DrillStartedDetails,
  ): Promise<boolean> {
    try {
      await this.prisma.client.auditLog.create({
        data: { tenantId, userId, action: DRILL_STARTED_ACTION, targetType, targetId, details: JSON.stringify(DrillStartedDetailsSchema.parse(details)) },
      });
      return true;
    } catch (e) {
      this.logger.warn(`[synthetic-drill] STARTED row not written (${errorText(e)}) — nothing dispatched`);
      return false;
    }
  }

  private async writeResult(
    tenantId: string,
    userId: string,
    r: DrillRunResult,
    cfg: DrillConfig,
    named: PaneRow | null,
    expected: ExpectedIdentity | null = null,
  ): Promise<void> {
    const details: DrillResultDetails = {
      v: 1,
      runId: r.runId,
      kind: r.kind,
      verdict: r.verdict,
      reason: r.reason.slice(0, 240),
      failedLink: r.failedLink,
      mode: cfg.mode,
      slot: r.slot,
      type: r.type,
      overrideId: r.overrideId,
      messageId: r.messageId,
      expected: expected ? { rule: expected.rule, identity: expected.rule === 'identity' ? expected.identity : null } : null,
      dispatchAtMs: r.dispatchAtMs,
      clearAtMs: r.clearAtMs,
      cleared: r.cleared,
      paneIds: r.paneIds,
      panes: r.panes.map((p) => ({ ...p, lastHash: p.lastHash ? p.lastHash.slice(0, 140) : null, reason: p.reason.slice(0, 120) })),
      screenId: r.screenId,
      rootTenantId: r.rootTenantId,
      hardwareModel: named?.hardwareModel ?? null,
      deviceClass: named ? drillHardwareClass(named) : null,
      playerVersion: named?.playerVersion ?? null,
      alerted: r.alerted,
      runnerUserId: userId,
    };
    try {
      await this.prisma.client.auditLog.create({
        data: {
          tenantId,
          userId,
          action: DRILL_RESULT_ACTION,
          targetType: r.kind === 'district-copy' ? 'Tenant' : 'Screen',
          targetId: r.kind === 'district-copy' ? r.rootTenantId : r.screenId,
          details: JSON.stringify(DrillResultDetailsSchema.parse(details)),
        },
      });
    } catch (e) {
      this.logger.warn(`[synthetic-drill] RESULT row not written for run ${r.runId}: ${errorText(e)}`);
    }
    this.logger.log(
      `[synthetic-drill] ${r.kind} ${r.label}: ${r.verdict}${r.failedLink ? ` (${r.failedLink})` : ''} — ${r.reason} (run ${r.runId}, mode ${cfg.mode})`,
    );
  }

  private emptyResult(runId: string, kind: DrillKind, slot: string, screenId: string | null, label: string): DrillRunResult {
    return {
      runId,
      kind,
      verdict: 'SKIPPED',
      reason: '',
      failedLink: null,
      screenId,
      rootTenantId: null,
      label,
      slot,
      type: null,
      paneIds: [],
      panes: [],
      overrideId: null,
      messageId: null,
      dispatchAtMs: null,
      clearAtMs: null,
      cleared: null,
      alerted: false,
    };
  }

  // ═════════════════════════════════════════════════════════════════════
  // Plan: due slots in each screen's own zone, bench districts
  // ═════════════════════════════════════════════════════════════════════

  private async plan(cfg: DrillConfig): Promise<Plan> {
    const nowMs = this.now();
    const rows = (await this.prisma.client.screen.findMany({
      where: { id: { in: [...cfg.screenIds] } },
      select: PANE_SELECT,
    })) as unknown as PaneRow[];
    const byId = new Map(rows.map((r) => [r.id, r]));
    // One display per physical unit: a double-sided unit is drilled ONCE (the
    // device scope reaches both faces), named by its primary when listed.
    const displays = new Map<string, PaneRow>();
    for (const id of cfg.screenIds) {
      const r = byId.get(id);
      if (!r || !r.tenantId) continue;
      const unit = r.faceOfScreenId || r.id;
      if (!displays.has(unit)) displays.set(unit, byId.get(unit) ?? r);
    }
    const items: PlanItem[] = [];
    const firstDueByTenant = new Map<string, DueSlot>();
    for (const named of displays.values()) {
      const zone = manifestTimeZone(named, named.screenGroup, named.tenant);
      if (!zone) {
        if (!this.noZoneWarned.has(named.id)) {
          this.noZoneWarned.add(named.id);
          this.logger.warn(`[synthetic-drill] ${named.id}: no time zone (no setting, no address) — never drilled on a guessed clock`);
        }
        continue;
      }
      for (const due of dueSlots(zone, cfg.slots, nowMs)) {
        const type = drillTypeFor(due.dayNumber, due.slotIndex, cfg.slots.length);
        for (const kind of DAILY_SCREEN_KINDS) {
          items.push({ kind, screenId: named.id, rootTenantId: null, due, type: kind === 'override' ? type : null, label: named.name });
        }
        const t = named.tenantId as string;
        if (!firstDueByTenant.has(t)) firstDueByTenant.set(t, due);
      }
    }
    const tenantIds = [...new Set(rows.map((r) => r.tenantId).filter((t): t is string => !!t))];
    const rootIds = await this.rootsOf(tenantIds);
    const districts = await this.benchDistricts(cfg, tenantIds).catch((): BenchDistrict[] => []);
    for (const d of districts) {
      const due = d.tenantIds.map((t) => firstDueByTenant.get(t)).find((x): x is DueSlot => !!x);
      if (due) items.push({ kind: 'district-copy', screenId: null, rootTenantId: d.rootTenantId, due, type: null, label: d.label });
    }
    return {
      items,
      displays: [...displays.values()].map((d) => ({ screenId: d.id, label: d.name })),
      districtRoots: districts.map((d) => ({ rootTenantId: d.rootTenantId, label: d.label })),
      // Where this job's rows live: the listed screens' locations and their roots (district runs).
      benchTenantIds: [...new Set([...tenantIds, ...rootIds])],
    };
  }

  private async analyseDistrict(rootTenantId: string, cfg: DrillConfig) {
    const descendants = await collectDescendantTenantIds(this.prisma.client.tenant as never, rootTenantId);
    const tenantIds = [rootTenantId, ...descendants];
    const subtree = (await this.prisma.client.screen.findMany({
      where: { tenantId: { in: tenantIds } },
      select: { id: true, tenantId: true, status: true },
      take: 2_000,
    })) as Array<{ id: string; tenantId: string | null; status: string | null }>;
    const verdict = benchDistrictEligible({ rootTenantId, descendantTenantIds: descendants, subtreeScreens: subtree, allowlist: cfg.screenIds });
    return { ...verdict, tenantIds };
  }

  /** The organisation root of each location (cached 10 min; a failed walk keeps the location). */
  private async rootsOf(tenantIds: string[]): Promise<string[]> {
    const nowMs = this.now();
    const out: string[] = [];
    for (const t of tenantIds) {
      const hit = this.rootCache.get(t);
      if (hit && nowMs - hit.atMs < 10 * MIN) {
        out.push(hit.rootId);
        continue;
      }
      const rootId = await resolveRootTenantId(this.prisma.client.tenant as never, t).catch(() => t);
      this.rootCache.set(t, { atMs: nowMs, rootId });
      out.push(rootId);
    }
    return [...new Set(out)];
  }

  /** Internal roots of the listed screens that form a bench DISTRICT (cached 10 min). */
  private async benchDistricts(cfg: DrillConfig, tenantIds: string[]) {
    const key = `${cfg.screenIds.join(',')}|${tenantIds.join(',')}`;
    const nowMs = this.now();
    if (this.districtCache && this.districtCache.key === key && nowMs - this.districtCache.atMs < 10 * MIN) return this.districtCache.value;
    const rootIds = [...new Set(await Promise.all(tenantIds.map((t) => resolveRootTenantId(this.prisma.client.tenant as never, t))))];
    const roots = await this.readRoots(rootIds);
    const names = (await this.prisma.client.tenant.findMany({ where: { id: { in: rootIds } }, select: { id: true, name: true } })) as Array<{
      id: string;
      name: string;
    }>;
    const value: BenchDistrict[] = [];
    for (const r of roots) {
      if (r.isInternal !== true) continue;
      const d = await this.analyseDistrict(r.id, cfg);
      if (d.eligible) value.push({ rootTenantId: r.id, label: names.find((n) => n.id === r.id)?.name ?? r.id, paneIds: d.paneIds, tenantIds: d.tenantIds });
    }
    this.districtCache = { atMs: nowMs, key, value };
    return value;
  }

  /** May this slot run now? One run per (target, kind, local slot); a SKIPPED attempt may retry 30 min later. */
  private async claimSlot(item: PlanItem): Promise<boolean> {
    const target = item.kind === 'district-copy' ? `district:${item.rootTenantId}` : item.screenId;
    const base = `${KEY}:slot:${target}:${item.kind}:${item.due.key}`;
    const pub = this.claimClient();
    if (!pub) return false; // no Redis, no drill
    try {
      if ((await pub.get(`${base}:done`)) !== null) return false;
      return (await pub.set(`${base}:attempt`, String(this.now()), 'EX', SKIP_RETRY_S, 'NX')) === 'OK';
    } catch {
      return false;
    }
  }

  private async settleSlot(item: PlanItem, result: DrillRunResult): Promise<void> {
    // SKIPPED, or cut short by our own process (a deploy took the lease, a
    // shutdown): the attempt key lapses and a later tick may try again inside
    // the slot's grace. Anything else consumed the slot.
    if (result.verdict === 'SKIPPED') return;
    if (result.verdict === 'ABORTED' && (result.reason === 'lease-lost' || result.reason === 'shutdown')) return;
    const verdict = result.verdict;
    const target = item.kind === 'district-copy' ? `district:${item.rootTenantId}` : item.screenId;
    const pub = this.claimClient();
    try {
      await pub?.set(`${KEY}:slot:${target}:${item.kind}:${item.due.key}:done`, verdict, 'EX', CLAIM_TTL_S);
    } catch {
      /* the attempt key still holds the slot for 30 minutes */
    }
  }

  // ═════════════════════════════════════════════════════════════════════
  // The orphan sweep (boot + 2 min, every tick)
  // ═════════════════════════════════════════════════════════════════════

  async sweepOrphans(benchTenantIds: string[]): Promise<number> {
    if (benchTenantIds.length === 0) return 0;
    const nowMs = this.now();
    let rows: Array<{ tenantId: string; action: string; details: string | null; createdAt: Date }>;
    try {
      rows = (await this.prisma.client.auditLog.findMany({
        where: {
          tenantId: { in: benchTenantIds },
          action: { in: [DRILL_STARTED_ACTION, DRILL_RESULT_ACTION, DRILL_SWEPT_ACTION] },
          createdAt: { gte: new Date(nowMs - 24 * 60 * MIN) },
        },
        select: { tenantId: true, action: true, details: true, createdAt: true },
        take: 2_000,
      })) as Array<{ tenantId: string; action: string; details: string | null; createdAt: Date }>;
    } catch {
      return 0;
    }
    const orphans = orphanRuns({ rows, nowMs, inFlightHere: isRunInFlightHere });
    let swept = 0;
    for (const o of orphans) {
      const principal = runnerPrincipal(o.runnerUserId, o.tenantId);
      const clearedIds: string[] = [];
      let outcome: 'cleared' | 'nothing-to-clear' | 'clear-failed' = 'cleared';
      try {
        if (o.kind === 'override' && o.overrideId && o.screenId) {
          await this.emergency().clearEmergency(
            o.overrideId,
            ClearEmergencyInputSchema.parse({ scopeType: 'device', scopeId: o.screenId, isDrill: true }),
            { user: principal },
          );
          clearedIds.push(o.overrideId);
        } else {
          const tenantIds = o.kind === 'district-copy' ? [o.rootTenantId, ...(await collectDescendantTenantIds(this.prisma.client.tenant as never, o.rootTenantId))] : [o.tenantId];
          const open = (await this.prisma.client.emergencyMessage.findMany({
            where: {
              tenantId: { in: tenantIds },
              triggeredByUserId: o.runnerUserId,
              clearedAt: null,
              createdAt: { gte: new Date(new Date(o.dispatchAt).getTime() - 5 * SEC) },
            },
            select: { id: true, scopeType: true, scopeId: true },
            take: 100,
          })) as Array<{ id: string; scopeType: string; scopeId: string }>;
          const seen = new Set<string>();
          for (const m of open) {
            const group = m.scopeType === 'devices' ? `devices:${m.scopeId}` : m.id;
            if (seen.has(group)) continue;
            seen.add(group);
            await this.emergency().clearMessage(m.id, { user: principal });
            clearedIds.push(m.id);
          }
          if (clearedIds.length === 0) outcome = 'nothing-to-clear';
        }
      } catch (e) {
        outcome = 'clear-failed';
        this.logger.warn(`[synthetic-drill] orphan ${o.runId}: all-clear failed (${errorText(e)}) — its alert expires on its own`);
      }
      try {
        await this.prisma.client.auditLog.create({
          data: {
            tenantId: o.tenantId,
            userId: o.runnerUserId,
            action: DRILL_SWEPT_ACTION,
            targetType: o.kind === 'district-copy' ? 'Tenant' : 'Screen',
            targetId: o.kind === 'district-copy' ? o.rootTenantId : o.screenId,
            details: JSON.stringify(
              DrillSweptDetailsSchema.parse({ v: 1, runId: o.runId, kind: o.kind, outcome, clearedIds, runnerUserId: o.runnerUserId }),
            ),
          },
        });
      } catch {
        /* the sweep tries again next tick — an all-clear twice is harmless */
      }
      swept++;
      this.logger.warn(`[synthetic-drill] orphan run ${o.runId} (${o.kind}) swept: ${outcome}`);
    }
    return swept;
  }

  // ═════════════════════════════════════════════════════════════════════
  // Owner emails (alert / on): one per tick, the daily dead-man; guard 2
  // ═════════════════════════════════════════════════════════════════════

  private async emailTick(cfg: DrillConfig, results: DrillRunResult[]): Promise<boolean> {
    const runs = results.filter((r) => verdictAlertsOwner(cfg.mode, r.verdict));
    if (runs.length === 0 || !this.mailer) return false;
    const pub = this.claimClient();
    if (!pub) return false;
    try {
      const claimed = await pub.set(`${KEY}:email:${tickEmailKey(runs.map((r) => r.runId))}`, String(this.now()), 'EX', CLAIM_TTL_S, 'NX');
      if (claimed !== 'OK') return false;
    } catch {
      return false;
    }
    const email = renderTickEmail({
      mode: cfg.mode,
      nowMs: this.now(),
      runs: runs.map(
        (r): DrillEmailRun => ({
          label: r.label,
          kind: r.kind,
          verdict: r.verdict,
          failedLink: r.failedLink,
          reason: r.reason,
          runId: r.runId,
          dispatchAtMs: r.dispatchAtMs,
          panes: r.panes.map((p) => ({ id: p.id, raisedAtMs: p.raisedAtMs, paintedAtMs: p.paintedAtMs, lastHash: p.lastHash, failedLink: p.failedLink, reason: p.reason })),
        }),
      ),
    });
    try {
      // Never a retry: a failed send is logged, the verdicts are in the rows.
      await this.mailer.sendAlert(email.subject, email.body, 'ALERT_EMERGENCY_DRILL');
      return true;
    } catch (e) {
      this.logger.warn(`[synthetic-drill] owner email failed: ${errorText(e)}`);
      return false;
    }
  }

  private async deadManCheck(cfg: DrillConfig, plan: Plan): Promise<void> {
    if (cfg.mode !== 'alert' && cfg.mode !== 'on') return;
    if (!this.mailer || plan.displays.length + plan.districtRoots.length === 0) return;
    const nowMs = this.now();
    const pub = this.claimClient();
    if (!pub) return;
    // Looked at once an hour (one read); emailed at most once a UTC day.
    const iso = new Date(nowMs).toISOString();
    const day = iso.slice(0, 10);
    try {
      if ((await pub.get(`${KEY}:deadman-sent:${day}`)) !== null) return;
      if ((await pub.set(`${KEY}:deadman-check:${iso.slice(0, 13)}`, '1', 'EX', 2 * 60 * 60, 'NX')) !== 'OK') return;
    } catch {
      return;
    }
    let rows: Array<{ createdAt: Date; details: string | null }>;
    try {
      rows = (await this.prisma.client.auditLog.findMany({
        where: {
          tenantId: { in: plan.benchTenantIds },
          action: DRILL_RESULT_ACTION,
          createdAt: { gte: new Date(nowMs - DRILL_TIMING.DEAD_MAN_MS - 24 * 60 * MIN) },
        },
        select: { createdAt: true, details: true },
        take: 5_000,
      })) as Array<{ createdAt: Date; details: string | null }>;
    } catch {
      return; // unreadable: try again next tick (the day is not claimed)
    }
    const gaps = deadManGaps({ displays: plan.displays, districtRoots: plan.districtRoots, rows, nowMs });
    if (gaps.length === 0) return;
    try {
      if ((await pub.set(`${KEY}:deadman-sent:${day}`, String(gaps.length), 'EX', 2 * 24 * 60 * 60, 'NX')) !== 'OK') return;
    } catch {
      return;
    }
    const email = renderDeadManEmail({ gaps, scheduleValid: cfg.scheduleValid, nowMs });
    try {
      await this.mailer.sendAlert(email.subject, email.body, 'ALERT_EMERGENCY_DRILL_DEAD_MAN');
    } catch (e) {
      this.logger.warn(`[synthetic-drill] dead-man email failed: ${errorText(e)}`);
    }
  }

  private async alertNotInternal(screenId: string, rootTenantId: string | null): Promise<void> {
    const key = rootTenantId ?? `screen:${screenId}`;
    if (this.notInternalAlerted.has(key)) return;
    this.notInternalAlerted.add(key);
    const email = renderNotInternalEmail({ screenId, rootTenantId, nowMs: this.now() });
    try {
      await this.mailer?.sendAlert(email.subject, email.body, 'ALERT_EMERGENCY_DRILL_REFUSED');
    } catch {
      /* logged by the caller */
    }
  }

  private async alertIdentity(tenantId: string, problem: string): Promise<void> {
    this.logger.warn(`[synthetic-drill] runner identity of ${tenantId} unusable (${problem}) — nothing sent`);
    if (this.identityAlerted.has(tenantId) || problem.startsWith('unreadable')) return;
    this.identityAlerted.add(tenantId);
    const email = renderIdentityProblemEmail({ tenantId, problem, nowMs: this.now() });
    try {
      await this.mailer?.sendAlert(email.subject, email.body, 'ALERT_EMERGENCY_DRILL_IDENTITY');
    } catch {
      /* logged above */
    }
  }

  // ═════════════════════════════════════════════════════════════════════
  // Plumbing
  // ═════════════════════════════════════════════════════════════════════

  /** The emergency controller's own methods, in-process. */
  private emergency(): DrillEmergencyPort {
    const controller: DrillEmergencyPort = this.moduleRef.get(EmergencyController, { strict: false });
    return controller;
  }

  private redisConnected(): boolean {
    try {
      return this.redis?.isConnected?.() === true;
    } catch {
      return false;
    }
  }

  private claimClient(): { get(key: string): Promise<string | null>; set(...args: Array<string | number>): Promise<unknown> } | null {
    if (!this.redisConnected()) return null;
    const pub = this.redis?.publisher as unknown as { get?: unknown; set?: unknown } | null | undefined;
    if (!pub || typeof pub.get !== 'function' || typeof pub.set !== 'function') return null;
    return pub as unknown as { get(key: string): Promise<string | null>; set(...args: Array<string | number>): Promise<unknown> };
  }

  /** Still the leader of the term this tick started under (true when driven by hand). */
  private stillLeading(): boolean {
    if (this.destroyed) return false;
    if (!this.term || !this.lease) return true;
    return this.lease.holdsFence(LEASE.EMERGENCY_DRILL, this.term.fence);
  }
}
