/**
 * Customer alert emails — the POLICY (2026-10-23). Pure: no Prisma, no Redis,
 * no clock of its own. Everything the worker decides is decided here, so each
 * rule has a unit test (customer-alert-policy.spec.ts) and the PR can name it.
 *
 * Owner's binding requirement: "our alerting must not throw false positives —
 * blasting customers with issues that aren't real would ruin us." So every
 * doubt resolves to SILENCE, and every rule below is a reason not to send:
 *
 *   DEFER  — not now; look again next scan (intended downtime, maintenance,
 *            a just-restarted API, a degraded platform, a platform-wide
 *            incident window). Nothing is written; if the screen is still in
 *            trouble once the reason is gone, it is judged then.
 *   SILENT — this incident is never emailed, and so never gets a recovery
 *            note either (a flapping screen, a platform incident's victims).
 */
import { nativeReportsAsleep } from '../../screens/native-runtime';
import { desiredOnAt, type OnWindow } from './schedule-windows';
import type { RenderTrustGrade } from './render-trust-grade';

// ─── Mode ─────────────────────────────────────────────────────────────────

/**
 * `CUSTOMER_ALERT_EMAILS_MODE`: `shadow` (DEFAULT) | `on` | `off`.
 *   shadow — compute exactly what would be sent and email it ONLY to
 *            PLATFORM_ALERT_EMAILS ("[shadow] would have sent to …");
 *   on     — customers get it;
 *   off    — nothing.
 * `CUSTOMER_ALERT_EMAILS_DISABLED=1` is the hard kill switch over all of it,
 * the emergency record copy included. An unknown value reads as `shadow`: a
 * typo must never start emailing customers.
 */
export type AlertMode = 'off' | 'shadow' | 'on';

export function resolveAlertMode(env: NodeJS.ProcessEnv = process.env): AlertMode {
  const kill = String(env.CUSTOMER_ALERT_EMAILS_DISABLED ?? '').trim().toLowerCase();
  if (kill === '1' || kill === 'true' || kill === 'yes') return 'off';
  const m = String(env.CUSTOMER_ALERT_EMAILS_MODE ?? '').trim().toLowerCase();
  if (m === 'on') return 'on';
  if (m === 'off') return 'off';
  return 'shadow';
}

// ─── Thresholds ───────────────────────────────────────────────────────────

const MIN = 60_000;
export const ALERT_RULES = {
  /** Offline at least this long… */
  OFFLINE_DUE_MS: 15 * MIN,
  /** …and seen that way on this many consecutive scans. */
  CONFIRM_SCANS: 2,
  /** A screen silent longer than this when we first look is old news (the long-dead tail), never emailed. */
  OFFLINE_MAX_AGE_MS: 6 * 60 * MIN,
  /** Screens of the same location silent this long ride along in the same email (one email per site-wide drop). */
  STRAGGLER_MS: 12 * MIN,
  /** No content proof for this long (on consecutive scans) = not showing content. */
  NO_CONTENT_DUE_MS: 20 * MIN,
  /** A fresh ping, for "it is online". Same order as the fleet list's ONLINE. */
  PING_FRESH_MS: 2 * MIN,
  /** Not pinged within this long = unused / unboxed — never alerted. */
  UNUSED_MS: 24 * 60 * MIN,
  /** Paired less than this before the problem began = still being installed. */
  NEW_INSTALL_MS: 2 * 60 * MIN,
  /** Grace after a reboot / player update / remote reboot. */
  MAINTENANCE_GRACE_MS: 30 * MIN,
  /** Grace after an on/off schedule or the update window switches the screen back on. */
  SCHEDULE_GRACE_MS: 30 * MIN,
  /** A recovery must hold this long before a "back online" / "showing content again" note. */
  RECOVERY_HOLD_MS: 5 * MIN,
  /** At most one problem email per screen per kind in this window (flap protection). */
  FLAP_WINDOW_MS: 6 * 60 * MIN,
  /** No customer email this soon after the API (re)started. */
  RESTART_QUIET_MS: 15 * MIN,
  /** Problems that started within ± this of each other are "the same moment". */
  PLATFORM_CLUSTER_MS: 5 * MIN,
  /** A cluster spanning this many organisations is a platform incident… */
  PLATFORM_MIN_ORGS: 3,
  /** …or one spanning ≥ 2 organisations and this share of the recently-active fleet. */
  PLATFORM_FLEET_SHARE: 0.3,
  /** After a platform incident, every customer email waits this long. */
  PLATFORM_QUIET_MS: 30 * MIN,
  /** Problem + recovery emails per organisation per rolling hour, then one digest. */
  ORG_HOURLY_LIMIT: 6,
} as const;

export function orgHourlyLimit(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.CUSTOMER_ALERT_EMAILS_PER_HOUR);
  return Number.isInteger(n) && n >= 1 && n <= 60 ? n : ALERT_RULES.ORG_HOURLY_LIMIT;
}

// ─── Platform gate (restart / degraded) ───────────────────────────────────

export type PlatformGate = { open: true } | { open: false; reason: 'api-restart' | 'platform-degraded' | 'platform-incident' };

export function platformGate(input: {
  uptimeMs: number;
  degradedComponents: readonly string[];
  platformQuietUntilMs: number;
  nowMs: number;
}): PlatformGate {
  if (input.uptimeMs < ALERT_RULES.RESTART_QUIET_MS) return { open: false, reason: 'api-restart' };
  if (input.degradedComponents.length > 0) return { open: false, reason: 'platform-degraded' };
  if (input.nowMs < input.platformQuietUntilMs) return { open: false, reason: 'platform-incident' };
  return { open: true };
}

// ─── Intended downtime (DEFER) ────────────────────────────────────────────

export type ProblemKind = 'OFFLINE' | 'NO_CONTENT';

export interface ScreenFacts {
  id: string;
  status: string | null;
  tenantId: string | null;
  pairedAt: Date | null;
  lastPingAt: Date | null;
  nativeRuntimeReport: unknown;
  nativeRuntimeReportAt: Date | null;
  /** Moves on every proven register = every page boot. */
  credentialEpochRotatedAt: Date | null;
  lastOtaAt: Date | null;
  lastOtaState: string | null;
  forceApkUpdatePendingAt: Date | null;
  forceApkUpdateHold: string | null;
  /** The on/off windows that govern this screen (empty = none). */
  displayWindows: readonly OnWindow[];
  /** The tenant's player-update window, when configured. */
  otaWindow: OnWindow | null;
  /** Latest remote power command for this screen (POWER_OFF / BLANK = 'off'; POWER_ON / WAKE = 'on'). */
  lastPowerCommand: { state: 'off' | 'on'; at: Date } | null;
  /** Newest reboot / update / relaunch evidence (ledger rows, remote REBOOT). */
  lastMaintenanceAt: Date | null;
}

export type DeferReason =
  | 'unpaired'
  | 'not-recently-used'
  | 'just-installed'
  | 'remote-power-off'
  | 'standby'
  | 'display-schedule-off'
  | 'update-window'
  | 'maintenance';

/**
 * `Screen.lastOtaState` values (player-ota, upper-case on the wire) that mean
 * "an update is downloading / installing / just landed and the app restarts".
 */
const INSTALLING_OTA_STATES = new Set(['downloading', 'verifying', 'installing', 'installed', 'restarting']);

/** Instants at which "was it supposed to be off?" is asked. */
function sampleInstants(nowMs: number, problemStartMs: number): number[] {
  const g = ALERT_RULES.SCHEDULE_GRACE_MS;
  return [nowMs, nowMs - g / 2, nowMs - g, problemStartMs + MIN, problemStartMs + 5 * MIN].filter(
    (t) => t <= nowMs,
  );
}

/**
 * Why this screen's problem is (probably) INTENDED and must not be emailed
 * now — or null. Never decides "send"; only "not now".
 */
export function intendedDowntime(
  f: ScreenFacts,
  kind: ProblemKind,
  problemStartMs: number,
  nowMs: number,
): DeferReason | null {
  if (!f.tenantId || f.status === 'REVOKED' || f.status === 'PENDING') return 'unpaired';
  if (!f.lastPingAt || nowMs - f.lastPingAt.getTime() > ALERT_RULES.UNUSED_MS) return 'not-recently-used';
  if (f.pairedAt && problemStartMs - f.pairedAt.getTime() < ALERT_RULES.NEW_INSTALL_MS) return 'just-installed';
  if (f.lastPowerCommand?.state === 'off') return 'remote-power-off';

  // Standby / panel off. OFFLINE: what the Android side said in its LAST
  // report before the screen went quiet. NO_CONTENT: what it says now.
  if (f.nativeRuntimeReportAt) {
    const at = f.nativeRuntimeReportAt.getTime();
    if (kind === 'OFFLINE') {
      const nearSilence = !f.lastPingAt || at >= f.lastPingAt.getTime() - 5 * MIN;
      if (nearSilence && nativeReportsAsleep(f.nativeRuntimeReport, f.nativeRuntimeReportAt, at)) return 'standby';
    } else if (nativeReportsAsleep(f.nativeRuntimeReport, f.nativeRuntimeReportAt, nowMs)) {
      return 'standby';
    }
  }

  const samples = sampleInstants(nowMs, problemStartMs);
  if (f.displayWindows.length > 0 && samples.some((t) => desiredOnAt(f.displayWindows, t) === false)) {
    return 'display-schedule-off';
  }
  if (f.otaWindow && samples.some((t) => desiredOnAt([f.otaWindow as OnWindow], t) === true)) {
    return 'update-window';
  }

  const recent = (d: Date | null, ms: number = ALERT_RULES.MAINTENANCE_GRACE_MS) =>
    !!d && nowMs - d.getTime() >= -MIN && nowMs - d.getTime() < ms;
  if (recent(f.lastMaintenanceAt)) return 'maintenance';
  if (recent(f.forceApkUpdatePendingAt) && !f.forceApkUpdateHold) return 'maintenance';
  if (recent(f.lastOtaAt) && INSTALLING_OTA_STATES.has(String(f.lastOtaState ?? '').toLowerCase())) return 'maintenance';
  // A page that just booted has not posted its first proof yet.
  if (kind === 'NO_CONTENT' && recent(f.credentialEpochRotatedAt)) return 'maintenance';
  return null;
}

// ─── "Online but not showing content" ─────────────────────────────────────

export type NoContentVerdict =
  | { blank: false }
  | { blank: true; signal: 'stale-proof'; sinceMs: number }
  | { blank: true; signal: 'content-unavailable' };

/**
 * Which render-trust grades mean "not showing content". Deliberately narrow:
 *   not-painting        — pinging, the last paint proof is 5 min–48 h old
 *                         (the chip's red "No picture confirmed");
 *   content-unavailable — the player is painting its own "Content
 *                         unavailable" card: every scheduled file failed.
 * Everything else is NOT a blank for email: unknown (an older player that
 * never posts proof), stale-chronic (> 48 h — a build that stopped posting),
 * downloading / loading / connecting (in progress), idle (nothing scheduled),
 * paused (an operator paused it), repair-required (a credential, not a
 * picture), media-stalled (painting), and every alert grade.
 */
export function noContentVerdict(
  grade: RenderTrustGrade,
  lastRenderedAt: Date | null,
): NoContentVerdict {
  if (grade === 'not-painting' && lastRenderedAt) return { blank: true, signal: 'stale-proof', sinceMs: lastRenderedAt.getTime() };
  if (grade === 'content-unavailable') return { blank: true, signal: 'content-unavailable' };
  return { blank: false };
}

// ─── Platform incident ────────────────────────────────────────────────────

export interface ProblemEvent {
  screenId: string;
  orgId: string;
  startedAtMs: number;
}

/**
 * Is the problem starting at `startedAtMs` part of a PLATFORM incident? Looks
 * at every current problem that started within ± PLATFORM_CLUSTER_MS of it:
 *   - ≥ PLATFORM_MIN_ORGS organisations at once, or
 *   - ≥ 2 organisations and ≥ PLATFORM_FLEET_SHARE of the recently-active fleet.
 * A single organisation's outage — however large — is THEIR incident (a site's
 * internet or power) and is never classified as ours.
 */
export function platformClusterAround(
  startedAtMs: number,
  events: readonly ProblemEvent[],
  recentlyActiveFleet: number,
): { incident: boolean; orgs: number; screens: number } {
  const w = ALERT_RULES.PLATFORM_CLUSTER_MS;
  const near = events.filter((e) => Math.abs(e.startedAtMs - startedAtMs) <= w);
  const screens = new Set(near.map((e) => e.screenId)).size;
  const orgs = new Set(near.map((e) => e.orgId)).size;
  const share = recentlyActiveFleet > 0 ? screens / recentlyActiveFleet : 0;
  const incident =
    orgs >= ALERT_RULES.PLATFORM_MIN_ORGS || (orgs >= 2 && share >= ALERT_RULES.PLATFORM_FLEET_SHARE);
  return { incident, orgs, screens };
}

// ─── Confirmation (two consecutive scans) ─────────────────────────────────

/**
 * Consecutive-scan counter. `observe(ids)` is called once per scan with the
 * set that qualifies THIS scan; anything absent is reset — a single good scan
 * in between starts the count again.
 */
export class ConsecutiveScans {
  private readonly counts = new Map<string, number>();
  private readonly firstSeen = new Map<string, number>();

  observe(ids: Iterable<string>, nowMs: number): void {
    const seen = new Set(ids);
    for (const id of [...this.counts.keys()]) {
      if (!seen.has(id)) {
        this.counts.delete(id);
        this.firstSeen.delete(id);
      }
    }
    for (const id of seen) {
      this.counts.set(id, (this.counts.get(id) ?? 0) + 1);
      if (!this.firstSeen.has(id)) this.firstSeen.set(id, nowMs);
    }
  }

  confirmed(id: string): boolean {
    return (this.counts.get(id) ?? 0) >= ALERT_RULES.CONFIRM_SCANS;
  }

  /** When this run of consecutive scans began (ms), or null. */
  since(id: string): number | null {
    return this.firstSeen.get(id) ?? null;
  }

  reset(): void {
    this.counts.clear();
    this.firstSeen.clear();
  }
}

// ─── Flap ─────────────────────────────────────────────────────────────────

export function isFlapping(lastEmailedAt: Date | null | undefined, nowMs: number): boolean {
  return !!lastEmailedAt && nowMs - lastEmailedAt.getTime() < ALERT_RULES.FLAP_WINDOW_MS;
}

// ─── Remote power command (from the display-control audit rows) ───────────

/**
 * The newest power-relevant command among a screen's `SCREEN_DISPLAY_CONTROL`
 * audit rows (`details.requested`). POWER_OFF / BLANK → off; POWER_ON / WAKE
 * → on. Rows are newest-first.
 */
export function lastPowerCommandOf(
  rows: ReadonlyArray<{ details: string | null; createdAt: Date }>,
): { state: 'off' | 'on'; at: Date } | null {
  for (const r of rows) {
    let requested: unknown;
    try {
      requested = r.details ? (JSON.parse(r.details) as { requested?: unknown }).requested : undefined;
    } catch {
      continue;
    }
    if (requested === 'POWER_OFF' || requested === 'BLANK') return { state: 'off', at: r.createdAt };
    if (requested === 'POWER_ON' || requested === 'WAKE') return { state: 'on', at: r.createdAt };
  }
  return null;
}
