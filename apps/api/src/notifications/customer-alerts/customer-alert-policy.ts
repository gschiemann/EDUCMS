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
import { nativeReportsAsleep, storedNativeRuntime } from '../../screens/native-runtime';
import { desiredOnAt, lastOnTransitionAtOrBefore, type OnWindow } from './schedule-windows';
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
  /** A remote power-off excuses a screen for at most this long (the audit read's own window). */
  POWER_OFF_MAX_MS: 14 * 24 * 60 * MIN,
  /** The page's proof must come this long after a power-off to say the screen never went dark. */
  POWER_RENDER_GRACE_MS: 3 * MIN,
  /** A native report this long after a power-off has had time to say what the panel did. */
  POWER_NATIVE_APPLY_MS: 2 * MIN,
  /** Tolerance between the panel's own clock and ours when tying its blank record to our command. */
  POWER_CLOCK_SLACK_MS: 10 * MIN,
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
  /**
   * Latest remote power command for this screen that went out (POWER_OFF /
   * BLANK = 'off'; POWER_ON / WAKE = 'on') — and an 'off' only while it still
   * holds on the glass (`effectivePowerCommand`, 2026-10-25).
   */
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
 * The shape of a problem whose clock does not start at the last check-in
 * (2026-10-25). `missed-on-time`: the screen went dark while its on/off
 * schedule had it off and did not check in when the schedule switched it on
 * again (`missedOnTime`) — `problemStartMs` is that switch-on moment.
 */
export type ProblemShape = 'missed-on-time';

/**
 * Why this screen's problem is (probably) INTENDED and must not be emailed
 * now — or null. Never decides "send"; only "not now".
 *
 * A `missed-on-time` problem is judged from the switch-on moment: "unused
 * > 24 h" does not apply (being alive after the schedule's previous
 * switch-on, which `missedOnTime` requires, is its freshness test — a weekend
 * off is ~60 h), Android's standby from before the switch-on does not excuse
 * it (the schedule's switch-on overrides a remote or standby sleep — owner
 * rule 2026-10-03), and only instants since the switch-on are asked whether
 * the screen was meant to be off.
 */
export function intendedDowntime(
  f: ScreenFacts,
  kind: ProblemKind,
  problemStartMs: number,
  nowMs: number,
  shape?: ProblemShape,
): DeferReason | null {
  const missedOn = shape === 'missed-on-time' && kind === 'OFFLINE';
  if (!f.tenantId || f.status === 'REVOKED' || f.status === 'PENDING') return 'unpaired';
  if (!f.lastPingAt) return 'not-recently-used';
  if (!missedOn && nowMs - f.lastPingAt.getTime() > ALERT_RULES.UNUSED_MS) return 'not-recently-used';
  if (f.pairedAt && problemStartMs - f.pairedAt.getTime() < ALERT_RULES.NEW_INSTALL_MS) return 'just-installed';
  if (f.lastPowerCommand?.state === 'off') return 'remote-power-off';

  // Standby / panel off. OFFLINE: what the Android side said in its LAST
  // report before the screen went quiet. NO_CONTENT: what it says now.
  if (f.nativeRuntimeReportAt && !missedOn) {
    const at = f.nativeRuntimeReportAt.getTime();
    if (kind === 'OFFLINE') {
      const nearSilence = !f.lastPingAt || at >= f.lastPingAt.getTime() - 5 * MIN;
      if (nearSilence && nativeReportsAsleep(f.nativeRuntimeReport, f.nativeRuntimeReportAt, at)) return 'standby';
    } else if (nativeReportsAsleep(f.nativeRuntimeReport, f.nativeRuntimeReportAt, nowMs)) {
      return 'standby';
    }
  }

  const samples = sampleInstants(nowMs, problemStartMs).filter((t) => !missedOn || t >= problemStartMs);
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

// ─── "Didn't come back on at its scheduled on time" (2026-10-25) ──────────

export interface MissedOnTime {
  /** When the schedule switched the screen on — the problem's start. */
  onAtMs: number;
  /** The zone of the window that opened, for "7:00 AM" in the email. */
  timeZone: string;
  /** The schedule's previous switch-on; the screen was last seen after it. */
  previousOnAtMs: number;
}

/**
 * Owner, 2026-10-25: a screen that went dark while its on/off schedule had it
 * OFF, and has not checked in since the schedule switched it back ON, is an
 * outage — from that switch-on moment, not from its last check-in. Without
 * this a screen that died at 1 AM on a Saturday was never emailed: inside the
 * OFF window it was "meant to be off", and by Monday's switch-on it was
 * silent far past the 6-hour window.
 *
 * Only for a screen last seen AFTER the schedule's previous switch-on (inside
 * the latest OFF period, or the ON period before it): a screen dark for days
 * or weeks never emails each morning. Null when the screen checked in since
 * the switch-on, when the schedule has switched it off again since, or when
 * either switch-on cannot be found. Same `desiredOnAt` evaluator and the
 * schedule's own zone as `display-schedule-off`. The 15-minute due time, the
 * 6-hour cap (from `onAtMs`), the two scans and every other rail stay with
 * the caller, unchanged.
 */
export function missedOnTime(
  windows: readonly OnWindow[],
  lastPingAtMs: number | null,
  nowMs: number,
): MissedOnTime | null {
  if (windows.length === 0 || lastPingAtMs === null) return null;
  const on = lastOnTransitionAtOrBefore(windows, nowMs);
  if (!on || on.atMs <= lastPingAtMs) return null;
  if (desiredOnAt(windows, nowMs) !== true) return null;
  const previous = lastOnTransitionAtOrBefore(windows, on.atMs - 1);
  if (!previous || lastPingAtMs < previous.atMs) return null;
  return { onAtMs: on.atMs, timeZone: on.timeZone, previousOnAtMs: previous.atMs };
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
  /**
   * 2026-10-25: the start is a schedule's switch-on moment (`missedOnTime`),
   * not an observed drop. Many organisations share "on at 7:00" in one zone.
   */
  scheduled?: boolean;
}

/**
 * Is the problem starting at `startedAtMs` part of a PLATFORM incident? Looks
 * at every current problem that started within ± PLATFORM_CLUSTER_MS of it:
 *   - ≥ PLATFORM_MIN_ORGS organisations at once, or
 *   - ≥ 2 organisations and ≥ PLATFORM_FLEET_SHARE of the recently-active fleet.
 * A single organisation's outage — however large — is THEIR incident (a site's
 * internet or power) and is never classified as ours.
 *
 * And it needs at least one screen that actually DROPPED in the window
 * (2026-10-25): screens that merely did not come on at the same scheduled
 * minute share a clock setting, not a cause, so they cannot make an incident
 * on their own — three districts each with one dead screen at 7:00 would
 * otherwise read as ours and silence all three. Our own outage at that
 * minute drops the always-on screens too, and they still make it one.
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
    near.some((e) => !e.scheduled) &&
    (orgs >= ALERT_RULES.PLATFORM_MIN_ORGS || (orgs >= 2 && share >= ALERT_RULES.PLATFORM_FLEET_SHARE));
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

/** A remote power command as the audit trail recorded it. `verb` is the operator's own (BLANK is the page's black overlay). */
export type PowerCommand = { state: 'off' | 'on'; at: Date; verb?: 'POWER_OFF' | 'BLANK' | 'POWER_ON' | 'WAKE' };

/**
 * The newest power-relevant command among a screen's `SCREEN_DISPLAY_CONTROL`
 * audit rows (`details.requested`) that actually WENT OUT. POWER_OFF / BLANK →
 * off; POWER_ON / WAKE → on. Rows are newest-first.
 *
 * 2026-10-25 (owner): a command that never reached the screen changes nothing
 * on it, so it is skipped and the one before it still stands — `outcome`
 * `refused` (the server said no) and `undelivered` (no live channel, or the
 * publish failed: there is no backstop for an immediate action), and a
 * `dispatched` row whose `actionId` a later `undelivered` correction row
 * voids. A row with no `outcome` predates it and counts as sent.
 */
export function lastPowerCommandOf(
  rows: ReadonlyArray<{ details: string | null; createdAt: Date }>,
): PowerCommand | null {
  const parsed = rows.map((r) => {
    try {
      const d = r.details ? (JSON.parse(r.details) as { requested?: unknown; outcome?: unknown; actionId?: unknown }) : null;
      return d && typeof d === 'object' ? { d, at: r.createdAt } : null;
    } catch {
      return null;
    }
  });
  const voided = new Set(
    parsed.filter((p) => p?.d.outcome === 'undelivered' && typeof p.d.actionId === 'string').map((p) => p!.d.actionId as string),
  );
  for (const p of parsed) {
    if (!p) continue;
    const { requested, outcome, actionId } = p.d;
    if (outcome !== undefined && outcome !== 'dispatched') continue;
    if (typeof actionId === 'string' && voided.has(actionId)) continue;
    if (requested === 'POWER_OFF' || requested === 'BLANK') return { state: 'off', at: p.at, verb: requested };
    if (requested === 'POWER_ON' || requested === 'WAKE') return { state: 'on', at: p.at, verb: requested };
  }
  return null;
}

/** What says whether a power-off still holds on the glass. */
export interface PowerEvidence {
  nowMs: number;
  displayWindows: readonly OnWindow[];
  lastRenderedAt: Date | null;
  credentialEpochRotatedAt: Date | null;
  nativeRuntimeReport: unknown;
  nativeRuntimeReportAt: Date | null;
}

/** Last-blank outcomes that mean the panel went (or is going) dark. */
const BLANK_TOOK = new Set(['off', 'dream', 'black', 'pending', 'unknown']);
/** …and the ones that mean it did not. */
const BLANK_FAILED = new Set(['failed', 'kept-on', 'on']);

/**
 * Owner, 2026-10-25: a remote power-off excuses a screen only while the screen
 * is REALLY off by that command. Returns the command when it still holds (or
 * is an "on"), null when it no longer does — so `ScreenFacts.lastPowerCommand`
 * (and every reader of `state === 'off'`: the alert emails, the post-restart
 * fleet check, the dashboard's resting bucket) agrees. It ends at the first of:
 *   - 14 days (the upper bound — also the audit read's own window);
 *   - an on/off schedule switch-on after it (the schedule overrides a remote
 *     power-off at each switch-on — owner rule 2026-10-03);
 *   - a BLANK (the page's black overlay): a page boot after it — the overlay
 *     lives for one page session and a reload fails bright;
 *   - a POWER_OFF, by the Android side's own report received since it: its
 *     last blank did not take, or it woke after that blank (any wake but an
 *     emergency's, which re-blanks after the all-clear), or it is awake with
 *     no blank recorded since the command. While its last blank still holds,
 *     or Android is asleep, nothing else can end it — the vendor backlight
 *     keeps the page painting in the dark, so page proof is not evidence then;
 *   - with no native word since it: the page's own proof long after it — a
 *     power-off that worked stops the page painting.
 * Device clocks only ever compare with each other, except tying the last blank
 * to this command, which tolerates POWER_CLOCK_SLACK_MS of skew.
 */
export function effectivePowerCommand(cmd: PowerCommand | null, e: PowerEvidence): PowerCommand | null {
  if (!cmd || cmd.state !== 'off') return cmd;
  const at = cmd.at.getTime();
  if (e.nowMs - at > ALERT_RULES.POWER_OFF_MAX_MS) return null;
  const on = lastOnTransitionAtOrBefore(e.displayWindows, e.nowMs);
  if (on && on.atMs > at) return null;

  if (cmd.verb === 'BLANK') {
    const boot = e.credentialEpochRotatedAt?.getTime();
    return boot !== undefined && boot > at + MIN ? null : cmd;
  }

  const report = e.nativeRuntimeReportAt && e.nativeRuntimeReportAt.getTime() > at + ALERT_RULES.POWER_NATIVE_APPLY_MS
    ? storedNativeRuntime(e.nativeRuntimeReport)
    : null;
  if (report) {
    const last = report.sleep?.last;
    const wake = report.wake;
    const wokeAfterLast = !!wake && (!last || wake.reqAt > last.at);
    if (last && BLANK_TOOK.has(last.o) && !wokeAfterLast) return cmd;
    if (report.interactive === false) return cmd;
    const lastIsOurs = !!last && last.at >= at - ALERT_RULES.POWER_CLOCK_SLACK_MS;
    if (lastIsOurs && BLANK_FAILED.has(last.o) && !wokeAfterLast) return null;
    if (lastIsOurs && wokeAfterLast) return wake!.src === 'emergency' ? cmd : null;
    if (!lastIsOurs && wake && wake.src !== 'emergency' && wake.reqAt >= at + ALERT_RULES.POWER_CLOCK_SLACK_MS) return null;
    if (!lastIsOurs && report.interactive === true) return null;
  }
  const rendered = e.lastRenderedAt?.getTime();
  if (!report && rendered !== undefined && rendered > at + ALERT_RULES.POWER_RENDER_GRACE_MS) return null;
  return cmd;
}
