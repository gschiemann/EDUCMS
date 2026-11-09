import { z } from 'zod';

/**
 * THE ALERT-WATCH WATCHDOG REPORT (Manager wave 5, 2026-11-08).
 *
 * The companion Manager APK watches the Player's NATIVE ALERT WATCH while a
 * panel is dark and, when the watch stops stamping, walks a bounded ladder
 * (re-arm → restart the watch's host → report). It posts nothing itself: its
 * latest VERDICT is read back by the Player and carried on the Player's own
 * native heartbeat under the device credential, in this header
 * (`apps/player/app/.../alertwatch/AlertWatchStamp.kt`, `watchdogReportHeader`):
 *
 *   {"v":1,"verdict":"rearm-sent","mode":"on","ageMs":12000,"stampAgeMs":250000,
 *    "stampState":"watching","faces":2,"reason":"…","ladder":{"rung":"rearm","ageMs":12000},
 *    "n24h":1,"kicked":"rearm"}
 *
 * TELEMETRY ONLY: stored INSIDE `nativeRuntimeReport` (already in
 * `SCREEN_TELEMETRY_ONLY_FIELDS`), never a manifest input, never a forced
 * write. Strict: anything malformed reads as no report, and — because it is
 * attached to the runtime report with `.catch(undefined)` — a malformed block
 * can never drop the power report it rides with. `ageMs` values are the
 * device's own elapsed-clock ages at the moment the heartbeat left; add the
 * report's age on the server to show "how long ago".
 */
export const ALERT_WATCH_WATCHDOG_HEADER = 'x-venueos-alert-watch-watchdog';

export const ALERT_WATCH_WATCHDOG_VERDICTS = [
  'panel-on',
  'healthy',
  'no-stamp',
  'deferred-liveness',
  'hold',
  'not-watchable',
  'silent-observed',
  'silent-backoff',
  'silent-capped',
  'rearm-sent',
  'restart-sent',
  'recovered',
  'unrecovered',
] as const;

export const ALERT_WATCH_WATCHDOG_RUNGS = ['rearm', 'restart', 'unrecovered', 'observed', 'backoff', 'capped'] as const;

const ageMs = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const shortAscii = z.string().min(1).max(160).regex(/^[\x20-\x7e]+$/);

export const alertWatchWatchdogSchema = z.strictObject({
  v: z.literal(1),
  verdict: z.enum(ALERT_WATCH_WATCHDOG_VERDICTS),
  mode: z.enum(['on', 'observe']),
  ageMs,
  stampAgeMs: ageMs.optional(),
  stampState: z.enum(['watching', 'idle', 'not-watchable']).optional(),
  faces: z.number().int().min(0).max(8),
  reason: shortAscii.optional(),
  ladder: z.strictObject({ rung: z.enum(ALERT_WATCH_WATCHDOG_RUNGS), ageMs }).optional(),
  n24h: z.number().int().min(0).max(999),
  kicked: z.enum(['rearm', 'restart-host']).optional(),
});

export type AlertWatchWatchdogReport = z.infer<typeof alertWatchWatchdogSchema>;

/** The header, parsed; null when absent, too long or malformed in any way. */
export function parseAlertWatchWatchdogHeader(value: unknown): AlertWatchWatchdogReport | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > 1024) return null;
  try {
    const parsed = alertWatchWatchdogSchema.safeParse(JSON.parse(value));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** The verdicts that mean the Manager DID something, or could not help — the ones worth an audit-grade look. */
export const ALERT_WATCH_WATCHDOG_INTERVENTIONS: ReadonlySet<AlertWatchWatchdogReport['verdict']> = new Set([
  'rearm-sent',
  'restart-sent',
  'unrecovered',
  'silent-observed',
  'silent-backoff',
  'silent-capped',
]);
