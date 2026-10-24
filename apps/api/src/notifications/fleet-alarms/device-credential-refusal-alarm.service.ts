/**
 * DeviceCredentialRefusalAlarmService — the OWNER's device-credential refusal
 * alarm (2026-10-23). See fleet-alarm-policy.ts for the why.
 *
 * Every minute, on the leader only (LEASE.DEVICE_CREDENTIAL_REFUSAL_ALARM):
 *   1. read the last 15 minutes of refusals — one Redis set of distinct
 *      screens per minute, written by every replica (device-credential-
 *      refusals.ts), merged with this process's own copy;
 *   2. keep the screens refused in every minute (one gap allowed) for ≥ 10
 *      minutes and still being refused;
 *   3. keep only REAL ones: an existing, paired, non-revoked screen of a live
 *      organisation with no push channel admitted in the last 3 minutes (a
 *      forged token naming a healthy screen cannot count, and neither can a
 *      screen that got back in);
 *   4. ≥ 3 such screens → one email to PLATFORM_ALERT_EMAILS; a reminder at
 *      most once an hour while it lasts; a recovery note once it has been
 *      clear for 5 minutes. The state rides in Redis, so a deploy (the usual
 *      CAUSE of this incident) neither re-sends nor forgets it.
 *
 * Owner-only: nothing here emails a customer. No restart quiet: an outage
 * caused by a deploy starts AT the deploy, and this alarm is how it is seen
 * ten minutes later. No intended-downtime filter: a screen whose credential
 * is being refused is awake and trying.
 *
 * Kill switch: DEVICE_CREDENTIAL_REFUSAL_ALARM_DISABLED=1 (also stops the
 * recording on the refusal paths). Off under NODE_ENV=test.
 */
import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../realtime/redis.service';
import { LEASE, LeaderLeaseService, leadThisTick } from '../../realtime/leader-lease.service';
import { PlatformAlertMailer } from '../../email/platform-alert-mailer.service';
import { CustomerAlertEmailsService } from '../customer-alerts/customer-alert-emails.service';
import {
  FLEET_ALARM_RULES,
  INITIAL_REFUSAL_ALARM_STATE,
  deviceCredentialRefusalAlarmDisabled,
  isContinuousRefusal,
  parseRefusalAlarmState,
  pushChannelLive,
  refusalBucketOf,
  refusalRuns,
  stepRefusalAlarm,
  type RefusalAlarmAction,
  type RefusalAlarmState,
  type RefusalRun,
} from './fleet-alarm-policy';
import { readDeviceCredentialRefusals } from './device-credential-refusals';
import { renderRefusalAlert, renderRefusalRecovery, type RefusedScreen } from './fleet-alarm-copy';
import { labelScreens } from './screen-labels';

const TICK_MS = 60_000;
const STATE_KEY = 'venueos:devcred-refusal-alarm:v1';
const STATE_TTL_S = 7 * 24 * 60 * 60;
/** Bound on the screen read (the longest runs first). */
const MAX_CANDIDATES = 1_000;

interface CandidateRow {
  id: string;
  name: string;
  tenantId: string | null;
  status: string | null;
  lastPingAt: Date | null;
  lastPushConnectedAt: Date | null;
  tenant: { archivedAt: Date | null } | null;
}

export interface RefusalAlarmTickResult {
  /** Screens refused continuously ≥ 10 min (before the reality check). */
  continuous: number;
  /** …of which real, paired, without a live push channel. */
  qualifying: string[];
  action: RefusalAlarmAction['kind'];
  /** Redis answered — the count covers every replica. */
  shared: boolean;
}

@Injectable()
export class DeviceCredentialRefusalAlarmService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DeviceCredentialRefusalAlarmService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  /** This process's copy of the alarm state; Redis holds the shared one. */
  private state: RefusalAlarmState = { ...INITIAL_REFUSAL_ALARM_STATE };
  private lastLoggedCount = 0;

  /** Clock seam for tests. */
  now: () => number = () => Date.now();

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly redis?: RedisService,
    @Optional() private readonly lease?: LeaderLeaseService,
    @Optional() private readonly mailer?: PlatformAlertMailer,
    @Optional() private readonly alerts?: CustomerAlertEmailsService,
  ) {}

  onModuleInit() {
    if (process.env.NODE_ENV === 'test') return;
    if (deviceCredentialRefusalAlarmDisabled()) {
      this.logger.log('Device-credential refusal alarm disabled (DEVICE_CREDENTIAL_REFUSAL_ALARM_DISABLED)');
      return;
    }
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    this.timer.unref?.();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const status = await leadThisTick(this.lease, LEASE.DEVICE_CREDENTIAL_REFUSAL_ALARM);
      if (!status.leader) return;
      await this.evaluate();
    } catch (e) {
      this.logger.warn(`[devcred-alarm] tick failed: ${(e as Error)?.message ?? e}`);
    } finally {
      this.running = false;
    }
  }

  /** One evaluation (the tick body; called directly by tests). */
  async evaluate(): Promise<RefusalAlarmTickResult> {
    const now = this.now();
    const { buckets, shared } = await readDeviceCredentialRefusals(this.redis, now);
    const allRuns = refusalRuns(buckets, now);
    const continuous = allRuns.filter((r) => isContinuousRefusal(r, now));
    const rows = await this.loadRows(continuous.slice(0, MAX_CANDIDATES).map((r) => r.screenId));
    const qualifying = continuous.filter((r) => {
      const row = rows.get(r.screenId);
      return (
        !!row &&
        !!row.tenantId &&
        row.status !== 'REVOKED' &&
        !row.tenant?.archivedAt &&
        !pushChannelLive(row.lastPushConnectedAt, now)
      );
    });
    const ids = qualifying.map((r) => r.screenId);
    const earliest = qualifying.length ? Math.min(...qualifying.map((r) => r.sinceMs)) : null;

    const prior = await this.loadState();
    const { state, action } = stepRefusalAlarm(prior, ids, earliest, now);

    if (action.kind === 'alert') {
      await this.sendAlert(qualifying, rows, state, action.reminder, shared, now);
    } else if (action.kind === 'recovered') {
      await this.sendRecovery(action.alertedIds, action.incidentSinceMs, allRuns, now);
    }
    if (JSON.stringify(state) !== JSON.stringify(prior)) await this.saveState(state);

    if (action.kind !== 'none' || ids.length !== this.lastLoggedCount) {
      this.lastLoggedCount = ids.length;
      this.logger.log(
        `[devcred-alarm] refused continuously ≥${FLEET_ALARM_RULES.REFUSAL_CONTINUOUS_MS / 60_000} min: ${ids.length} screen(s)` +
          `${ids.length ? ` (${ids.slice(0, 20).join(', ')}${ids.length > 20 ? ', …' : ''})` : ''} action=${action.kind}` +
          `${shared ? '' : ' (this replica only — Redis unavailable)'}`,
      );
    }
    return { continuous: continuous.length, qualifying: ids, action: action.kind, shared };
  }

  // ─── Emails ─────────────────────────────────────────────────────────────

  private async sendAlert(
    runs: RefusalRun[],
    rows: Map<string, CandidateRow>,
    state: RefusalAlarmState,
    reminder: boolean,
    shared: boolean,
    now: number,
  ): Promise<void> {
    const labels = await labelScreens(this.alerts, runs.map((r) => rows.get(r.screenId)).filter((r): r is CandidateRow => !!r));
    const screens: RefusedScreen[] = runs.map((r) => {
      const row = rows.get(r.screenId);
      const label = labels.get(r.screenId) ?? { id: r.screenId, name: r.screenId, orgName: '—', locationName: null };
      return {
        ...label,
        sinceMs: r.sinceMs,
        lastPingAtMs: row?.lastPingAt?.getTime() ?? null,
        lastPushConnectedAtMs: row?.lastPushConnectedAt?.getTime() ?? null,
        sources: r.sources,
        categories: r.categories,
      };
    });
    const email = renderRefusalAlert({ nowMs: now, reminder, incidentSinceMs: state.incidentSinceMs, screens, shared });
    this.logger.warn(`[devcred-alarm] ${email.subject}`);
    await this.mailer?.sendAlert(email.subject, email.body, 'ALERT_DEVICE_CREDENTIAL_REFUSALS');
  }

  private async sendRecovery(alertedIds: string[], incidentSinceMs: number | null, allRuns: RefusalRun[], now: number): Promise<void> {
    const nowBucket = refusalBucketOf(now);
    const stillIds = new Set(
      allRuns.filter((r) => alertedIds.includes(r.screenId) && nowBucket - refusalBucketOf(r.lastMs) <= 1).map((r) => r.screenId),
    );
    let rows: Array<{ id: string; name: string; tenantId: string | null }> = [];
    try {
      rows = (await this.prisma.client.screen.findMany({
        where: { id: { in: alertedIds.slice(0, MAX_CANDIDATES) } },
        select: { id: true, name: true, tenantId: true },
      })) as typeof rows;
    } catch {
      rows = [];
    }
    const labels = await labelScreens(this.alerts, rows);
    const label = (id: string) => labels.get(id) ?? { id, name: id, orgName: '—', locationName: null };
    const email = renderRefusalRecovery({
      nowMs: now,
      incidentSinceMs,
      alerted: alertedIds.map(label),
      stillRefused: [...stillIds].map(label),
    });
    this.logger.log(`[devcred-alarm] ${email.subject}`);
    await this.mailer?.sendAlert(email.subject, email.body, 'ALERT_DEVICE_CREDENTIAL_REFUSALS_RECOVERED');
  }

  // ─── Reads ──────────────────────────────────────────────────────────────

  private async loadRows(ids: string[]): Promise<Map<string, CandidateRow>> {
    if (ids.length === 0) return new Map();
    const rows = (await this.prisma.client.screen.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        name: true,
        tenantId: true,
        status: true,
        lastPingAt: true,
        lastPushConnectedAt: true,
        tenant: { select: { archivedAt: true } },
      },
    })) as CandidateRow[];
    return new Map(rows.map((r) => [r.id, r]));
  }

  // ─── State (Redis, with this process's copy as the fallback) ────────────

  private async loadState(): Promise<RefusalAlarmState> {
    if (this.redis?.isConnected?.()) {
      const raw = await this.redis.getString(STATE_KEY);
      if (raw) this.state = parseRefusalAlarmState(raw);
    }
    return this.state;
  }

  private async saveState(next: RefusalAlarmState): Promise<void> {
    this.state = next;
    if (this.redis?.isConnected?.()) await this.redis.setString(STATE_KEY, JSON.stringify(next), STATE_TTL_S);
  }
}
