/**
 * Which offline screens are a REAL, recent outage (2026-10-24). Pure: no
 * Prisma, no clock of its own — every rule has a test
 * (screen-attention-policy.spec.ts).
 *
 * The dashboard's red "Screens down" card listed every screen that was not
 * answering: the owner's own Home showed "Test 1 · Web App · last seen Aug 6"
 * — a phone-browser test screen silent for eleven weeks — beside a real
 * outage, and screens dark on purpose (an on/off schedule, "Turn off" from the
 * dashboard, the panel's own standby) read as down every night. Each offline
 * screen now lands in ONE of three buckets:
 *
 *   down    — not answering, and nothing says it is meant to be off. The red
 *             card, the "needs attention" count, the bell.
 *   resting — off on purpose, judged from the SAME facts the customer alert
 *             emails defer on (`customer-alert-policy.ts` `intendedDowntime`,
 *             loaded by `CustomerAlertEmailsService.loadFacts`): an on/off
 *             schedule that says off (plus the 30-minute grace after it says
 *             on), a remote power-off, the panel's standby, the update window,
 *             a reboot / update in the last 30 minutes.
 *   dormant — old news: not seen in 30+ days, never connected at all, or a
 *             test screen (a phone, tablet or Mac browser that never ran the
 *             player app) silent for a day. A collapsed line, never red.
 *
 * The one deliberate difference from the email policy: that policy asks
 * "was it meant to be off when THIS problem started?" (it judges new
 * problems), so it samples the problem's start. The dashboard asks "is it
 * meant to be off NOW?", so it samples now and the grace behind now only — a
 * screen that went dark on a nightly schedule and stayed dark after the
 * schedule turned it back on is down by mid-morning, not resting forever.
 */
import { nativeReportsAsleep } from '../../screens/native-runtime';
import { desiredOnAt, type OnWindow } from '../customer-alerts/schedule-windows';
import { ALERT_RULES, INSTALLING_OTA_STATES, type ScreenFacts } from '../customer-alerts/customer-alert-policy';

const MIN = 60_000;
const DAY = 24 * 60 * MIN;

export const ATTENTION_RULES = {
  /** Silent longer than this = "not seen in 30+ days" (dormant, never red). */
  DORMANT_MS: 30 * DAY,
  /** A phone / tablet / Mac browser test screen silent this long is dormant. */
  TEST_SCREEN_DORMANT_MS: DAY,
  /** After an on/off schedule turns a screen back on, how long it may take to answer. */
  SCHEDULE_GRACE_MS: ALERT_RULES.SCHEDULE_GRACE_MS,
  /** A reboot / update in the last … counts as "restarting", not down. */
  MAINTENANCE_GRACE_MS: ALERT_RULES.MAINTENANCE_GRACE_MS,
} as const;

export type RestingReason =
  | 'remote-power-off'
  | 'standby'
  | 'display-schedule-off'
  | 'update-window'
  | 'maintenance';

export type DormantReason = 'not-seen-30-days' | 'never-connected' | 'test-screen';

export type AttentionVerdict =
  | { bucket: 'down' }
  | { bucket: 'resting'; reason: RestingReason }
  | { bucket: 'dormant'; reason: DormantReason };

/** What the dormant rule reads (columns of `Screen`). */
export interface DormantFacts {
  lastPingAt: Date | null;
  hardwareModel?: string | null;
  osInfo?: string | null;
  /** Set by the Android player app; never set by a browser. */
  playerVersion?: string | null;
}

/**
 * A browser on a phone, a tablet or a Mac that never ran the player app — the
 * "try it on your phone" pairing. Deliberately NOT Windows, Linux or Android:
 * a PC or a TV box running a browser kiosk is a real installation.
 */
export function isBrowserTestScreen(s: DormantFacts): boolean {
  if (s.playerVersion) return false;
  const hw = String(s.hardwareModel ?? '').trim().toLowerCase();
  if (hw && hw !== 'web') return false;
  const os = String(s.osInfo ?? '').trim().toLowerCase();
  return os === 'ios' || os === 'ipados' || os === 'macos' || os === 'mac os' || os === 'mac os x';
}

/** Old news, or null. Needs nothing but the screen row. */
export function dormantReason(s: DormantFacts, nowMs: number): DormantReason | null {
  if (!s.lastPingAt) return 'never-connected';
  const silentMs = nowMs - s.lastPingAt.getTime();
  if (silentMs > ATTENTION_RULES.DORMANT_MS) return 'not-seen-30-days';
  if (isBrowserTestScreen(s) && silentMs > ATTENTION_RULES.TEST_SCREEN_DORMANT_MS) return 'test-screen';
  return null;
}

/** The instants "is it meant to be off?" is asked at: now, and the grace behind now. */
function samplesNow(nowMs: number): number[] {
  const g = ATTENTION_RULES.SCHEDULE_GRACE_MS;
  return [nowMs, nowMs - g / 2, nowMs - g];
}

/**
 * Why this offline screen is (probably) off on purpose right now — or null.
 * Same facts and the same reasons as the alert emails' `intendedDowntime`,
 * minus its email-only preconditions (unused, just installed) and sampled
 * against now (see the file header).
 */
export function restingReason(f: ScreenFacts, nowMs: number): RestingReason | null {
  if (f.lastPowerCommand?.state === 'off') return 'remote-power-off';

  // What the Android side said in its LAST report before the screen went quiet.
  if (f.nativeRuntimeReportAt) {
    const at = f.nativeRuntimeReportAt.getTime();
    const nearSilence = !f.lastPingAt || at >= f.lastPingAt.getTime() - 5 * MIN;
    if (nearSilence && nativeReportsAsleep(f.nativeRuntimeReport, f.nativeRuntimeReportAt, at)) return 'standby';
  }

  const samples = samplesNow(nowMs);
  if (f.displayWindows.length > 0 && samples.some((t) => desiredOnAt(f.displayWindows, t) === false)) {
    return 'display-schedule-off';
  }
  if (f.otaWindow && samples.some((t) => desiredOnAt([f.otaWindow as OnWindow], t) === true)) {
    return 'update-window';
  }

  const recent = (d: Date | null) =>
    !!d && nowMs - d.getTime() >= -MIN && nowMs - d.getTime() < ATTENTION_RULES.MAINTENANCE_GRACE_MS;
  if (recent(f.lastMaintenanceAt)) return 'maintenance';
  if (recent(f.forceApkUpdatePendingAt) && !f.forceApkUpdateHold) return 'maintenance';
  if (recent(f.lastOtaAt) && INSTALLING_OTA_STATES.has(String(f.lastOtaState ?? '').toLowerCase())) return 'maintenance';
  return null;
}

/**
 * The verdict for ONE screen that is not answering. `facts` is null when the
 * alert facts could not be read — that screen is DOWN (an outage must never be
 * hidden by a failed read; the email policy fails the other way, to silence,
 * because a wrong email is the expensive mistake there).
 */
export function classifyOfflineScreen(
  screen: DormantFacts,
  facts: ScreenFacts | null,
  nowMs: number,
): AttentionVerdict {
  const dormant = dormantReason(screen, nowMs);
  if (dormant) return { bucket: 'dormant', reason: dormant };
  const resting = facts ? restingReason(facts, nowMs) : null;
  if (resting) return { bucket: 'resting', reason: resting };
  return { bucket: 'down' };
}
