/**
 * Sleep & wake — what THIS screen can do to turn itself off and on, and what
 * its player last PROVED (2026-10-11).
 *
 * Owner: "What is left on sleeping and waking all the screens? We want it to
 * work as good as we possibly can." The dashboard used to say nothing about
 * it, so "off" meant whatever the operator guessed. This resolver answers,
 * per screen, from three sources and nothing else:
 *
 *  • the PLAYER VERSION — which native paths exist at all
 *    (native alert watch 1.1.22, after-alert restore 1.1.23, "Turn panel on"
 *    through the native heartbeat 1.1.24, sleep evidence 1.1.25 candidate);
 *  • the display-capability VERDICT (`screenBlank`) — the mechanism the
 *    player's own registry resolved for a native blank;
 *  • the NATIVE RUNTIME REPORT (`screens.native_runtime_report`, sent by the
 *    Android heartbeat, never by the page) — whether Android is interactive,
 *    the last power-on acknowledgement, and the sleep evidence block.
 *
 * ── HONESTY RULES ───────────────────────────────────────────────────────
 *  • NEVER "off" for a black overlay. Blank and the on/off schedule cover the
 *    screen with black on every model (the 2026-08-25 blank/power split) —
 *    the backlight stays on, and the copy says so.
 *  • "Asleep" only from Android's own interactive=false, with its age.
 *  • A capability is "yes" only when the code path exists on the installed
 *    player; "proven" only when the report shows it happened.
 *  • No report → "unknown", never "no".
 *
 * Pure: no React, no clock (pass `nowMs`), unit-tested.
 */

/** Player versions that introduced each path. */
export const NATIVE_ALERT_WATCH_MIN = [1, 1, 22] as const;
export const ALERT_RESTORE_MIN = [1, 1, 23] as const;
export const NATIVE_POWER_ON_MIN = [1, 1, 24] as const;

/** How old a native report may be before it says nothing about "now". */
export const NATIVE_REPORT_FRESH_MS = 10 * 60_000;

export type SleepMechanismKind =
  /** Android device-admin lock — a real sleep. */
  | 'device-admin'
  /** The "VenueOS sleep" accessibility service — the power key's own sleep. */
  | 'accessibility'
  /**
   * A lock exists (device admin / VenueOS sleep) but this Android is older
   * than 13, where the lock has latched panels into a vendor standby, so the
   * player does not use it unattended (player `RestoreBlankPolicy`).
   */
  | 'lock-held-back'
  /** A vendor command for this model (a recipe). */
  | 'vendor'
  /** Android's screen-off timeout — sleeps where the box allows. */
  | 'screen-timeout'
  /** A screensaver was SEEN replacing the timeout sleep — black only. */
  | 'screensaver'
  /** Only a black overlay — the backlight stays on. */
  | 'black-only'
  /** Not reported yet. */
  | 'unknown';

export type Support = 'yes' | 'no' | 'unknown';

export type SleepOutcome = 'off' | 'on' | 'dream' | 'black' | 'pending' | 'unknown' | 'kept-on' | 'failed';

export interface SleepWakeInput {
  playerVersion?: string | null;
  displayCapabilities?: unknown;
  nativeRuntimeReport?: unknown;
  nativeRuntimeReportAt?: string | null;
  nativePowerOnAt?: string | null;
  nowMs: number;
}

export interface SleepWakeSummary {
  /** How a native "off" works on this panel. */
  mechanism: SleepMechanismKind;
  /** Android's own power state, when a FRESH native report says so. */
  now: { asleep: boolean; sinceMs: number | null; reportAgeMs: number } | null;
  /** An alert wakes this panel even when someone turned it off. */
  alertWakesSleeping: Support;
  /** "Turn panel on" reaches a panel whose page is asleep. */
  turnOnReachesSleeping: Support;
  /** After the all-clear, a panel someone had turned off goes back off. */
  backToOffAfterAlert: Support;
  /** The last "Turn panel on": acknowledged by the player, or not (yet). */
  lastTurnOn: { requestedAtMs: number; acknowledged: boolean } | null;
  /** The last native blank the player checked. */
  lastSleep: { mechanism: string; outcome: SleepOutcome; atMs: number } | null;
  /** The last after-alert restore. */
  lastRestore: { decision: string; outcome: SleepOutcome; atMs: number } | null;
  /** True when the player reports nothing about sleep yet (older build). */
  noEvidence: boolean;
  /** Android release from the capability report's build block ("13"), or null. */
  androidRelease: string | null;
}

/** "1.1.24", "1.1.24-field.1", "1.0.55-debug" → [1,1,24]; garbage → null. */
export function parsePlayerVersion(v: string | null | undefined): [number, number, number] | null {
  if (typeof v !== 'string') return null;
  const m = v.trim().match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

export function versionAtLeast(
  v: readonly [number, number, number] | null,
  floor: readonly [number, number, number],
): boolean {
  if (!v) return false;
  for (let i = 0; i < 3; i++) {
    if (v[i] !== floor[i]) return v[i] > floor[i];
  }
  return true;
}

const OUTCOMES: readonly SleepOutcome[] = ['off', 'on', 'dream', 'black', 'pending', 'unknown', 'kept-on', 'failed'];

function asObject(v: unknown): Record<string, unknown> | null {
  if (typeof v === 'string') {
    try {
      return asObject(JSON.parse(v));
    } catch {
      return null;
    }
  }
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function finite(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function outcome(v: unknown): SleepOutcome {
  return typeof v === 'string' && (OUTCOMES as readonly string[]).includes(v) ? (v as SleepOutcome) : 'unknown';
}

/** Android 13 — the first release where the player uses a lock unattended (player `RestoreBlankPolicy`). */
export const LOCK_UNATTENDED_MIN_SDK = 33;

/**
 * Map a resolved blank mechanism (+ whether a screensaver was seen, + the
 * Android SDK when known) to what it means on the glass.
 */
export function mechanismKind(
  blank: string | null | undefined,
  screensaverSeen: boolean,
  sdkInt: number | null = null,
): SleepMechanismKind {
  const lockHeldBack = sdkInt !== null && sdkInt < LOCK_UNATTENDED_MIN_SDK;
  switch (blank) {
    case 'device-admin':
    case 'device-owner':
      return lockHeldBack ? 'lock-held-back' : 'device-admin';
    case 'accessibility-lock':
      return lockHeldBack ? 'lock-held-back' : 'accessibility';
    case 'vendor-recipe':
      return 'vendor';
    case 'screen-timeout':
      return screensaverSeen ? 'screensaver' : 'screen-timeout';
    case 'software-dim':
    case 'none':
    case 'novastar-sdk':
      return screensaverSeen ? 'screensaver' : 'black-only';
    default:
      return 'unknown';
  }
}

export function summarizeSleepWake(input: SleepWakeInput): SleepWakeSummary {
  const version = parsePlayerVersion(input.playerVersion);
  const report = asObject(input.nativeRuntimeReport);
  const sleep = asObject(report?.sleep);
  const verdict = asObject(input.displayCapabilities);
  const verdictInner = asObject(verdict?.verdict) ?? verdict;

  const reportAtMs = input.nativeRuntimeReportAt ? Date.parse(input.nativeRuntimeReportAt) : NaN;
  const reportAgeMs = Number.isFinite(reportAtMs) ? Math.max(0, input.nowMs - reportAtMs) : null;
  const fresh = reportAgeMs !== null && reportAgeMs <= NATIVE_REPORT_FRESH_MS;

  const screensaverSeen = sleep?.dream === true;
  const blank =
    (typeof sleep?.blank === 'string' ? sleep.blank : null) ??
    (typeof verdictInner?.screenBlank === 'string' ? (verdictInner.screenBlank as string) : null);

  let now: SleepWakeSummary['now'] = null;
  if (report && fresh && typeof report.interactive === 'boolean') {
    now = {
      asleep: report.interactive === false,
      sinceMs: report.interactive === false ? finite(report.standbySinceMs) : null,
      reportAgeMs: reportAgeMs!,
    };
  }

  const support = (floor: readonly [number, number, number]): Support =>
    version === null ? 'unknown' : versionAtLeast(version, floor) ? 'yes' : 'no';

  const requestedAtMs = input.nativePowerOnAt ? Date.parse(input.nativePowerOnAt) : NaN;
  const ack = typeof report?.powerOnAck === 'string' ? report.powerOnAck : null;
  const lastTurnOn = Number.isFinite(requestedAtMs)
    ? {
        requestedAtMs,
        acknowledged: ack !== null && Date.parse(ack) === requestedAtMs,
      }
    : null;

  const last = asObject(sleep?.last);
  const lastAt = finite(last?.at);
  const lastSleep =
    last && lastAt !== null && typeof last.m === 'string'
      ? { mechanism: last.m, outcome: outcome(last.o), atMs: lastAt }
      : null;

  const restore = asObject(sleep?.restore);
  const restoreAt = finite(restore?.at);
  const lastRestore =
    restore && restoreAt !== null && typeof restore.d === 'string'
      ? { decision: restore.d, outcome: outcome(restore.o), atMs: restoreAt }
      : null;

  return {
    mechanism: mechanismKind(blank, screensaverSeen, (() => {
      const sdk = asObject(verdict?.build)?.sdk;
      return typeof sdk === 'number' && Number.isInteger(sdk) ? sdk : null;
    })()),
    now,
    alertWakesSleeping: support(NATIVE_ALERT_WATCH_MIN),
    turnOnReachesSleeping: support(NATIVE_POWER_ON_MIN),
    backToOffAfterAlert: support(ALERT_RESTORE_MIN),
    lastTurnOn,
    lastSleep,
    lastRestore,
    noEvidence: !sleep,
    androidRelease: (() => {
      const r = asObject(verdict?.build)?.release;
      return typeof r === 'string' && /^[0-9][0-9.]{0,7}$/.test(r) ? r : null;
    })(),
  };
}

/** Does a mechanism kind put the panel truly to sleep (not just black)? */
export function isRealSleep(kind: SleepMechanismKind): boolean {
  return kind === 'device-admin' || kind === 'accessibility' || kind === 'vendor';
}
