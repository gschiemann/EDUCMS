/**
 * CustomerAlertEmailsService — screen-problem + emergency-record EMAILS to a
 * customer's admins (2026-10-23).
 *
 * Until now a screen problem reached a customer only as an in-app bell row;
 * only the platform owner got email. This sends:
 *
 *   a. OFFLINE — a screen silent ≥ 15 min (confirmed on two consecutive scans
 *      of the EXISTING offline detector — `NotificationsService.scanOfflineScreens`
 *      hands us the rows it already read; there is no second detector). One
 *      email per location per scan, so a site-wide drop is ONE email listing
 *      the screens. "Back online" only for screens we emailed about, after the
 *      recovery has held 5 min.
 *   b. NO_CONTENT — pinging, content assigned, a player that posts render
 *      proof, and the render-trust grade says no picture / "Content
 *      unavailable" for ≥ 20 min on two consecutive scans. Recovery note when
 *      content proof has held 5 min.
 *   c. EMERGENCY / ALL_CLEAR — a record copy, queued AFTER the emergency
 *      action committed (`recordEmergency`, synchronous, returns void, never
 *      throws): it can neither delay nor fail the trigger / all-clear.
 *
 * FALSE POSITIVES ARE THE FAILURE MODE (owner, binding). Every rule that
 * keeps an email from going out lives in customer-alert-policy.ts with a test;
 * this file only gathers the facts and applies them:
 *   - MODE: `CUSTOMER_ALERT_EMAILS_MODE` shadow (default) | on | off — in
 *     shadow everything is computed and the would-be email goes ONLY to
 *     PLATFORM_ALERT_EMAILS. `CUSTOMER_ALERT_EMAILS_DISABLED=1` = hard off.
 *   - intended downtime, maintenance, unused / unpaired screens → defer;
 *   - API restart (15 min), a degraded platform, a platform-wide incident →
 *     defer (and ONE platform alert to the owner for the incident);
 *   - flapping → at most one problem email per screen per 6 h;
 *   - per organisation: 6 emails per rolling hour, then one digest.
 *
 * Runs inside the offline scanner's tick, which is leader-leased
 * (LEASE.OFFLINE_SCREEN_SCAN), so exactly one replica decides. Incident state
 * is in Postgres (`screen_alert_incidents`) so a restart neither re-sends nor
 * forgets; the two-scan confirmation is in memory on purpose — a restart
 * starts it again, which can only delay an email, never add one.
 */
import { Injectable, Logger, Optional } from '@nestjs/common';
import { AppRole } from '@cms/database';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from '../../email/email.service';
import { PlatformAlertMailer } from '../../email/platform-alert-mailer.service';
import { degradedPlatformComponents } from '../../health/platform-degradation';
import { ScreenWedgeDetectorCron } from '../../screens/screen-wedge-detector.cron';
import { DISPLAY_AUDIT_ACTIONS } from '../../display/display.service';
import type { OfflineScanResult, OfflineSnapshotScreen } from '../notifications.service';
import {
  ALERT_RULES,
  ConsecutiveScans,
  intendedDowntime,
  isFlapping,
  lastPowerCommandOf,
  noContentVerdict,
  orgHourlyLimit,
  platformClusterAround,
  platformGate,
  resolveAlertMode,
  type AlertMode,
  type ProblemEvent,
  type ProblemKind,
  type ScreenFacts,
} from './customer-alert-policy';
import {
  alertLocaleOf,
  renderDigestEmail,
  renderEmergencyEmail,
  renderScreenAlertEmail,
  type AlertLocale,
  type RenderedEmail,
  type ScreenAlertItem,
  type ScreenItemKind,
} from './customer-alert-copy';
import { gradeScreenRow } from './render-trust-grade';
import { otaWindowOf, windowsForScreen, type DisplayScheduleRowLike } from './schedule-windows';

const MIN = 60_000;
/** Ledger kinds that mean "rebooting / updating right now" (screens/events/screen-events.ts). */
const MAINTENANCE_LEDGER_KINDS = ['app-relaunch', 'ota-download', 'ota-install', 'ota-installed', 'ota-needs-tap'];
const ADMIN_ROLES = [AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN] as string[];

interface TenantMeta {
  id: string;
  name: string;
  slug: string;
  parentId: string | null;
  archivedAt: Date | null;
  otaWindowStart: string | null;
  otaWindowEnd: string | null;
  otaWindowTimezone: string | null;
}

interface Recipient {
  id: string;
  email: string;
  tenantId: string;
  locale: AlertLocale;
  homeSlug: string;
}

interface IncidentRow {
  id: string;
  screenId: string;
  tenantId: string;
  kind: string;
  open: boolean;
  state: string;
  emailedMode: string | null;
  screenName: string;
  startedAt: Date;
  recoveringSince: Date | null;
  lastEmailedAt: Date | null;
}

/** A problem we decided to act on this tick. */
interface NewProblem {
  screenId: string;
  tenantId: string;
  screenName: string;
  kind: ProblemKind;
  startedAtMs: number;
  contentUnavailable?: boolean;
}

export interface CustomerAlertTickResult {
  mode: AlertMode;
  gate?: string;
  offlineCandidates: number;
  noContentCandidates: number;
  deferred: Record<string, number>;
  opened: number;
  silenced: number;
  held: number;
  recovered: number;
  sends: number;
  platformIncident: boolean;
}

export interface EmergencyRecordInput {
  event: 'TRIGGERED' | 'CLEARED';
  overrideId: string;
  alertType?: string | null;
  isDrill: boolean;
  /** Every tenant the alert reached (a district alert: the district + its schools). */
  tenantIds: string[];
  screenCount?: number;
}

@Injectable()
export class CustomerAlertEmailsService {
  private readonly logger = new Logger(CustomerAlertEmailsService.name);

  /** Offline ≥ 15 min, consecutive scans. */
  private readonly offlineDue = new ConsecutiveScans();
  /** Any no-content signal, consecutive scans (its `since` times "Content unavailable"). */
  private readonly noContentSeen = new ConsecutiveScans();
  /** No content ≥ 20 min, consecutive scans. */
  private readonly noContentDue = new ConsecutiveScans();
  /** Tenants the cohort pass called a site-wide drop, and when. */
  private readonly infraAt = new Map<string, number>();
  private platformQuietUntil = 0;
  private lastPlatformAlertAt = 0;
  private fleetCache: { at: number; n: number } | null = null;
  private lastPruneAt = 0;
  private readonly emergencySeen = new Map<string, number>();
  private lastNotConfiguredLog = 0;

  /** Clock + uptime seams for tests. */
  now: () => number = () => Date.now();
  uptimeMs: () => number = () => process.uptime() * 1000;

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly email?: EmailService,
    @Optional() private readonly platformMailer?: PlatformAlertMailer,
  ) {}

  // ═════════════════════════════════════════════════════════════════════
  // Emergency record copy — FIRE AND FORGET
  // ═════════════════════════════════════════════════════════════════════

  /**
   * Queue the record copy of an emergency trigger / all-clear. Called by the
   * emergency controller AFTER the action's writes, audit rows and dispatch.
   * Synchronous, returns nothing, never throws: the work starts on a later
   * turn of the event loop and every failure inside it is swallowed.
   */
  recordEmergency(input: EmergencyRecordInput): void {
    try {
      if (resolveAlertMode() === 'off') return;
      const key = `${input.overrideId}:${input.event}`;
      const now = Date.now();
      if (this.emergencySeen.has(key)) return;
      if (this.emergencySeen.size > 1_000) this.emergencySeen.clear();
      this.emergencySeen.set(key, now);
      setImmediate(() => {
        this.sendEmergencyRecord(input).catch((e) =>
          this.logger.warn(`[alert-email] emergency record copy failed: ${(e as Error)?.message ?? e}`),
        );
      });
    } catch {
      /* never let bookkeeping touch the emergency path */
    }
  }

  /** The body of `recordEmergency` (exported for tests; never call it from the emergency path). */
  async sendEmergencyRecord(input: EmergencyRecordInput): Promise<number> {
    const mode = resolveAlertMode();
    if (mode === 'off' || input.tenantIds.length === 0) return 0;
    const tenants = await this.loadTenants(input.tenantIds);
    const byOrg = new Map<string, string[]>();
    for (const id of input.tenantIds) {
      const t = tenants.get(id);
      if (!t || t.archivedAt) continue;
      const org = this.rootOf(id, tenants);
      byOrg.set(org, [...(byOrg.get(org) ?? []), id]);
    }
    const at = new Date();
    let sends = 0;
    for (const [orgId, ids] of byOrg) {
      const sent = await this.deliver({
        orgId,
        tenants,
        tenantIds: ids,
        kind: input.event === 'TRIGGERED' ? 'EMERGENCY' : 'ALL_CLEAR',
        mode,
        itemCount: ids.length,
        render: (locale, covered, r) => {
          // A recipient sees the locations they administer, the alert's own
          // target first (the district, for a district alert).
          const names = ids.filter((id) => covered.includes(id)).map((id) => tenants.get(id)?.name ?? '—');
          if (names.length === 0) return null;
          return renderEmergencyEmail(
            locale,
            {
              event: input.event,
              alertType: input.alertType,
              isDrill: input.isDrill,
              locationNames: names,
              screenCount: ids.length === 1 ? input.screenCount : undefined,
              at,
            },
            { emergencyUrl: this.url(`/${r.homeSlug}/emergency`), manageUrl: this.manageUrl(r) },
          );
        },
      });
      if (sent) sends++;
    }
    return sends;
  }

  // ═════════════════════════════════════════════════════════════════════
  // Screen problems — rides the offline scanner's leader-leased tick
  // ═════════════════════════════════════════════════════════════════════

  async onOfflineScan(scan: OfflineScanResult): Promise<CustomerAlertTickResult> {
    const mode = resolveAlertMode();
    const now = this.now();
    const result: CustomerAlertTickResult = {
      mode,
      offlineCandidates: 0,
      noContentCandidates: 0,
      deferred: {},
      opened: 0,
      silenced: 0,
      held: 0,
      recovered: 0,
      sends: 0,
      platformIncident: false,
    };
    if (mode === 'off' || !scan.offline) return result;
    const defer = (reason: string) => {
      result.deferred[reason] = (result.deferred[reason] ?? 0) + 1;
    };

    for (const id of scan.infraEventTenantIds ?? []) this.infraAt.set(id, now);
    for (const [id, at] of this.infraAt) if (now - at > 2 * 60 * MIN) this.infraAt.delete(id);

    const snapshot = scan.offline.filter(
      (s): s is OfflineSnapshotScreen & { tenantId: string; lastPingAt: Date } => !!s.tenantId && !!s.lastPingAt,
    );
    const offlineById = new Map(snapshot.map((s) => [s.id, s]));
    const ageOf = (s: { lastPingAt: Date }) => now - s.lastPingAt.getTime();

    const incidents = await this.loadTrackedIncidents();
    const open = (kind: ProblemKind) =>
      new Map(incidents.filter((i) => i.open && i.kind === kind).map((i) => [i.screenId, i]));
    const openOffline = open('OFFLINE');
    const openNoContent = open('NO_CONTENT');

    // ── Candidates (observed every scan, so confirmation counts are honest) ──
    const offlineDueNow = snapshot.filter(
      (s) => ageOf(s) >= ALERT_RULES.OFFLINE_DUE_MS && ageOf(s) <= ALERT_RULES.OFFLINE_MAX_AGE_MS && !openOffline.has(s.id),
    );
    this.offlineDue.observe(offlineDueNow.map((s) => s.id), now);

    const noContent = await this.findNoContentCandidates(now, openNoContent);
    this.noContentSeen.observe(noContent.map((c) => c.row.id), now);
    const noContentDueNow = noContent.filter((c) => {
      if (c.verdict.blank && c.verdict.signal === 'stale-proof') return now - c.verdict.sinceMs >= ALERT_RULES.NO_CONTENT_DUE_MS;
      const since = this.noContentSeen.since(c.row.id);
      return since !== null && now - since >= ALERT_RULES.NO_CONTENT_DUE_MS;
    });
    this.noContentDue.observe(noContentDueNow.map((c) => c.row.id), now);

    // ── Platform gate: restart / degraded / incident quiet window ──
    const gate = platformGate({
      uptimeMs: this.uptimeMs(),
      degradedComponents: degradedPlatformComponents(now),
      platformQuietUntilMs: this.platformQuietUntil,
      nowMs: now,
    });
    if (!gate.open) {
      // Nothing is decided while the platform itself is suspect — not even a
      // recovery. Confirmation starts over once it is healthy again.
      this.offlineDue.reset();
      this.noContentDue.reset();
      result.gate = gate.reason;
      return result;
    }

    // ── Confirmed candidates (+ same-location stragglers for one email per drop) ──
    const offlineConfirmed = offlineDueNow.filter((s) => this.offlineDue.confirmed(s.id));
    const confirmedTenants = new Set(offlineConfirmed.map((s) => s.tenantId));
    const offlineActionable = new Map(offlineConfirmed.map((s) => [s.id, s]));
    for (const s of snapshot) {
      if (offlineActionable.has(s.id) || openOffline.has(s.id) || !confirmedTenants.has(s.tenantId)) continue;
      if (ageOf(s) >= ALERT_RULES.STRAGGLER_MS && ageOf(s) <= ALERT_RULES.OFFLINE_MAX_AGE_MS) offlineActionable.set(s.id, s);
    }
    const noContentActionable = noContentDueNow.filter((c) => this.noContentDue.confirmed(c.row.id));
    result.offlineCandidates = offlineActionable.size;
    result.noContentCandidates = noContentActionable.length;

    const problemStartOf = (c: (typeof noContent)[number]) =>
      c.verdict.blank && c.verdict.signal === 'stale-proof' ? c.verdict.sinceMs : (this.noContentSeen.since(c.row.id) ?? now);

    // ── Tenants (names, hierarchy, update windows) for everything we may touch ──
    const tenantIds = new Set<string>([
      ...snapshot.filter((s) => ageOf(s) >= ALERT_RULES.OFFLINE_DUE_MS && ageOf(s) <= ALERT_RULES.OFFLINE_MAX_AGE_MS).map((s) => s.tenantId),
      ...noContent.map((c) => c.row.tenantId as string),
      ...incidents.map((i) => i.tenantId),
    ]);
    const tenants = await this.loadTenants(tenantIds);

    // ── Platform incident: many organisations at once is OUR problem ──
    const newProblems: NewProblem[] = [];
    if (offlineActionable.size > 0 || noContentActionable.length > 0) {
      const events: ProblemEvent[] = [
        ...snapshot
          .filter((s) => ageOf(s) >= ALERT_RULES.OFFLINE_DUE_MS && ageOf(s) <= ALERT_RULES.OFFLINE_MAX_AGE_MS)
          .map((s) => ({ screenId: s.id, orgId: this.rootOf(s.tenantId, tenants), startedAtMs: s.lastPingAt.getTime() })),
        ...noContentDueNow.map((c) => ({
          screenId: c.row.id,
          orgId: this.rootOf(c.row.tenantId as string, tenants),
          startedAtMs: problemStartOf(c),
        })),
      ];
      const fleet = await this.recentlyActiveFleet(now);
      const candidates: NewProblem[] = [
        ...[...offlineActionable.values()].map((s) => ({
          screenId: s.id,
          tenantId: s.tenantId,
          screenName: s.name,
          kind: 'OFFLINE' as const,
          startedAtMs: s.lastPingAt.getTime(),
        })),
        ...noContentActionable.map((c) => ({
          screenId: c.row.id,
          tenantId: c.row.tenantId as string,
          screenName: c.row.name,
          kind: 'NO_CONTENT' as const,
          startedAtMs: problemStartOf(c),
          contentUnavailable: c.verdict.blank && c.verdict.signal === 'content-unavailable',
        })),
      ];
      const clusters = candidates.map((c) => ({ c, cl: platformClusterAround(c.startedAtMs, events, fleet) }));
      const inIncident = clusters.filter((x) => x.cl.incident);
      if (inIncident.length > 0) {
        result.platformIncident = true;
        this.platformQuietUntil = now + ALERT_RULES.PLATFORM_QUIET_MS;
        // The incident's own problems are never emailed (and so never get a
        // recovery note); everything else waits out the quiet window.
        for (const { c } of inIncident) {
          await this.upsertIncident(c, { state: 'SILENT', reason: 'platform-incident', emailed: false, mode });
          result.silenced++;
        }
        await this.alertPlatformIncident(inIncident.map((x) => x.c), events, fleet, tenants, now);
        this.offlineDue.reset();
        this.noContentDue.reset();
        result.gate = 'platform-incident';
        return result;
      }
      newProblems.push(...candidates);
    }

    // ── Intended downtime / maintenance / content facts → defer ──
    const facts = newProblems.length ? await this.loadFacts(newProblems, tenants, now) : new Map<string, LoadedFacts>();
    const contentState = await this.contentAssignment(
      newProblems.filter((p) => p.kind === 'NO_CONTENT').map((p) => facts.get(p.screenId)?.row).filter(Boolean) as FactRow[],
      now,
    );
    const priorById = new Map(incidents.map((i) => [`${i.screenId}:${i.kind}`, i]));
    const extraPrior = newProblems.length ? await this.loadClosedIncidents(newProblems) : new Map<string, IncidentRow>();
    const toSend: NewProblem[] = [];
    for (const p of newProblems) {
      const f = facts.get(p.screenId);
      if (!f) {
        defer('screen-gone');
        continue;
      }
      const reason = intendedDowntime(f.facts, p.kind, p.startedAtMs, now);
      if (reason) {
        defer(reason);
        continue;
      }
      if (p.kind === 'NO_CONTENT') {
        if (!contentState.assigned.has(p.screenId)) {
          defer('no-content-assigned');
          continue;
        }
        if (contentState.web.has(p.screenId)) {
          defer('web-page-content');
          continue;
        }
        // Video frames presented / the hardware engine on the glass = content
        // is playing, whatever the page proof says. (For "Content unavailable"
        // the page proof is fresh by definition — it paints its own card — so
        // only the video evidence can speak for it.)
        const evidence = p.contentUnavailable ? { ...f.row, lastRenderedAt: null } : f.row;
        if (ScreenWedgeDetectorCron.hasFreshPlaybackTelemetry(evidence, now)) {
          defer('playback-proven');
          continue;
        }
      }
      const prior = priorById.get(`${p.screenId}:${p.kind}`) ?? extraPrior.get(`${p.screenId}:${p.kind}`);
      if (isFlapping(prior?.lastEmailedAt, now)) {
        await this.upsertIncident(p, { state: 'SILENT', reason: 'flap', emailed: false, mode });
        result.silenced++;
        continue;
      }
      toSend.push(p);
    }

    // ── Recoveries ──
    const recoveries = await this.collectRecoveries(incidents, offlineById, !!scan.truncated, now);
    result.recovered = recoveries.length;

    // ── Dispatch: per organisation, rate-limited, digest when over ──
    const counts = await this.dispatchScreenAlerts({ toSend, recoveries, incidents, tenants, mode, now });
    result.opened = counts.opened;
    result.held = counts.held;
    result.sends = counts.sends;

    await this.prune(now);
    if (result.opened || result.held || result.recovered || result.silenced || result.sends) {
      this.logger.log(
        `[alert-email] mode=${mode} offline=${result.offlineCandidates} noContent=${result.noContentCandidates} ` +
          `opened=${result.opened} held=${result.held} silenced=${result.silenced} recovered=${result.recovered} ` +
          `sends=${result.sends} deferred=${JSON.stringify(result.deferred)}`,
      );
    }
    return result;
  }

  // ─── No-content candidates ──────────────────────────────────────────────

  private async findNoContentCandidates(
    now: number,
    openNoContent: Map<string, IncidentRow>,
  ): Promise<Array<{ row: FactRow; verdict: ReturnType<typeof noContentVerdict> & { blank: true } }>> {
    let rows: FactRow[] = [];
    try {
      rows = (await this.prisma.client.screen.findMany({
        where: {
          tenantId: { not: null },
          status: { not: 'REVOKED' },
          tenant: { is: { archivedAt: null } },
          // Pinging — bounded on both sides (a future-dated demo ping is not a heartbeat).
          lastPingAt: { gte: new Date(now - ALERT_RULES.PING_FRESH_MS), lte: new Date(now + MIN) },
          // A player that posts render proof at all (an older bundle never sets
          // this), and has posted one within 48 h (a build that stopped posting
          // is chronic history, never "blank").
          lastRenderedAt: { not: null, gte: new Date(now - 48 * 60 * MIN) },
          OR: [
            { lastRenderedAt: { lt: new Date(now - 5 * MIN) } },
            { lastRenderedHash: { startsWith: 'idle:content-unavailable' } },
          ],
        },
        select: FACT_SELECT,
        take: 2_000,
      })) as FactRow[];
    } catch (e) {
      this.logger.warn(`[alert-email] no-content read failed: ${(e as Error).message}`);
      return [];
    }
    const out: Array<{ row: FactRow; verdict: any }> = [];
    for (const row of rows) {
      if (openNoContent.has(row.id)) continue;
      const grade = gradeScreenRow(row, now, ALERT_RULES.PING_FRESH_MS);
      const verdict = noContentVerdict(grade, row.lastRenderedAt);
      if (verdict.blank) out.push({ row, verdict });
    }
    return out;
  }

  // ─── Facts for the defer rules ──────────────────────────────────────────

  private async loadFacts(problems: NewProblem[], tenants: Map<string, TenantMeta>, now: number): Promise<Map<string, LoadedFacts>> {
    const ids = [...new Set(problems.map((p) => p.screenId))];
    const tenantIds = [...new Set(problems.map((p) => p.tenantId))];
    const [rows, schedules, audits, ledger] = await Promise.all([
      this.prisma.client.screen.findMany({ where: { id: { in: ids } }, select: FACT_SELECT }) as Promise<FactRow[]>,
      this.prisma.client.displaySchedule
        .findMany({
          where: { tenantId: { in: tenantIds }, isActive: true },
          select: { id: true, screenId: true, screenGroupId: true, daysOfWeek: true, onTime: true, offTime: true, timezone: true, isActive: true },
          take: 5_000,
        })
        .catch(() => null),
      this.prisma.client.auditLog
        .findMany({
          where: {
            tenantId: { in: tenantIds },
            action: { in: [DISPLAY_AUDIT_ACTIONS.CONTROL, DISPLAY_AUDIT_ACTIONS.REBOOT] },
            targetId: { in: ids },
            createdAt: { gte: new Date(now - 14 * 24 * 60 * MIN) },
          },
          select: { targetId: true, action: true, details: true, createdAt: true },
          orderBy: { createdAt: 'desc' },
          take: 2_000,
        })
        .catch(() => null),
      this.prisma.client.screenEvent
        .findMany({
          where: {
            screenId: { in: ids },
            kind: { in: MAINTENANCE_LEDGER_KINDS },
            createdAt: { gte: new Date(now - ALERT_RULES.MAINTENANCE_GRACE_MS) },
          },
          select: { screenId: true, createdAt: true },
          take: 2_000,
        })
        .catch(() => null),
    ]);
    const out = new Map<string, LoadedFacts>();
    for (const row of rows) {
      // A read that failed must defer, never send: an unknown schedule might
      // have been an "off" one, an unknown audit trail a power-off.
      if (schedules === null || audits === null || ledger === null) continue;
      const mine = audits.filter((a) => a.targetId === row.id);
      const power = lastPowerCommandOf(mine.filter((a) => a.action === DISPLAY_AUDIT_ACTIONS.CONTROL));
      const rebootAt = mine.find((a) => a.action === DISPLAY_AUDIT_ACTIONS.REBOOT)?.createdAt ?? null;
      const ledgerAt = ledger
        .filter((l) => l.screenId === row.id)
        .reduce<Date | null>((m, l) => (!m || l.createdAt > m ? l.createdAt : m), null);
      const lastMaintenanceAt = [rebootAt, ledgerAt].reduce<Date | null>((m, d) => (d && (!m || d > m) ? d : m), null);
      const tenant = row.tenantId ? tenants.get(row.tenantId) : undefined;
      const facts: ScreenFacts = {
        id: row.id,
        status: row.status,
        tenantId: row.tenantId,
        pairedAt: row.pairedAt,
        lastPingAt: row.lastPingAt,
        nativeRuntimeReport: row.nativeRuntimeReport,
        nativeRuntimeReportAt: row.nativeRuntimeReportAt,
        credentialEpochRotatedAt: row.credentialEpochRotatedAt,
        lastOtaAt: row.lastOtaAt,
        lastOtaState: row.lastOtaState,
        forceApkUpdatePendingAt: row.forceApkUpdatePendingAt,
        forceApkUpdateHold: row.forceApkUpdateHold,
        displayWindows: windowsForScreen(
          { id: row.faceOfScreenId ?? row.id, screenGroupId: row.screenGroupId },
          schedules.filter((s) => !s.screenId || s.screenId === row.id || s.screenId === row.faceOfScreenId) as DisplayScheduleRowLike[],
        ),
        otaWindow: tenant ? otaWindowOf(tenant) : null,
        lastPowerCommand: power,
        lastMaintenanceAt,
      };
      out.set(row.id, { row, facts });
    }
    return out;
  }

  /** Which candidates have content assigned right now, and which of those show a web page (no render proof by design). */
  private async contentAssignment(rows: FactRow[], now: number): Promise<{ assigned: Set<string>; web: Set<string> }> {
    const assigned = new Set<string>();
    const web = new Set<string>();
    if (rows.length === 0) return { assigned, web };
    const tenantIds = [...new Set(rows.map((r) => r.tenantId).filter((t): t is string => !!t))];
    const screenIds = [...new Set(rows.flatMap((r) => [r.id, r.faceOfScreenId]).filter((x): x is string => !!x))];
    const groupIds = [...new Set(rows.map((r) => r.screenGroupId).filter((x): x is string => !!x))];
    const at = new Date(now);
    const base = {
      tenantId: { in: tenantIds },
      isActive: true,
      startTime: { lte: at },
    };
    const target = {
      OR: [{ screenId: { in: screenIds } }, ...(groupIds.length ? [{ screenGroupId: { in: groupIds } }] : [])],
    };
    const matches = (r: { tenantId: string; screenId: string | null; screenGroupId: string | null }, c: FactRow) =>
      r.tenantId === c.tenantId &&
      ((!!r.screenId && (r.screenId === c.id || r.screenId === c.faceOfScreenId)) ||
        (!!r.screenGroupId && r.screenGroupId === c.screenGroupId));
    try {
      const [all, urls] = await Promise.all([
        this.prisma.client.schedule.findMany({
          where: { ...base, AND: [{ OR: [{ endTime: null }, { endTime: { gte: at } }] }, target] },
          select: { tenantId: true, screenId: true, screenGroupId: true },
          take: 2_000,
        }),
        this.prisma.client.schedule.findMany({
          where: {
            ...base,
            AND: [
              { OR: [{ endTime: null }, { endTime: { gte: at } }] },
              target,
              {
                playlist: {
                  OR: [
                    { items: { some: { asset: { mimeType: ScreenWedgeDetectorCron.URL_MIME_TYPE } } } },
                    { template: { zones: { some: { widgetType: { in: [...ScreenWedgeDetectorCron.URL_WIDGET_TYPES] } } } } },
                  ],
                },
              },
            ],
          },
          select: { tenantId: true, screenId: true, screenGroupId: true },
          take: 2_000,
        }),
      ]);
      for (const c of rows) {
        if (all.some((r: any) => matches(r, c))) assigned.add(c.id);
        if (urls.some((r: any) => matches(r, c))) web.add(c.id);
      }
    } catch (e) {
      // Unknown → nobody counts as "content assigned" → nobody is emailed.
      this.logger.warn(`[alert-email] content check failed, deferring no-content emails: ${(e as Error).message}`);
    }
    return { assigned, web };
  }

  // ─── Recoveries ─────────────────────────────────────────────────────────

  private async collectRecoveries(
    incidents: IncidentRow[],
    offlineById: Map<string, OfflineSnapshotScreen>,
    truncated: boolean,
    now: number,
  ): Promise<Array<{ incident: IncidentRow; recoveredAtMs: number }>> {
    const openRows = incidents.filter((i) => i.open);
    const offlineOpen = openRows.filter((i) => i.kind === 'OFFLINE');
    const out: Array<{ incident: IncidentRow; recoveredAtMs: number }> = [];

    // OFFLINE still in the offline read: still down — any recovery clock stops.
    const stillDown = offlineOpen.filter((i) => offlineById.has(i.screenId));
    for (const i of stillDown) if (i.recoveringSince) await this.setRecovering(i, null);
    // Not in the read: look at the screen itself (unknowable when the read was truncated).
    const maybeUp = truncated ? [] : offlineOpen.filter((i) => !offlineById.has(i.screenId));
    const noContentOpen = openRows.filter((i) => i.kind === 'NO_CONTENT');
    const ids = [...new Set([...maybeUp, ...noContentOpen].map((i) => i.screenId))];
    if (ids.length === 0) return out;
    let rows: FactRow[];
    try {
      rows = (await this.prisma.client.screen.findMany({ where: { id: { in: ids } }, select: FACT_SELECT })) as FactRow[];
    } catch (e) {
      this.logger.warn(`[alert-email] recovery read failed: ${(e as Error).message}`);
      return out;
    }
    const byId = new Map(rows.map((r) => [r.id, r]));
    const pingFresh = (r: FactRow) =>
      !!r.lastPingAt && now - r.lastPingAt.getTime() <= ALERT_RULES.PING_FRESH_MS && r.lastPingAt.getTime() <= now + MIN;

    for (const i of [...maybeUp, ...noContentOpen]) {
      const r = byId.get(i.screenId);
      // Deleted, unpaired, revoked or moved: nothing to say, close quietly.
      if (!r || r.tenantId !== i.tenantId || r.status === 'REVOKED') {
        await this.closeIncident(i, 'CLOSED');
        continue;
      }
      let healthy: boolean;
      if (i.kind === 'OFFLINE') {
        healthy = pingFresh(r);
      } else {
        if (!pingFresh(r)) {
          if (i.recoveringSince) await this.setRecovering(i, null);
          continue;
        }
        const grade = gradeScreenRow(r, now, ALERT_RULES.PING_FRESH_MS);
        if (grade === 'idle' || grade === 'paused') {
          // The content was taken off (or paused on the glass) — "showing
          // content again" would be false. Close without a note.
          await this.closeIncident(i, 'CLOSED');
          continue;
        }
        healthy = grade === 'painting' || grade === 'media-stalled';
      }
      if (!healthy) {
        if (i.recoveringSince) await this.setRecovering(i, null);
        continue;
      }
      if (!i.recoveringSince) {
        await this.setRecovering(i, new Date(now));
        continue;
      }
      if (now - i.recoveringSince.getTime() >= ALERT_RULES.RECOVERY_HOLD_MS) {
        out.push({ incident: i, recoveredAtMs: i.recoveringSince.getTime() });
      }
    }
    return out;
  }

  // ─── Dispatch ───────────────────────────────────────────────────────────

  private async dispatchScreenAlerts(args: {
    toSend: NewProblem[];
    recoveries: Array<{ incident: IncidentRow; recoveredAtMs: number }>;
    incidents: IncidentRow[];
    tenants: Map<string, TenantMeta>;
    mode: AlertMode;
    now: number;
  }): Promise<{ opened: number; held: number; sends: number }> {
    const { toSend, recoveries, incidents, tenants, mode, now } = args;
    let opened = 0;
    let held = 0;
    let sends = 0;

    // Recoveries of problems that were never emailed close quietly.
    const recoveryItems: Array<{ incident: IncidentRow; recoveredAtMs: number; sendMode: AlertMode }> = [];
    for (const r of recoveries) {
      if (r.incident.state !== 'EMAILED') {
        await this.closeIncident(r.incident, 'CLOSED');
        continue;
      }
      // A customer hears "back online" only when the problem email reached them.
      recoveryItems.push({ ...r, sendMode: r.incident.emailedMode === 'on' && mode === 'on' ? 'on' : 'shadow' });
    }

    const heldRows = incidents.filter((i) => (i.open && i.state === 'HELD') || (!i.open && i.state === 'RECOVERY_HELD'));
    const recoveredIds = new Set(recoveries.map((r) => r.incident.id));
    const orgs = new Set<string>([
      ...toSend.map((p) => this.rootOf(p.tenantId, tenants)),
      ...recoveryItems.map((r) => this.rootOf(r.incident.tenantId, tenants)),
      ...heldRows.map((h) => this.rootOf(h.tenantId, tenants)),
    ]);
    const limit = orgHourlyLimit();

    for (const orgId of orgs) {
      let capacity = Math.max(0, limit - (await this.sentLastHour(orgId, now)));
      const orgProblems = toSend.filter((p) => this.rootOf(p.tenantId, tenants) === orgId);
      const orgRecoveries = recoveryItems.filter((r) => this.rootOf(r.incident.tenantId, tenants) === orgId);
      const orgHeld = heldRows.filter((h) => this.rootOf(h.tenantId, tenants) === orgId && !recoveredIds.has(h.id));

      // DIGEST: the org has held items and room for one email → everything
      // pending for it (held + this tick's) goes out as ONE email.
      if (orgHeld.length > 0) {
        if (capacity <= 0) {
          for (const p of orgProblems) {
            await this.upsertIncident(p, { state: 'HELD', emailed: false, mode });
            held++;
            opened++;
          }
          for (const r of orgRecoveries) {
            await this.closeIncident(r.incident, 'RECOVERY_HELD');
            held++;
          }
          continue;
        }
        const ok = await this.sendDigest({ orgId, tenants, mode, now, held: orgHeld, problems: orgProblems, recoveries: orgRecoveries });
        if (ok) {
          sends++;
          opened += orgProblems.length;
        }
        continue;
      }

      // Regular emails: one per (location, kind, mode).
      type Group = { tenantId: string; kind: ScreenItemKind; sendMode: AlertMode; problems: NewProblem[]; recs: typeof orgRecoveries };
      const groups = new Map<string, Group>();
      const groupOf = (tenantId: string, kind: ScreenItemKind, sendMode: AlertMode) => {
        const k = `${tenantId}|${kind}|${sendMode}`;
        let g = groups.get(k);
        if (!g) groups.set(k, (g = { tenantId, kind, sendMode, problems: [], recs: [] }));
        return g;
      };
      for (const p of orgProblems) groupOf(p.tenantId, p.kind, mode).problems.push(p);
      for (const r of orgRecoveries) {
        groupOf(r.incident.tenantId, r.incident.kind === 'OFFLINE' ? 'BACK_ONLINE' : 'CONTENT_RESTORED', r.sendMode).recs.push(r);
      }

      for (const g of groups.values()) {
        if (capacity <= 0) {
          for (const p of g.problems) {
            await this.upsertIncident(p, { state: 'HELD', emailed: false, mode });
            held++;
            opened++;
          }
          for (const r of g.recs) {
            await this.closeIncident(r.incident, 'RECOVERY_HELD');
            held++;
          }
          continue;
        }
        const location = tenants.get(g.tenantId);
        const items: ScreenAlertItem[] = [
          ...g.problems.map((p) => ({
            kind: p.kind as ScreenItemKind,
            screenName: p.screenName,
            locationName: location?.name ?? '—',
            minutes: Math.max(1, Math.round((now - p.startedAtMs) / MIN)),
            contentUnavailable: p.contentUnavailable,
          })),
          ...g.recs.map((r) => ({
            kind: g.kind,
            screenName: r.incident.screenName,
            locationName: location?.name ?? '—',
            minutes:
              g.kind === 'BACK_ONLINE' ? Math.max(1, Math.round((r.recoveredAtMs - r.incident.startedAt.getTime()) / MIN)) : undefined,
          })),
        ];
        const siteWide = g.kind === 'OFFLINE' && this.infraAt.has(g.tenantId);
        const sent = await this.deliver({
          orgId,
          tenants,
          tenantIds: [g.tenantId],
          kind: g.kind,
          mode: g.sendMode,
          itemCount: items.length,
          render: (locale, _covered, r) =>
            renderScreenAlertEmail(
              locale,
              { kind: g.kind, locationName: location?.name ?? '—', items, siteWide },
              { screensUrl: this.url(`/${location?.slug ?? r.homeSlug}/screens`), manageUrl: this.manageUrl(r) },
            ),
        });
        // A send that could not even be attempted (recipient read failed)
        // changes no state: the same problems are due again next scan.
        if (!sent) continue;
        sends++;
        capacity--;
        for (const p of g.problems) {
          await this.upsertIncident(p, { state: 'EMAILED', emailed: true, mode: g.sendMode });
          opened++;
        }
        for (const r of g.recs) await this.closeIncident(r.incident, 'CLOSED');
      }
    }
    return { opened, held, sends };
  }

  private async sendDigest(args: {
    orgId: string;
    tenants: Map<string, TenantMeta>;
    mode: AlertMode;
    now: number;
    held: IncidentRow[];
    problems: NewProblem[];
    recoveries: Array<{ incident: IncidentRow; recoveredAtMs: number; sendMode: AlertMode }>;
  }): Promise<boolean> {
    const { orgId, tenants, mode, now } = args;
    const items: Array<ScreenAlertItem & { tenantId: string }> = [];
    const nameOf = (tid: string) => tenants.get(tid)?.name ?? '—';
    const heldRecoveries: IncidentRow[] = [];
    for (const h of args.held) {
      if (h.state === 'HELD') {
        items.push({ tenantId: h.tenantId, kind: h.kind as ScreenItemKind, screenName: h.screenName, locationName: nameOf(h.tenantId) });
      } else if (mode === 'shadow' || h.emailedMode === 'on') {
        // A customer hears "back online" only if the problem email reached them.
        heldRecoveries.push(h);
        items.push({
          tenantId: h.tenantId,
          kind: h.kind === 'OFFLINE' ? 'BACK_ONLINE' : 'CONTENT_RESTORED',
          screenName: h.screenName,
          locationName: nameOf(h.tenantId),
        });
      } else {
        await this.closeIncident(h, 'CLOSED');
      }
    }
    for (const p of args.problems) {
      items.push({ tenantId: p.tenantId, kind: p.kind, screenName: p.screenName, locationName: nameOf(p.tenantId) });
    }
    for (const r of args.recoveries) {
      items.push({
        tenantId: r.incident.tenantId,
        kind: r.incident.kind === 'OFFLINE' ? 'BACK_ONLINE' : 'CONTENT_RESTORED',
        screenName: r.incident.screenName,
        locationName: nameOf(r.incident.tenantId),
      });
    }
    const tenantIds = [...new Set(items.map((i) => i.tenantId))];
    const orgName = tenants.get(orgId)?.name ?? '—';
    const sent = await this.deliver({
      orgId,
      tenants,
      tenantIds,
      kind: 'DIGEST',
      mode,
      itemCount: items.length,
      render: (locale, covered, r) => {
        const mine = items.filter((i) => covered.includes(i.tenantId));
        if (mine.length === 0) return null;
        return renderDigestEmail(
          locale,
          { orgName, items: mine },
          { screensUrl: this.url(`/${r.homeSlug}/screens`), manageUrl: this.manageUrl(r) },
        );
      },
    });
    if (!sent) return false;
    for (const h of args.held) {
      if (h.state === 'HELD') await this.markEmailed(h, mode, now);
    }
    for (const h of heldRecoveries) await this.closeIncident(h, 'CLOSED');
    for (const p of args.problems) await this.upsertIncident(p, { state: 'EMAILED', emailed: true, mode });
    for (const r of args.recoveries) await this.closeIncident(r.incident, 'CLOSED');
    return sent;
  }

  /**
   * One SEND: resolve the organisation's admins for these locations, render
   * per recipient (their language, their locations), and either email them
   * (on) or email the owner what would have gone out (shadow). Records one
   * `customer_alert_sends` row — counts only. Never throws.
   */
  private async deliver(args: {
    orgId: string;
    tenants: Map<string, TenantMeta>;
    tenantIds: string[];
    kind: string;
    mode: AlertMode;
    itemCount: number;
    render: (locale: AlertLocale, coveredTenantIds: string[], r: Recipient) => RenderedEmail | null;
  }): Promise<boolean> {
    const { orgId, tenants, tenantIds, kind, mode, itemCount } = args;
    try {
      const recipients = await this.recipientsFor(tenantIds, tenants);
      const plan: Array<{ r: Recipient; email: RenderedEmail }> = [];
      for (const r of recipients) {
        const covered = tenantIds.filter((t) => this.chainOf(t, tenants).includes(r.tenantId));
        const email = args.render(r.locale, covered, r);
        if (email) plan.push({ r, email });
      }
      if (mode === 'on') {
        const prodUnconfigured = process.env.NODE_ENV === 'production' && this.email && !this.email.isConfigured();
        if (prodUnconfigured) {
          if (Date.now() - this.lastNotConfiguredLog > 60 * MIN) {
            this.lastNotConfiguredLog = Date.now();
            this.logger.warn('[alert-email] RESEND_API_KEY is not set — customer alert emails are not being sent');
          }
        } else {
          for (const { r, email } of plan) {
            try {
              await this.email?.sendCustomerAlert({ to: r.email, subject: email.subject, body: email.body, kind: `ALERT_${kind}` });
            } catch (e) {
              this.logger.warn(`[alert-email] send failed kind=${kind}: ${(e as Error)?.message ?? e}`);
            }
          }
        }
      } else {
        await this.sendShadow({ orgId, tenants, tenantIds, kind, plan, render: args.render });
      }
      await this.prisma.client.customerAlertSend
        .create({ data: { orgId, kind, mode, itemCount, recipientCount: plan.length } })
        .catch((e: any) => this.logger.warn(`[alert-email] send record failed: ${e?.message ?? e}`));
      this.logger.log(`[alert-email] ${mode} kind=${kind} org=${orgId} items=${itemCount} recipients=${plan.length}`);
      return true;
    } catch (e) {
      this.logger.warn(`[alert-email] deliver failed kind=${kind}: ${(e as Error)?.message ?? e}`);
      return false;
    }
  }

  private async sendShadow(args: {
    orgId: string;
    tenants: Map<string, TenantMeta>;
    tenantIds: string[];
    kind: string;
    plan: Array<{ r: Recipient; email: RenderedEmail }>;
    render: (locale: AlertLocale, covered: string[], r: Recipient) => RenderedEmail | null;
  }): Promise<void> {
    const orgName = args.tenants.get(args.orgId)?.name ?? args.orgId;
    // The owner reads the English copy an admin covering every location would get.
    const sample =
      args.render('en', args.tenantIds, {
        id: '',
        email: '',
        tenantId: args.orgId,
        locale: 'en',
        homeSlug: args.tenants.get(args.orgId)?.slug ?? '',
      }) ?? { subject: `(${args.kind})`, body: '' };
    const locales = args.plan.reduce<Record<string, number>>((m, p) => ((m[p.r.locale] = (m[p.r.locale] ?? 0) + 1), m), {});
    const subject = `[shadow] would have sent to ${args.plan.length} admins at ${orgName}: ${sample.subject}`;
    const body = [
      `CUSTOMER_ALERT_EMAILS_MODE=shadow — nothing was sent to the customer.`,
      `Recipients: ${args.plan.length} (${Object.entries(locales).map(([l, n]) => `${l} ${n}`).join(', ') || 'none'})`,
      '',
      '──── what they would have received (en) ────',
      sample.body,
    ].join('\n');
    this.logger.log(`[alert-email] ${subject}`);
    await this.platformMailer?.sendAlert(subject, body, `ALERT_SHADOW_${args.kind}`);
  }

  private async alertPlatformIncident(
    problems: NewProblem[],
    events: ProblemEvent[],
    fleet: number,
    tenants: Map<string, TenantMeta>,
    now: number,
  ): Promise<void> {
    if (now - this.lastPlatformAlertAt < 60 * MIN) return;
    this.lastPlatformAlertAt = now;
    const orgs = new Map<string, number>();
    for (const e of events) orgs.set(e.orgId, (orgs.get(e.orgId) ?? 0) + 1);
    const subject = `[VenueOS] Possible platform incident — ${events.length} screens in ${orgs.size} organisations; customer alert emails held`;
    const body = [
      `${problems.length} screen problem(s) became due for a customer email, and they started within ` +
        `${ALERT_RULES.PLATFORM_CLUSTER_MS / MIN} minutes of problems at ${orgs.size} organisation(s) ` +
        `(recently-active fleet: ${fleet}). That looks like OUR incident, not theirs.`,
      '',
      `Customer alert emails are paused for ${ALERT_RULES.PLATFORM_QUIET_MS / MIN} minutes; the screens in this cluster will never be emailed about it.`,
      '',
      'By organisation:',
      ...[...orgs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([id, n]) => `  • ${tenants.get(id)?.name ?? id}: ${n}`),
      '',
      '— VenueOS customer alert emails',
    ].join('\n');
    this.logger.warn(`[alert-email] ${subject}`);
    await this.platformMailer?.sendAlert(subject, body, 'ALERT_PLATFORM_INCIDENT');
    await this.prisma.client.customerAlertSend
      .create({ data: { orgId: '__platform__', kind: 'PLATFORM_INCIDENT', mode: 'on', itemCount: problems.length, recipientCount: 0 } })
      .catch(() => undefined);
  }

  // ─── Recipients ─────────────────────────────────────────────────────────

  /**
   * The admins of these locations: DISTRICT_ADMIN / SCHOOL_ADMIN whose home is
   * the location itself or any organisation above it, active, not deleted,
   * with a proven, real mailbox (no first-login placeholder, no unverified
   * self-signup, no anonymised `.invalid` address), and alert emails ON.
   */
  async recipientsFor(tenantIds: string[], tenants: Map<string, TenantMeta>): Promise<Recipient[]> {
    const homes = new Set<string>();
    for (const t of tenantIds) for (const id of this.chainOf(t, tenants)) homes.add(id);
    if (homes.size === 0) return [];
    const users = (await this.prisma.client.user.findMany({
      where: {
        tenantId: { in: [...homes] },
        role: { in: ADMIN_ROLES },
        status: 'ACTIVE',
        deletedAt: null,
        alertEmailsEnabled: true,
        mustSetupCredentials: false,
        emailVerificationPending: false,
      },
      select: { id: true, email: true, tenantId: true, alertEmailLocale: true },
      take: 500,
    })) as Array<{ id: string; email: string; tenantId: string; alertEmailLocale: string | null }>;
    const orgLocale = await this.orgLocales([...new Set(tenantIds.map((t) => this.rootOf(t, tenants)))]);
    return users
      .filter((u) => typeof u.email === 'string' && u.email.includes('@') && !u.email.endsWith('.invalid'))
      .map((u) => ({
        id: u.id,
        email: u.email,
        tenantId: u.tenantId,
        locale: alertLocaleOf(u.alertEmailLocale ?? orgLocale.get(this.rootOf(u.tenantId, tenants)) ?? null),
        homeSlug: tenants.get(u.tenantId)?.slug ?? '',
      }));
  }

  /** The organisation's billing-notice language (the signup page's), the fallback for a person who never chose. */
  private async orgLocales(rootIds: string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    if (rootIds.length === 0) return out;
    try {
      const rows = (await (this.prisma.client as any).license.findMany({
        where: { tenantId: { in: rootIds } },
        select: { tenantId: true, noticeLocale: true },
      })) as Array<{ tenantId: string; noticeLocale: string | null }>;
      for (const r of rows) if (r.noticeLocale) out.set(r.tenantId, r.noticeLocale);
    } catch {
      /* English it is */
    }
    return out;
  }

  // ─── Tenants ────────────────────────────────────────────────────────────

  /** These tenants and every ancestor, keyed by id. */
  async loadTenants(ids: Iterable<string>): Promise<Map<string, TenantMeta>> {
    const out = new Map<string, TenantMeta>();
    let want = [...new Set(ids)].filter(Boolean);
    for (let depth = 0; depth < 8 && want.length > 0; depth++) {
      const rows = (await this.prisma.client.tenant.findMany({
        where: { id: { in: want } },
        select: {
          id: true,
          name: true,
          slug: true,
          parentId: true,
          archivedAt: true,
          otaWindowStart: true,
          otaWindowEnd: true,
          otaWindowTimezone: true,
        },
      })) as TenantMeta[];
      for (const r of rows) out.set(r.id, r);
      want = [...new Set(rows.map((r) => r.parentId).filter((p): p is string => !!p && !out.has(p)))];
    }
    return out;
  }

  /** [tenant, parent, grandparent, …]. */
  chainOf(id: string, tenants: Map<string, TenantMeta>): string[] {
    const chain: string[] = [];
    let cur: string | null | undefined = id;
    while (cur && !chain.includes(cur) && chain.length < 10) {
      chain.push(cur);
      cur = tenants.get(cur)?.parentId;
    }
    return chain;
  }

  rootOf(id: string, tenants: Map<string, TenantMeta>): string {
    const chain = this.chainOf(id, tenants);
    return chain[chain.length - 1] ?? id;
  }

  // ─── Incident state (Postgres) ──────────────────────────────────────────

  private async loadTrackedIncidents(): Promise<IncidentRow[]> {
    return (await this.prisma.client.screenAlertIncident.findMany({
      where: { OR: [{ open: true }, { state: 'RECOVERY_HELD' }] },
      take: 5_000,
    })) as IncidentRow[];
  }

  /** Closed rows for these screens — they carry `lastEmailedAt` for flap protection. */
  private async loadClosedIncidents(problems: NewProblem[]): Promise<Map<string, IncidentRow>> {
    const rows = (await this.prisma.client.screenAlertIncident.findMany({
      where: { screenId: { in: [...new Set(problems.map((p) => p.screenId))] }, open: false },
    })) as IncidentRow[];
    return new Map(rows.map((r) => [`${r.screenId}:${r.kind}`, r]));
  }

  private async upsertIncident(
    p: NewProblem,
    o: { state: 'EMAILED' | 'HELD' | 'SILENT'; reason?: string; emailed: boolean; mode: AlertMode },
  ): Promise<void> {
    const now = new Date(this.now());
    const data = {
      tenantId: p.tenantId,
      open: true,
      state: o.state,
      reason: o.reason ?? null,
      screenName: p.screenName,
      startedAt: new Date(p.startedAtMs),
      openedAt: now,
      recoveringSince: null,
      closedAt: null,
      ...(o.emailed ? { lastEmailedAt: now, emailedMode: o.mode } : { emailedMode: null }),
    };
    await this.prisma.client.screenAlertIncident.upsert({
      where: { screenId_kind: { screenId: p.screenId, kind: p.kind } },
      create: { screenId: p.screenId, kind: p.kind, ...data },
      update: data,
    });
  }

  private async markEmailed(i: IncidentRow, mode: AlertMode, nowMs: number): Promise<void> {
    await this.prisma.client.screenAlertIncident.update({
      where: { id: i.id },
      data: { state: 'EMAILED', emailedMode: mode, lastEmailedAt: new Date(nowMs) },
    });
  }

  private async closeIncident(i: IncidentRow, state: 'CLOSED' | 'RECOVERY_HELD'): Promise<void> {
    await this.prisma.client.screenAlertIncident.update({
      where: { id: i.id },
      data: { open: false, state, closedAt: new Date(this.now()), recoveringSince: null },
    });
  }

  private async setRecovering(i: IncidentRow, at: Date | null): Promise<void> {
    await this.prisma.client.screenAlertIncident.update({ where: { id: i.id }, data: { recoveringSince: at } });
  }

  private async sentLastHour(orgId: string, now: number): Promise<number> {
    return this.prisma.client.customerAlertSend.count({
      where: {
        orgId,
        createdAt: { gte: new Date(now - 60 * MIN) },
        recipientCount: { gt: 0 },
        kind: { not: 'PLATFORM_INCIDENT' },
      },
    });
  }

  private async recentlyActiveFleet(now: number): Promise<number> {
    if (this.fleetCache && now - this.fleetCache.at < 10 * MIN) return this.fleetCache.n;
    const n = await this.prisma.client.screen
      .count({
        where: { tenantId: { not: null }, status: { not: 'REVOKED' }, lastPingAt: { gte: new Date(now - 24 * 60 * MIN) } },
      })
      .catch(() => 0);
    this.fleetCache = { at: now, n };
    return n;
  }

  private async prune(now: number): Promise<void> {
    if (now - this.lastPruneAt < 60 * MIN) return;
    this.lastPruneAt = now;
    try {
      await this.prisma.client.screenAlertIncident.deleteMany({
        where: { open: false, state: 'CLOSED', closedAt: { lt: new Date(now - 14 * 24 * 60 * MIN) } },
      });
      await this.prisma.client.customerAlertSend.deleteMany({ where: { createdAt: { lt: new Date(now - 30 * 24 * 60 * MIN) } } });
    } catch (e) {
      this.logger.warn(`[alert-email] prune failed: ${(e as Error).message}`);
    }
  }

  // ─── Links ──────────────────────────────────────────────────────────────

  private url(path: string): string {
    return `${process.env.APP_PUBLIC_URL || 'http://localhost:3000'}${path}`;
  }

  private manageUrl(r: Recipient): string {
    return this.url(`/${r.homeSlug}/account#alert-emails`);
  }
}

// ─── Screen columns every rule reads ──────────────────────────────────────

const FACT_SELECT = {
  id: true,
  name: true,
  tenantId: true,
  status: true,
  pairedAt: true,
  lastPingAt: true,
  screenGroupId: true,
  faceOfScreenId: true,
  lastRenderedAt: true,
  lastRenderedHash: true,
  authState: true,
  nativeRuntimeReport: true,
  nativeRuntimeReportAt: true,
  credentialEpochRotatedAt: true,
  lastOtaAt: true,
  lastOtaState: true,
  forceApkUpdatePendingAt: true,
  forceApkUpdateHold: true,
  lastVideoReport: true,
  lastVideoReportAt: true,
} as const;

interface FactRow {
  id: string;
  name: string;
  tenantId: string | null;
  status: string;
  pairedAt: Date | null;
  lastPingAt: Date | null;
  screenGroupId: string | null;
  faceOfScreenId: string | null;
  lastRenderedAt: Date | null;
  lastRenderedHash: string | null;
  authState: string | null;
  nativeRuntimeReport: unknown;
  nativeRuntimeReportAt: Date | null;
  credentialEpochRotatedAt: Date | null;
  lastOtaAt: Date | null;
  lastOtaState: string | null;
  forceApkUpdatePendingAt: Date | null;
  forceApkUpdateHold: string | null;
  lastVideoReport: unknown;
  lastVideoReportAt: Date | null;
}

interface LoadedFacts {
  row: FactRow;
  facts: ScreenFacts;
}
