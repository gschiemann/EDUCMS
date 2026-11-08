/**
 * SCHEDULED RESTART — the pure rules (2026-11-08, manager deep-dive item #7).
 *
 * An admin may opt a screen group into a nightly or weekly restart. No policy
 * row = today's behaviour: no restart is ever sent. This file decides, for one
 * screen at one moment, whether a restart may be sent; the worker
 * (scheduled-reboot.service.ts) gathers the facts and dispatches through the
 * SAME path as the dashboard's typed-confirm button, so the API's own
 * capability gate and the SCREEN_DISPLAY_REBOOT audit row still apply.
 *
 * Every refusal below has a test (scheduled-reboot-policy.spec.ts). The
 * direction is CLOSED: a fact that cannot be read refuses the restart.
 *
 * Owner rules this encodes:
 *   - never mass-force during playback; one hardware class at a time,
 *     off-hours (fleet-push-policy.ts);
 *   - the player respects a remote power-off; only the on/off schedule
 *     overrides it (so a restart never re-lights a panel someone turned off);
 *   - never fight the Goodview CMS: read the box's own state first, and do
 *     not restart a box whose own standby / wake already restarted it (a t982
 *     deep-standby wake reboots the box; so does an EP6N wake).
 *
 * Pure: no Prisma, no Nest, no wall clock.
 */
import { createHash } from 'crypto';

import { isInsideWindowStrict, isValidTimeZone } from '../player-ota/auto-update-policy';
import { OFF_HOURS } from '../player-ota/fleet-push-policy';
import { desiredOnAt, type OnWindow } from '../notifications/customer-alerts/schedule-windows';

export type RebootCadence = 'DAILY' | 'WEEKLY';

export interface RebootPolicyLike {
  id: string;
  cadence: RebootCadence | string;
  /** 0 = Sunday … 6 = Saturday; WEEKLY only. */
  dayOfWeek: number | null;
  /** "HH:MM", local in each screen's own zone. */
  time: string;
  isActive: boolean;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** A slot is dispatchable for this long after its start; a missed slot is never caught up. */
export const DISPATCH_WINDOW_MS = 60 * MINUTE;
/** Per-screen stagger inside the window: a stable offset in [0, JITTER_MAX_MS). */
export const JITTER_MAX_MS = 45 * MINUTE;
/** At most this many sends per tenant per worker tick. */
export const PER_TENANT_PER_TICK = 3;
/** A screen counts as online when it pinged within this long. */
export const ONLINE_FRESH_MS = 5 * MINUTE;
/** "OTA in flight": the device last reported one of these within this long. */
export const OTA_ACTIVE_STATES: ReadonlySet<string> = new Set(['DOWNLOADING', 'VERIFYING', 'INSTALLING']);
export const OTA_ACTIVE_MS = 30 * MINUTE;
/** A check-in this soon after the dispatch may predate the restart; it proves nothing. */
export const CHECK_IN_GRACE_MS = 30_000;
/** With no boot count to compare, a check-in this long after the dispatch counts as back (unproven). */
export const UNPROVEN_BACK_AFTER_MS = 3 * MINUTE;
/** A native runtime report older than this is too stale to read uptime from. */
export const UPTIME_REPORT_MAX_AGE_MS = 2 * HOUR;

/** 22:00–04:59: a policy time whose whole dispatch window ends by 06:00. */
export function isAllowedPolicyTime(time: unknown): boolean {
  const m = parseHHmmStrict(time);
  if (m === null) return false;
  return m >= 22 * 60 || m < 5 * 60;
}

export function parseHHmmStrict(raw: unknown): number | null {
  if (typeof raw !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(raw)) return null;
  const [h, m] = raw.split(':').map(Number);
  return h * 60 + m;
}

// ─── Local time in a zone ──────────────────────────────────────────────────

const DOW: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  dow: number;
}

function localParts(zone: string, ms: number): LocalParts {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    hourCycle: 'h23',
  }).formatToParts(new Date(ms));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour: Number(get('hour')) % 24,
    minute: Number(get('minute')),
    dow: DOW[get('weekday')] ?? 0,
  };
}

/** The instant of local wall time `minuteOfDay` on local date y-m-d in `zone`. */
function zonedInstant(zone: string, y: number, m: number, d: number, minuteOfDay: number): number {
  const wall = Date.UTC(y, m - 1, d, Math.floor(minuteOfDay / 60), minuteOfDay % 60);
  let guess = wall;
  for (let i = 0; i < 3; i++) {
    const p = localParts(zone, guess);
    const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
    const next = wall - (asUtc - guess);
    if (next === guess) break;
    guess = next;
  }
  return guess;
}

export interface RebootSlot {
  /** The local date the slot starts on, "YYYY-MM-DD" — one run row per (screen, slotKey). */
  slotKey: string;
  startMs: number;
}

/**
 * The slot whose dispatch window contains `nowMs`, or null. A slot starts at
 * the policy's local time in the screen's zone, on every day (DAILY) or on
 * `dayOfWeek` (WEEKLY), and is open for DISPATCH_WINDOW_MS.
 */
export function currentSlot(policy: RebootPolicyLike, zone: string, nowMs: number): RebootSlot | null {
  if (!policy.isActive || !isValidTimeZone(zone)) return null;
  const minute = parseHHmmStrict(policy.time);
  if (minute === null) return null;
  const weekly = policy.cadence === 'WEEKLY';
  if (!weekly && policy.cadence !== 'DAILY') return null;
  if (weekly && !(Number.isInteger(policy.dayOfWeek) && policy.dayOfWeek! >= 0 && policy.dayOfWeek! <= 6)) return null;
  const today = localParts(zone, nowMs);
  for (const offset of [0, -1]) {
    const noon = new Date(Date.UTC(today.year, today.month - 1, today.day + offset, 12));
    const y = noon.getUTCFullYear();
    const m = noon.getUTCMonth() + 1;
    const d = noon.getUTCDate();
    const startMs = zonedInstant(zone, y, m, d, minute);
    if (nowMs < startMs || nowMs >= startMs + DISPATCH_WINDOW_MS) continue;
    if (weekly && noon.getUTCDay() !== policy.dayOfWeek) continue;
    const slotKey = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    return { slotKey, startMs };
  }
  return null;
}

/** A stable per-screen stagger inside the window, from (screen, slot). */
export function jitterOffsetMs(screenId: string, slotKey: string): number {
  const h = createHash('sha256').update(`${screenId}|${slotKey}`).digest();
  return h.readUInt32BE(0) % JITTER_MAX_MS;
}

/** A box that restarted more recently than this has already had its restart for this cadence. */
export function ownRestartThresholdMs(cadence: RebootCadence | string): number {
  return cadence === 'WEEKLY' ? 7 * 24 * HOUR - HOUR : 23 * HOUR;
}

// ─── The decision ──────────────────────────────────────────────────────────

/** Recorded at once: nothing inside this slot's window will change them. */
export type RebootSkipReason =
  | 'no-time-zone'
  | 'cannot-restart'
  | 'not-off-hours'
  | 'outside-off-window'
  | 'panel-off'
  | 'sync-live'
  | 'restarted-on-its-own';

/** Retried every tick until the window closes, then recorded as the skip reason. */
export type RebootWaitReason = 'offline' | 'emergency' | 'ota-in-flight' | 'class-busy' | 'tenant-cap';

export type RebootReason = RebootSkipReason | RebootWaitReason;

export const REBOOT_WAIT_REASONS: ReadonlySet<string> = new Set<RebootWaitReason>([
  'offline',
  'emergency',
  'ota-in-flight',
  'class-busy',
  'tenant-cap',
]);

export interface RebootFacts {
  nowMs: number;
  policy: RebootPolicyLike;
  screenId: string;
  /** The screen's effective IANA zone (screens/screen-time-zone.ts), or null. */
  timeZone: string | null;
  /** The on/off windows that govern this screen (`windowsForScreen`); empty = no schedule. */
  windows: readonly OnWindow[];
  /** The screen's capability verdict says it can reboot (`reboot` !== 'none'). */
  canRestart: boolean;
  /** The panel is dark or soft-blanked right now (native `interactive === false`, or a soft BLANK). */
  panelOff: boolean;
  /** Frame-locked right now — TRUE when the sync read failed. */
  syncActive: boolean;
  /** Any emergency hold, including `unreadable`. */
  emergencyActive: boolean;
  /** A tracked push is active or the device last reported an install step recently. */
  otaInFlight: boolean;
  online: boolean;
  /** The box's uptime, or null when no fresh native report says. */
  uptimeMs: number | null;
  /** Another hardware class of this tenant has a restart still unproven. */
  classBusy: boolean;
  /** The tenant has used its nightly cap, or this tick's share. */
  tenantCapReached: boolean;
  /** Return window: the off window must still be off this long after the send. */
  returnWindowMs: number;
}

export type RebootDecision =
  | { due: false }
  | { due: true; slot: RebootSlot; verdict: 'send' }
  | { due: true; slot: RebootSlot; verdict: 'skip'; reason: RebootSkipReason }
  | { due: true; slot: RebootSlot; verdict: 'wait'; reason: RebootWaitReason };

export function decideScheduledReboot(f: RebootFacts): RebootDecision {
  const zone = typeof f.timeZone === 'string' && isValidTimeZone(f.timeZone) ? f.timeZone : null;
  if (!zone) {
    // A screen whose zone does not resolve cannot place its slot. Report it
    // once per UTC day so the dashboard can say why (never the device's own
    // zone: a GUQ ships set to Asia/Shanghai).
    const slot = currentSlot(f.policy, 'UTC', f.nowMs);
    if (!slot) return { due: false };
    return { due: true, slot, verdict: 'skip', reason: 'no-time-zone' };
  }
  const slot = currentSlot(f.policy, zone, f.nowMs);
  if (!slot) return { due: false };
  if (f.nowMs < slot.startMs + jitterOffsetMs(f.screenId, slot.slotKey)) return { due: false };

  const skip = (reason: RebootSkipReason): RebootDecision => ({ due: true, slot, verdict: 'skip', reason });
  const wait = (reason: RebootWaitReason): RebootDecision => ({ due: true, slot, verdict: 'wait', reason });

  if (!f.canRestart) return skip('cannot-restart');
  if (!isInsideWindowStrict({ ...OFF_HOURS, timezone: zone }, new Date(f.nowMs))) return skip('not-off-hours');

  const hasSchedule = f.windows.length > 0;
  if (hasSchedule) {
    const offNow = desiredOnAt(f.windows, f.nowMs) === false;
    const offAfter = desiredOnAt(f.windows, f.nowMs + f.returnWindowMs) === false;
    if (!offNow || !offAfter) return skip('outside-off-window');
  } else {
    if (f.panelOff) return skip('panel-off');
    if (f.syncActive) return skip('sync-live');
  }
  if (f.uptimeMs !== null && f.uptimeMs >= 0 && f.uptimeMs < ownRestartThresholdMs(f.policy.cadence)) {
    return skip('restarted-on-its-own');
  }
  if (!f.online) return wait('offline');
  if (f.emergencyActive) return wait('emergency');
  if (f.otaInFlight) return wait('ota-in-flight');
  if (f.classBusy) return wait('class-busy');
  if (f.tenantCapReached) return wait('tenant-cap');
  return { due: true, slot, verdict: 'send' };
}

// ─── Facts read off a Screen row ───────────────────────────────────────────

/** The capability verdict allows REBOOT — today only a device-owner build. */
export function verdictCanRestart(stored: unknown): boolean {
  if (!stored || typeof stored !== 'object') return false;
  const s = stored as Record<string, any>;
  const v = s.verdict && typeof s.verdict === 'object' ? s.verdict : s;
  return typeof v.reboot === 'string' && v.reboot !== 'none';
}

/** Uptime now, from the stored native report's `elapsedRealtimeMs`; null when absent or stale. */
export function uptimeFrom(report: unknown, reportAt: Date | string | null | undefined, nowMs: number): number | null {
  if (!report || typeof report !== 'object' || !reportAt) return null;
  const elapsed = (report as Record<string, unknown>).elapsedRealtimeMs;
  const at = new Date(reportAt).getTime();
  if (typeof elapsed !== 'number' || !Number.isFinite(elapsed) || elapsed < 0 || !Number.isFinite(at)) return null;
  const age = nowMs - at;
  if (age < 0 || age > UPTIME_REPORT_MAX_AGE_MS) return null;
  return elapsed + age;
}

/** Android BOOT_COUNT from the stored native report, or null. */
export function bootCountFrom(report: unknown): number | null {
  if (!report || typeof report !== 'object') return null;
  const proc = (report as Record<string, any>).proc;
  const boot = proc && typeof proc === 'object' ? proc.boot : undefined;
  return typeof boot === 'number' && Number.isInteger(boot) && boot >= 0 ? boot : null;
}

/** The panel is dark (native says not interactive) or soft-blanked. */
export function panelIsOff(report: unknown, softBlankAt: unknown): boolean {
  if (softBlankAt) return true;
  return !!report && typeof report === 'object' && (report as Record<string, unknown>).interactive === false;
}

export function otaIsInFlight(
  s: { lastOtaState?: string | null; lastOtaAt?: Date | string | null },
  pushActive: boolean,
  nowMs: number,
): boolean {
  if (pushActive) return true;
  if (!s.lastOtaState || !OTA_ACTIVE_STATES.has(s.lastOtaState) || !s.lastOtaAt) return false;
  const at = new Date(s.lastOtaAt).getTime();
  return Number.isFinite(at) && nowMs - at < OTA_ACTIVE_MS;
}

// ─── Proof of return ───────────────────────────────────────────────────────

export type ReturnVerdict =
  | { status: 'pending' }
  | { status: 'BACK'; proven: boolean; returnedAtMs: number; bootAfter: number | null }
  | { status: 'NO_RESTART'; returnedAtMs: number; bootAfter: number | null }
  | { status: 'NOT_BACK' };

export interface ReturnFacts {
  nowMs: number;
  dispatchedAtMs: number;
  bootBefore: number | null;
  lastPingAtMs: number | null;
  /** BOOT_COUNT from a native report written AFTER the dispatch, else null. */
  bootNow: number | null;
  returnWindowMs: number;
}

export function evaluateReturn(f: ReturnFacts): ReturnVerdict {
  const checkedIn = f.lastPingAtMs !== null && f.lastPingAtMs > f.dispatchedAtMs + CHECK_IN_GRACE_MS;
  const windowOver = f.nowMs >= f.dispatchedAtMs + f.returnWindowMs;
  if (checkedIn) {
    const at = f.lastPingAtMs as number;
    if (f.bootBefore !== null && f.bootNow !== null) {
      if (f.bootNow > f.bootBefore) return { status: 'BACK', proven: true, returnedAtMs: at, bootAfter: f.bootNow };
      return windowOver ? { status: 'NO_RESTART', returnedAtMs: at, bootAfter: f.bootNow } : { status: 'pending' };
    }
    if (f.nowMs >= f.dispatchedAtMs + UNPROVEN_BACK_AFTER_MS) {
      return { status: 'BACK', proven: false, returnedAtMs: at, bootAfter: f.bootNow };
    }
    return { status: 'pending' };
  }
  return windowOver ? { status: 'NOT_BACK' } : { status: 'pending' };
}

// ─── Configuration ─────────────────────────────────────────────────────────

export const KILL_SWITCH_ENV = 'SCHEDULED_REBOOTS_DISABLED';

export function scheduledRebootsDisabled(env: Record<string, string | undefined> = process.env): boolean {
  return /^(1|true|yes)$/i.test((env[KILL_SWITCH_ENV] ?? '').trim());
}

function intEnv(env: Record<string, string | undefined>, name: string, fallback: number, min: number, max: number): number {
  const raw = (env[name] ?? '').trim();
  if (!/^\d+$/.test(raw)) return fallback;
  const n = Number(raw);
  return n >= min && n <= max ? n : fallback;
}

/** Restarts per tenant per night (rolling 24 h). */
export function tenantNightlyCap(env: Record<string, string | undefined> = process.env): number {
  return intEnv(env, 'SCHEDULED_REBOOT_TENANT_CAP', 20, 1, 500);
}

/** Minutes a restarted screen has to check in before it reads "didn't come back". */
export function returnWindowMs(env: Record<string, string | undefined> = process.env): number {
  return intEnv(env, 'SCHEDULED_REBOOT_RETURN_MINUTES', 15, 5, 120) * MINUTE;
}
