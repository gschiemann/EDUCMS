/**
 * Scheduled restart worker + read model (2026-11-08, manager deep-dive #7).
 *
 * A leader-leased 5-minute tick. For every ACTIVE policy (opt-in, per screen
 * group) it gathers each screen's facts with tenant-scoped reads, asks the
 * pure rules (scheduled-reboot-policy.ts) and, only on `send`, dispatches a
 * REBOOT through `runDisplayControl` — the SAME function the dashboard's
 * typed-confirm button uses, so the capability gate (today every screen is
 * `reboot: 'none'` and is refused there too), the delivery honesty and the
 * SCREEN_DISPLAY_REBOOT audit row are identical.
 *
 * 2026-11-09 — where the device cannot reboot but its APK proved it can
 * restart its own APP process (`verdict.appRestart === 'relaunch'`), the
 * worker sends APP_RESTART instead, through the same function (audit row
 * SCREEN_DISPLAY_APP_RESTART). Its proof of return is the new process's
 * acknowledgement of the action id (`appRestartAckFrom`), because an app
 * restart moves neither the boot count nor the uptime.
 *
 * One run row per (screen, slot): its unique key is the claim, so two ticks or
 * two replicas can never send the same slot twice.
 *
 * Kill switch: SCHEDULED_REBOOTS_DISABLED=1 — the tick does nothing. Failure
 * direction: closed — a read that fails refuses the restart for that tick.
 */
import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import { LEASE, LeaderLeaseService, leadThisTick } from '../realtime/leader-lease.service';
import { DisplayActionUnsupportedError, DisplayService } from '../display/display.service';
import { runDisplayControl } from '../display/display.controller';
import { resolveEmergencyHold } from '../display/display-emergency-hold';
import { hardwareClassOf } from '../player-ota/fleet-push-policy';
import { pushIsActive } from '../player-ota/push-tracking';
import { windowsForScreen } from '../notifications/customer-alerts/schedule-windows';
import { resolveScreenSync } from '../screens/screen-sync';
import { resolveScreenTimeZone } from '../screens/screen-time-zone';
import {
  DISPATCH_WINDOW_MS,
  ONLINE_FRESH_MS,
  PER_TENANT_PER_TICK,
  REBOOT_WAIT_REASONS,
  appRestartAckFrom,
  bootCountFrom,
  decideScheduledReboot,
  evaluateReturn,
  otaIsInFlight,
  panelIsOff,
  restartActionFor,
  returnWindowMs,
  scheduledRebootsDisabled,
  tenantNightlyCap,
  uptimeFrom,
  verdictCanRestart,
  type RebootFacts,
  type RebootPolicyLike,
} from './scheduled-reboot-policy';

export const SCHEDULED_REBOOT_AUDIT = {
  POLICY_SET: 'SCHEDULED_REBOOT_POLICY_SET',
  POLICY_DELETED: 'SCHEDULED_REBOOT_POLICY_DELETED',
  NOT_BACK: 'SCHEDULED_REBOOT_NOT_BACK',
} as const;

export const RUN_STATUS = {
  WAITING: 'WAITING',
  SENDING: 'SENDING',
  SKIPPED: 'SKIPPED',
  SENT: 'SENT',
  REFUSED: 'REFUSED',
  UNDELIVERED: 'UNDELIVERED',
  BACK: 'BACK',
  NO_RESTART: 'NO_RESTART',
  NOT_BACK: 'NOT_BACK',
  LATE: 'LATE',
} as const;

const TICK_MS = 5 * 60_000;
const DAY_MS = 24 * 60 * 60_000;
const LATE_LOOKBACK_MS = 7 * DAY_MS;

/** The Screen columns the rules read. */
const SCREEN_SELECT = {
  id: true,
  name: true,
  tenantId: true,
  screenGroupId: true,
  timezone: true,
  latitude: true,
  longitude: true,
  hardwareModel: true,
  lastVideoReport: true,
  displayCapabilities: true,
  lastPushConnectedAt: true,
  lastPingAt: true,
  nativeRuntimeReport: true,
  nativeRuntimeReportAt: true,
  softBlankAt: true,
  lastOtaState: true,
  lastOtaAt: true,
  forceApkUpdatePendingAt: true,
  forceApkUpdateHold: true,
} as const;

export interface TickResult {
  ran: boolean;
  evaluated: number;
  sent: number;
  skipped: number;
  waiting: number;
  returned: number;
  notBack: number;
}

/** A screen's class key for one-class-at-a-time; an unknown class is its own singleton. */
export function classKeyOf(screen: { id: string; hardwareModel?: string | null; lastVideoReport?: unknown }): string {
  return hardwareClassOf(screen)?.key ?? `screen:${screen.id}`;
}

@Injectable()
export class ScheduledRebootService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ScheduledRebootService.name);
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly display: DisplayService,
    @Optional() private readonly lease?: LeaderLeaseService,
  ) {}

  onModuleInit(): void {
    if (process.env.NODE_ENV === 'test') return;
    if (scheduledRebootsDisabled()) {
      this.logger.warn('Scheduled restarts disabled via env (SCHEDULED_REBOOTS_DISABLED=1)');
      return;
    }
    this.timer = setInterval(() => {
      void this.tick().catch((e) => this.logger.warn(`tick failed: ${(e as Error).message}`));
    }, TICK_MS);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async tick(now: Date = new Date()): Promise<TickResult> {
    const result: TickResult = { ran: false, evaluated: 0, sent: 0, skipped: 0, waiting: 0, returned: 0, notBack: 0 };
    if (scheduledRebootsDisabled()) return result;
    const status = await leadThisTick(this.lease, LEASE.SCHEDULED_REBOOT);
    if (!status.leader) return result;
    result.ran = true;

    const policies = (await this.prisma.client.screenRebootPolicy.findMany({
      where: { isActive: true },
      select: { id: true, tenantId: true, screenGroupId: true, cadence: true, dayOfWeek: true, time: true, isActive: true },
    })) as Array<RebootPolicyLike & { tenantId: string; screenGroupId: string }>;

    // Proof of return runs for every tenant with an unresolved run, policy or not.
    const tenantIds = new Set<string>(policies.map((p) => p.tenantId));
    const open = (await this.prisma.client.screenRebootRun.findMany({
      where: { status: { in: [RUN_STATUS.SENT, RUN_STATUS.NOT_BACK, RUN_STATUS.WAITING] }, createdAt: { gte: new Date(now.getTime() - LATE_LOOKBACK_MS) } },
      select: { tenantId: true },
      distinct: ['tenantId'],
    })) as Array<{ tenantId: string }>;
    for (const r of open) tenantIds.add(r.tenantId);

    for (const tenantId of tenantIds) {
      try {
        await this.tickTenant(tenantId, policies.filter((p) => p.tenantId === tenantId), now, result);
      } catch (e) {
        // Closed: a tenant whose facts cannot be read restarts nothing this tick.
        this.logger.warn(`[scheduled-reboot] tenant=${tenantId} skipped this tick: ${(e as Error).message}`);
      }
    }
    if (result.sent || result.notBack || result.returned) {
      this.logger.log(
        `[scheduled-reboot] evaluated=${result.evaluated} sent=${result.sent} skipped=${result.skipped} ` +
          `waiting=${result.waiting} returned=${result.returned} notBack=${result.notBack}`,
      );
    }
    return result;
  }

  private async tickTenant(
    tenantId: string,
    policies: Array<RebootPolicyLike & { tenantId: string; screenGroupId: string }>,
    now: Date,
    result: TickResult,
  ): Promise<void> {
    const nowMs = now.getTime();
    const windowMs = returnWindowMs();

    // ── 1. Proof of return, and closing waits whose window has passed ─────
    const runs = (await this.prisma.client.screenRebootRun.findMany({
      where: {
        tenantId,
        status: { in: [RUN_STATUS.SENT, RUN_STATUS.NOT_BACK, RUN_STATUS.WAITING] },
        createdAt: { gte: new Date(nowMs - LATE_LOOKBACK_MS) },
      },
    })) as any[];
    const runScreenIds = [...new Set(runs.map((r) => r.screenId as string))];
    const runScreens = runScreenIds.length
      ? ((await this.prisma.client.screen.findMany({
          where: { tenantId, id: { in: runScreenIds } },
          select: { id: true, lastPingAt: true, nativeRuntimeReport: true, nativeRuntimeReportAt: true },
        })) as any[])
      : [];
    const runScreenById = new Map(runScreens.map((s) => [s.id as string, s]));
    const busyClasses = new Set<string>();

    for (const run of runs) {
      if (run.status === RUN_STATUS.WAITING) {
        if (nowMs >= new Date(run.scheduledFor).getTime() + DISPATCH_WINDOW_MS) {
          await this.prisma.client.screenRebootRun.updateMany({
            where: { id: run.id, tenantId, status: RUN_STATUS.WAITING },
            data: { status: RUN_STATUS.SKIPPED },
          });
          result.skipped++;
        }
        continue;
      }
      const screen = runScreenById.get(run.screenId);
      const lastPingAtMs = screen?.lastPingAt ? new Date(screen.lastPingAt).getTime() : null;
      const dispatchedAtMs = run.dispatchedAt ? new Date(run.dispatchedAt).getTime() : null;
      if (dispatchedAtMs === null) continue;
      if (run.status === RUN_STATUS.NOT_BACK) {
        if (lastPingAtMs !== null && lastPingAtMs > dispatchedAtMs) {
          await this.prisma.client.screenRebootRun.updateMany({
            where: { id: run.id, tenantId, status: RUN_STATUS.NOT_BACK },
            data: { status: RUN_STATUS.LATE, returnedAt: new Date(lastPingAtMs) },
          });
          result.returned++;
        }
        continue;
      }
      // SENT
      const reportAtMs = screen?.nativeRuntimeReportAt ? new Date(screen.nativeRuntimeReportAt).getTime() : null;
      const freshReport = reportAtMs !== null && reportAtMs > dispatchedAtMs;
      const bootNow = freshReport ? bootCountFrom(screen?.nativeRuntimeReport) : null;
      // By value: only an answer naming THIS run's action id counts.
      const appRestartAck = freshReport ? appRestartAckFrom(screen?.nativeRuntimeReport, run.actionId) : null;
      const verdict = evaluateReturn({
        appRestartAck,
        reportAtMs,
        nowMs,
        dispatchedAtMs,
        bootBefore: typeof run.bootBefore === 'number' ? run.bootBefore : null,
        lastPingAtMs,
        bootNow,
        returnWindowMs: windowMs,
      });
      if (verdict.status === 'pending') {
        if (run.hardwareClass) busyClasses.add(run.hardwareClass);
        continue;
      }
      if (verdict.status === 'NOT_BACK') {
        await this.prisma.client.screenRebootRun.updateMany({
          where: { id: run.id, tenantId, status: RUN_STATUS.SENT },
          data: { status: RUN_STATUS.NOT_BACK },
        });
        await this.display.writeAudit({
          action: SCHEDULED_REBOOT_AUDIT.NOT_BACK,
          screenId: run.screenId,
          tenantId,
          userId: null,
          details: { runId: run.id, policyId: run.policyId, dispatchedAt: run.dispatchedAt, returnWindowMs: windowMs },
        });
        result.notBack++;
        // A screen that did not come back holds its class: the next class waits.
        if (run.hardwareClass) busyClasses.add(run.hardwareClass);
        continue;
      }
      await this.prisma.client.screenRebootRun.updateMany({
        where: { id: run.id, tenantId, status: RUN_STATUS.SENT },
        data: {
          status: verdict.status === 'BACK' ? RUN_STATUS.BACK : RUN_STATUS.NO_RESTART,
          returnedAt: new Date(verdict.returnedAtMs),
          bootAfter: verdict.bootAfter,
          restartProven: verdict.status === 'BACK' && verdict.proven,
        },
      });
      result.returned++;
    }
    // A NOT_BACK from tonight also holds its class until someone looks at it.
    for (const run of runs) {
      if (run.status === RUN_STATUS.NOT_BACK && run.hardwareClass && nowMs - new Date(run.createdAt).getTime() < DAY_MS) {
        busyClasses.add(run.hardwareClass);
      }
    }

    if (policies.length === 0) return;

    // ── 2. Facts ─────────────────────────────────────────────────────────
    const policyByGroup = new Map(policies.map((p) => [p.screenGroupId, p]));
    const groupIds = [...policyByGroup.keys()];
    const screens = (await this.prisma.client.screen.findMany({
      where: { tenantId, screenGroupId: { in: groupIds } },
      select: SCREEN_SELECT,
    })) as any[];
    if (screens.length === 0) return;
    const groups = (await this.prisma.client.screenGroup.findMany({
      where: { tenantId, id: { in: groupIds } },
      select: { id: true, syncMode: true, latitude: true, longitude: true },
    })) as any[];
    const groupById = new Map(groups.map((g) => [g.id as string, g]));
    const tenant = (await this.prisma.client.tenant.findUnique({
      where: { id: tenantId },
      select: { timezone: true, latitude: true, longitude: true },
    })) as any;
    const scheduleRows = (await this.prisma.client.displaySchedule.findMany({
      where: { tenantId, isActive: true },
    })) as any[];

    // Sync read fails CLOSED (every screen reads frame-locked), unlike the
    // fleet list's reader, which fails open for display.
    let syncScreenIds = new Set<string>();
    let syncGroupIds = new Set<string>();
    let syncReadFailed = false;
    try {
      const rows = (await this.prisma.client.schedule.findMany({
        where: {
          tenantId,
          isActive: true,
          startTime: { lte: now },
          OR: [{ endTime: { gte: now } }, { endTime: null }],
          playlist: { syncPlayback: true },
        },
        select: { screenId: true, screenGroupId: true },
      })) as Array<{ screenId: string | null; screenGroupId: string | null }>;
      syncScreenIds = new Set(rows.map((r) => r.screenId).filter((x): x is string => !!x));
      syncGroupIds = new Set(rows.map((r) => r.screenGroupId).filter((x): x is string => !!x));
    } catch {
      syncReadFailed = true;
    }

    const existing = (await this.prisma.client.screenRebootRun.findMany({
      where: { tenantId, screenId: { in: screens.map((s) => s.id) }, createdAt: { gte: new Date(nowMs - 2 * DAY_MS) } },
      select: { id: true, screenId: true, slotKey: true, status: true },
    })) as Array<{ id: string; screenId: string; slotKey: string; status: string }>;
    const runByKey = new Map(existing.map((r) => [`${r.screenId}|${r.slotKey}`, r]));

    let sentLastDay = await this.prisma.client.screenRebootRun.count({
      where: { tenantId, dispatchedAt: { gte: new Date(nowMs - DAY_MS) } },
    });
    const cap = tenantNightlyCap();
    let sentThisTick = 0;

    // ── 3. Decide, per screen ────────────────────────────────────────────
    for (const s of screens) {
      const policy = policyByGroup.get(s.screenGroupId);
      if (!policy) continue;
      const group = groupById.get(s.screenGroupId);
      const zone = resolveScreenTimeZone({
        screenOverride: s.timezone ?? null,
        locationSetting: tenant?.timezone ?? null,
        screen: { latitude: s.latitude, longitude: s.longitude },
        group: group ? { latitude: group.latitude, longitude: group.longitude } : null,
        location: tenant ? { latitude: tenant.latitude, longitude: tenant.longitude } : null,
      }).zone;
      const classKey = classKeyOf(s);
      const lastPingMs = s.lastPingAt ? new Date(s.lastPingAt).getTime() : null;
      const reachedBySyncPlaylist = syncScreenIds.has(s.id) || (!!s.screenGroupId && syncGroupIds.has(s.screenGroupId));
      const facts: RebootFacts = {
        nowMs,
        policy,
        screenId: s.id,
        timeZone: zone,
        windows: windowsForScreen({ id: s.id, screenGroupId: s.screenGroupId }, scheduleRows),
        canRestart: verdictCanRestart(s.displayCapabilities),
        panelOff: panelIsOff(s.nativeRuntimeReport, s.softBlankAt),
        syncActive:
          syncReadFailed ||
          resolveScreenSync({ groupSyncMode: group?.syncMode ?? null, scheduledPlaylistSync: [reachedBySyncPlaylist] }).enabled,
        emergencyActive: false, // resolved below, only for a would-be send
        otaInFlight: otaIsInFlight(
          s,
          pushIsActive({ pendingAt: s.forceApkUpdatePendingAt, hold: s.forceApkUpdateHold }, nowMs),
          nowMs,
        ),
        online: lastPingMs !== null && nowMs - lastPingMs < ONLINE_FRESH_MS,
        uptimeMs: uptimeFrom(s.nativeRuntimeReport, s.nativeRuntimeReportAt, nowMs),
        classBusy: busyClasses.size > 0 && !(busyClasses.size === 1 && busyClasses.has(classKey)),
        tenantCapReached: sentLastDay >= cap || sentThisTick >= PER_TENANT_PER_TICK,
        returnWindowMs: windowMs,
      };
      let decision = decideScheduledReboot(facts);
      if (!decision.due) continue;
      const key = `${s.id}|${decision.slot.slotKey}`;
      const prior = runByKey.get(key);
      if (prior && prior.status !== RUN_STATUS.WAITING) continue; // this slot is decided
      result.evaluated++;

      if (decision.verdict === 'send') {
        const hold = await resolveEmergencyHold(this.prisma, { id: s.id, tenantId });
        if (hold.active) decision = decideScheduledReboot({ ...facts, emergencyActive: true });
      }
      if (!decision.due) continue;
      const base = {
        tenantId,
        screenId: s.id,
        policyId: policy.id,
        slotKey: decision.slot.slotKey,
        scheduledFor: new Date(decision.slot.startMs),
        hardwareClass: classKey,
      };

      if (decision.verdict !== 'send') {
        const status = decision.verdict === 'wait' ? RUN_STATUS.WAITING : RUN_STATUS.SKIPPED;
        if (status === RUN_STATUS.WAITING) result.waiting++;
        else result.skipped++;
        if (prior) {
          await this.prisma.client.screenRebootRun.updateMany({
            where: { id: prior.id, tenantId, status: RUN_STATUS.WAITING },
            data: { status, reason: decision.reason },
          });
        } else {
          await this.claim({ ...base, status, reason: decision.reason });
        }
        continue;
      }

      // ── Claim, then dispatch through the operator's own path ────────────
      let runId: string | null;
      if (prior) {
        const c = await this.prisma.client.screenRebootRun.updateMany({
          where: { id: prior.id, tenantId, status: RUN_STATUS.WAITING },
          data: { status: RUN_STATUS.SENDING, reason: null },
        });
        runId = c.count === 1 ? prior.id : null;
      } else {
        runId = await this.claim({ ...base, status: RUN_STATUS.SENDING, reason: null });
      }
      if (!runId) continue;
      const bootBefore = bootCountFrom(s.nativeRuntimeReport);
      // canRestart was true, so one of the two exists; REBOOT is preferred.
      const restartAction = restartActionFor(s.displayCapabilities) ?? 'REBOOT';
      const dispatchedAt = new Date();
      let status: string = RUN_STATUS.SENT;
      let reason: string | null = null;
      let actionId: string | null = null;
      try {
        const res: any = await runDisplayControl(
          { prisma: this.prisma, display: this.display },
          { id: s.id, tenantId, displayCapabilities: s.displayCapabilities, lastPushConnectedAt: s.lastPushConnectedAt },
          { userId: null },
          { action: restartAction, reason: `scheduled-restart:${policy.id}` } as any,
        );
        actionId = typeof res?.actionId === 'string' ? res.actionId : null;
        if (res?.delivered !== true) {
          status = RUN_STATUS.UNDELIVERED;
          reason = typeof res?.deliveryReason === 'string' ? res.deliveryReason : 'undelivered';
        }
      } catch (e) {
        status = RUN_STATUS.REFUSED;
        reason = e instanceof DisplayActionUnsupportedError ? e.code : 'error';
      }
      await this.prisma.client.screenRebootRun.updateMany({
        where: { id: runId, tenantId },
        data: { status, reason, dispatchedAt, actionId, bootBefore },
      });
      if (status === RUN_STATUS.SENT) {
        result.sent++;
        sentThisTick++;
        sentLastDay++;
        busyClasses.add(classKey);
      } else {
        result.skipped++;
      }
    }
  }

  /** Insert the slot's row; null when another tick already holds it (unique key). */
  private async claim(data: Record<string, unknown>): Promise<string | null> {
    try {
      const row = (await this.prisma.client.screenRebootRun.create({ data: data as any })) as any;
      return row.id as string;
    } catch (e: any) {
      if (e?.code === 'P2002') return null;
      throw e;
    }
  }
}
