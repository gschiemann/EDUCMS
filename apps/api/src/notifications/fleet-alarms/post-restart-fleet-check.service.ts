/**
 * PostRestartFleetCheckService — the OWNER's post-restart fleet check
 * (2026-10-23). See fleet-alarm-policy.ts for the why.
 *
 * On boot, every replica records ITS cohort: the paired, non-revoked screens
 * of live organisations whose player checked in during the 15 minutes before
 * this process started. At +10 and +20 minutes after the boot, whichever
 * process leads LEASE.POST_RESTART_FLEET_CHECK re-reads those screens and
 * asks how many are not back:
 *   - MISSING — no check-in since the boot (past the 5-minute hand-over, when
 *     the old container may still have been serving them), and not meant to
 *     be off by the customer alerts' own `intendedDowntime` rules (on/off
 *     schedule, update window, remote power-off, Android standby, a reboot or
 *     update in progress, just installed), read with the same queries;
 *   - DOWNGRADED — checked in, but fell to a 1-hour credential + "re-pair
 *     required" after the boot (what a register gives a screen it can no
 *     longer prove: the retired-key screens' shape once register stops
 *     401'ing them).
 * At least 3 of them (or 10 % of a small fleet, never one) → ONE email to
 * PLATFORM_ALERT_EMAILS for this boot, listing every screen with its
 * organisation and last check-in. +20 runs only if +10 did not alert; a
 * Redis claim keyed by the Railway deployment keeps two replicas of the same
 * deploy from both sending it.
 *
 * A normal deploy sends nothing: a healthy screen checks in every ~25–60 s,
 * so by +10 min every screen that came back has a check-in well after the
 * hand-over. Skipped (never guessed) when the platform health monitor reports
 * the database / signer down — our own check-ins cannot be trusted then, and
 * that monitor already pages for it — or when the intended-downtime facts
 * cannot be read.
 *
 * Owner-only. Kill switch: POST_RESTART_FLEET_CHECK_DISABLED=1. Off under
 * NODE_ENV=test.
 */
import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { hostname } from 'os';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../realtime/redis.service';
import { LEASE, LeaderLeaseService, leadThisTick } from '../../realtime/leader-lease.service';
import { PlatformAlertMailer } from '../../email/platform-alert-mailer.service';
import { degradedPlatformComponents } from '../../health/platform-degradation';
import { CustomerAlertEmailsService, type LoadedFacts } from '../customer-alerts/customer-alert-emails.service';
import { intendedDowntime } from '../customer-alerts/customer-alert-policy';
import {
  FLEET_ALARM_RULES,
  checkedInSinceBoot,
  evaluateBootCheck,
  postRestartFleetCheckDisabled,
  refusalRuns,
  type BootCheckVerdict,
  type BootCohortRow,
} from './fleet-alarm-policy';
import { readDeviceCredentialRefusals } from './device-credential-refusals';
import { renderBootCheckAlert, type BootCheckScreen } from './fleet-alarm-copy';
import { labelScreens } from './screen-labels';

const MIN = 60_000;
/** The boot snapshot waits for the pool to warm; it is retaken lazily if it failed. */
const SNAPSHOT_DELAY_MS = 30_000;
const COHORT_LIMIT = 20_000;
const ID_CHUNK = 5_000;
const ALERT_CLAIM_TTL_S = 2 * 60 * 60;

const COHORT_SELECT = {
  id: true,
  name: true,
  tenantId: true,
  status: true,
  pairedAt: true,
  lastPingAt: true,
  playerVersionAt: true,
  managerVersionAt: true,
  authState: true,
  authStateChangedAt: true,
  tenant: { select: { archivedAt: true } },
} as const;

type CohortRecord = BootCohortRow & { tenant: { archivedAt: Date | null } | null };

/** The ioredis call the per-deployment claim needs. */
interface ClaimClient {
  set(key: string, value: string, ex: 'EX', seconds: number, nx: 'NX'): Promise<unknown>;
}

export type FleetCheckStatus = 'ok' | 'alerted' | 'already-alerted' | 'not-leader' | 'skipped';

export interface FleetCheckResult {
  offsetMs: number;
  status: FleetCheckStatus;
  reason?: string;
  verdict?: BootCheckVerdict;
}

@Injectable()
export class PostRestartFleetCheckService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PostRestartFleetCheckService.name);
  private readonly timers: NodeJS.Timeout[] = [];
  /** When this process started (ms). */
  bootAtMs: number;
  private cohortIds: string[] | null = null;
  /** One alert per boot. */
  private alerted = false;
  private readonly checked = new Set<number>();

  /** Clock seam for tests. */
  now: () => number = () => Date.now();

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly alerts?: CustomerAlertEmailsService,
    @Optional() private readonly mailer?: PlatformAlertMailer,
    @Optional() private readonly lease?: LeaderLeaseService,
    @Optional() private readonly redis?: RedisService,
  ) {
    this.bootAtMs = Math.round(Date.now() - process.uptime() * 1000);
  }

  onModuleInit() {
    if (process.env.NODE_ENV === 'test') return;
    if (postRestartFleetCheckDisabled()) {
      this.logger.log('Post-restart fleet check disabled (POST_RESTART_FLEET_CHECK_DISABLED)');
      return;
    }
    const at = (offsetMs: number, fn: () => Promise<unknown>) => {
      const t = setTimeout(() => void fn().catch(() => undefined), Math.max(0, this.bootAtMs + offsetMs - Date.now()));
      t.unref?.();
      this.timers.push(t);
    };
    at(SNAPSHOT_DELAY_MS, () => this.snapshot());
    for (const offset of FLEET_ALARM_RULES.BOOT_CHECK_OFFSETS_MS) at(offset, () => this.check(offset));
  }

  onModuleDestroy() {
    for (const t of this.timers) clearTimeout(t);
    this.timers.length = 0;
  }

  /**
   * Record the cohort. The predicate only depends on the boot time
   * (`lastPingAt` never moves backwards), so taking it late — after a failed
   * first attempt — yields the same set.
   */
  async snapshot(): Promise<number | null> {
    try {
      const rows = (await this.prisma.client.screen.findMany({
        where: {
          tenantId: { not: null },
          status: { not: 'REVOKED' },
          tenant: { is: { archivedAt: null } },
          // Bounded on both sides: a future-dated (demo) ping is not a check-in.
          lastPingAt: { gte: new Date(this.bootAtMs - FLEET_ALARM_RULES.BOOT_COHORT_LOOKBACK_MS), lte: new Date(this.now() + MIN) },
          OR: [{ pairedAt: null }, { pairedAt: { lte: new Date(this.bootAtMs) } }],
        },
        select: { id: true },
        take: COHORT_LIMIT,
      })) as Array<{ id: string }>;
      this.cohortIds = rows.map((r) => r.id);
      this.logger.log(
        `[fleet-check] boot ${new Date(this.bootAtMs).toISOString()}: ${this.cohortIds.length} paired screen(s) checked in ` +
          `during the 15 min before it; checking them at +${FLEET_ALARM_RULES.BOOT_CHECK_OFFSETS_MS.map((m) => m / MIN).join(' and +')} min`,
      );
      return this.cohortIds.length;
    } catch (e) {
      this.logger.warn(`[fleet-check] boot snapshot failed (${(e as Error)?.message ?? e}) — it is retaken at the first check`);
      return null;
    }
  }

  /** One check point (`offsetMs` after the boot). */
  async check(offsetMs: number): Promise<FleetCheckResult> {
    const done = (status: FleetCheckStatus, reason?: string, verdict?: BootCheckVerdict): FleetCheckResult => ({
      offsetMs,
      status,
      ...(reason ? { reason } : {}),
      ...(verdict ? { verdict } : {}),
    });
    if (this.alerted) return done('already-alerted');
    if (this.checked.has(offsetMs)) return done('skipped', 'already checked');
    this.checked.add(offsetMs);
    try {
      const status = await leadThisTick(this.lease, LEASE.POST_RESTART_FLEET_CHECK);
      if (!status.leader) return done('not-leader');

      const now = this.now();
      const degraded = degradedPlatformComponents(now);
      if (degraded.some((c) => c.startsWith('platform:critical'))) {
        this.logger.warn(`[fleet-check] +${offsetMs / MIN} min skipped: the platform health monitor reports ${degraded.join(', ')}`);
        return done('skipped', 'platform-critical');
      }
      if (!this.cohortIds) await this.snapshot();
      if (!this.cohortIds) return done('skipped', 'no-snapshot');
      if (this.cohortIds.length === 0) return done('ok', 'empty-cohort');

      const rows = (await this.loadCohortRows(this.cohortIds)).filter((r) => !r.tenant?.archivedAt);
      const silent = rows.filter((r) => r.tenantId && r.status !== 'REVOKED' && !checkedInSinceBoot(r.lastPingAt, this.bootAtMs));

      // "Meant to be off?" — the customer alerts' own facts and rules.
      let facts = new Map<string, LoadedFacts>();
      if (silent.length) {
        if (!this.alerts) return done('skipped', 'no-intended-downtime-facts');
        const tenants = await this.alerts.loadTenants(silent.map((r) => r.tenantId as string));
        facts = await this.alerts.loadFacts(
          silent.map((r) => ({ screenId: r.id, tenantId: r.tenantId as string })),
          tenants,
          now,
        );
        // loadFacts returns NOTHING when a schedule / audit / ledger read
        // failed (an unknown schedule might have been an "off" one): wait for
        // the next check point rather than guess.
        if (facts.size === 0) {
          this.logger.warn(`[fleet-check] +${offsetMs / MIN} min skipped: the on/off-schedule facts could not be read`);
          return done('skipped', 'intended-downtime-unreadable');
        }
      }
      const verdict = evaluateBootCheck({
        bootAtMs: this.bootAtMs,
        cohortIds: this.cohortIds,
        rows,
        excuse: (row) => {
          const f = facts.get(row.id);
          // Read by the cohort query, gone from the facts read a moment later
          // (deleted in between): not a screen anyone is waiting for.
          if (!f) return 'deleted';
          return intendedDowntime(f.facts, 'OFFLINE', row.lastPingAt?.getTime() ?? this.bootAtMs, now);
        },
      });
      const notBack = verdict.missing.length + verdict.downgraded.length;
      this.logger.log(
        `[fleet-check] +${offsetMs / MIN} min after boot: cohort=${verdict.cohort} not-back=${notBack} ` +
          `(missing=${verdict.missing.length} downgraded=${verdict.downgraded.length}) excused=${JSON.stringify(verdict.excused)} ` +
          `gone=${verdict.gone} threshold=${verdict.threshold} → ${verdict.alert ? 'ALERT' : 'ok'}`,
      );
      if (!verdict.alert) return done('ok', undefined, verdict);

      if (!(await this.claimAlert())) {
        this.alerted = true;
        return done('already-alerted', 'another replica of this deployment sent it', verdict);
      }
      await this.sendAlert(verdict, offsetMs, now, degraded);
      this.alerted = true;
      return done('alerted', undefined, verdict);
    } catch (e) {
      this.logger.warn(`[fleet-check] +${offsetMs / MIN} min failed: ${(e as Error)?.message ?? e}`);
      return done('skipped', 'error');
    }
  }

  // ─── Internals ──────────────────────────────────────────────────────────

  private async loadCohortRows(ids: string[]): Promise<CohortRecord[]> {
    const out: CohortRecord[] = [];
    for (let i = 0; i < ids.length; i += ID_CHUNK) {
      const chunk = ids.slice(i, i + ID_CHUNK);
      const rows = (await this.prisma.client.screen.findMany({
        where: { id: { in: chunk } },
        select: COHORT_SELECT,
      })) as CohortRecord[];
      out.push(...rows);
    }
    return out;
  }

  /** One alert per DEPLOYMENT across replicas (Redis NX); without Redis, per process. */
  private async claimAlert(): Promise<boolean> {
    const pub = this.redis?.isConnected?.() ? (this.redis.publisher as unknown as ClaimClient | null) : null;
    if (!pub || typeof pub.set !== 'function') return true;
    const deployment = String(process.env.RAILWAY_DEPLOYMENT_ID ?? '').trim();
    const key = `venueos:fleet-check:alerted:${deployment ? `deploy:${deployment}` : `boot:${hostname()}:${process.pid}:${this.bootAtMs}`}`;
    try {
      return (await pub.set(key, String(this.bootAtMs), 'EX', ALERT_CLAIM_TTL_S, 'NX')) === 'OK';
    } catch {
      return true;
    }
  }

  private async sendAlert(verdict: BootCheckVerdict, offsetMs: number, now: number, degraded: string[]): Promise<void> {
    const named = [...verdict.missing, ...verdict.downgraded];
    const labels = await labelScreens(this.alerts, named);
    const { buckets } = await readDeviceCredentialRefusals(this.redis, now);
    const refusals = new Map(refusalRuns(buckets, now).map((r) => [r.screenId, r]));
    const graceMark = this.bootAtMs + FLEET_ALARM_RULES.BOOT_HANDOVER_GRACE_MS;
    const toScreen = (r: BootCohortRow): BootCheckScreen => {
      const unit = Math.max(r.playerVersionAt?.getTime() ?? 0, r.managerVersionAt?.getTime() ?? 0);
      const refusal = refusals.get(r.id);
      return {
        ...(labels.get(r.id) ?? { id: r.id, name: r.name, orgName: '—', locationName: null }),
        lastPingAtMs: r.lastPingAt?.getTime() ?? null,
        unitSeenSinceBootMs: unit >= graceMark ? unit : null,
        refusal: refusal ? { sources: refusal.sources, categories: refusal.categories } : null,
        downgradedAtMs: r.authStateChangedAt?.getTime() ?? null,
      };
    };
    const email = renderBootCheckAlert({
      bootAtMs: this.bootAtMs,
      nowMs: now,
      checkOffsetMs: offsetMs,
      commit: process.env.RAILWAY_GIT_COMMIT_SHA || process.env.GIT_COMMIT_SHA || null,
      cohort: verdict.cohort,
      expected: verdict.expected,
      excused: verdict.excused,
      gone: verdict.gone,
      missing: verdict.missing.map(toScreen),
      downgraded: verdict.downgraded.map(toScreen),
      degradedComponents: degraded,
    });
    this.logger.warn(`[fleet-check] ${email.subject}`);
    await this.mailer?.sendAlert(email.subject, email.body, 'ALERT_POST_RESTART_FLEET_CHECK');
  }
}
