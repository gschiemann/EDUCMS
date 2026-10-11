import { z } from 'zod';

/** Native heartbeat evidence is independent of web rendering and cache readiness. */
export const NATIVE_RUNTIME_HEADER = 'x-venueos-native-runtime';
export const NATIVE_POWER_ON_TTL_MS = 5 * 60_000;

const mechanismId = z
  .string()
  .max(32)
  .regex(/^[a-z0-9][a-z0-9-]*$/);
const wallMs = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);

/**
 * What the player OBSERVED about sleeping (2026-10-11, player SleepProof).
 * Evidence, stated as such on the dashboard — never content health and never
 * "off" beyond what Android's own interactive flag showed.
 *  • blank   — the BLANK mechanism the device resolved right now;
 *  • dream   — a screensaver was SEEN replacing a screen-timeout sleep;
 *  • a11y    — the "VenueOS sleep" accessibility service is on;
 *  • admin   — the player is an active device admin;
 *  • last    — the last native blank: mechanism, observed outcome, when;
 *  • restore — the last after-alert restore: decision, outcome, when.
 */
export const NATIVE_SLEEP_OUTCOMES = [
  'off',
  'on',
  'dream',
  'black',
  'pending',
  'unknown',
  'kept-on',
  'failed',
] as const;
const sleepSchema = z.object({
  blank: mechanismId.optional(),
  dream: z.boolean().optional(),
  a11y: z.boolean().optional(),
  admin: z.boolean().optional(),
  last: z
    .object({ m: mechanismId, o: z.enum(NATIVE_SLEEP_OUTCOMES), at: wallMs })
    .optional(),
  restore: z
    .object({
      d: z.string().max(40).regex(/^[A-Z_]+$/),
      o: z.enum(NATIVE_SLEEP_OUTCOMES),
      at: wallMs,
    })
    .optional(),
});

const runtimeSchema = z.object({
  schema: z.literal(1),
  interactive: z.boolean().nullable(),
  foreground: z.boolean(),
  standbySinceMs: z
    .number()
    .int()
    .nonnegative()
    .max(Number.MAX_SAFE_INTEGER)
    .nullable(),
  elapsedRealtimeMs: z
    .number()
    .int()
    .nonnegative()
    .max(Number.MAX_SAFE_INTEGER),
  powerOnAck: z.string().datetime({ precision: 3 }).nullable(),
  // Additive (player 1.1.25 candidate). Optional so a 1.1.24 report parses
  // exactly as before; a malformed block drops the WHOLE report, like any
  // other malformed field.
  powerOnAttempts: z.number().int().min(0).max(9).optional(),
  sleep: sleepSchema.optional(),
});

export type NativeRuntimeReport = z.infer<typeof runtimeSchema>;

export function parseNativeRuntime(value: unknown): NativeRuntimeReport | null {
  if (typeof value !== 'string' || value.length > 1024) return null;
  try {
    const input: unknown = JSON.parse(value);
    const result = runtimeSchema.safeParse(input);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

/**
 * Has the power / wake state changed since the report the row already holds?
 * (2026-10-10, review P2 on 78a41305.) Every native heartbeat used to force a
 * `screens` write, bypassing the 25 s ping debounce. Only a CHANGE in what the
 * panel is doing — interactive, foreground, standby onset, or a new power-on
 * acknowledgement — must reach the row promptly; an unchanged report rides
 * the ordinary debounced liveness write. `elapsedRealtimeMs` advances on every
 * beat by definition and is deliberately not part of the comparison. An
 * unreadable stored report counts as changed (write it).
 */
export function nativePowerStateChanged(
  stored: unknown,
  next: NativeRuntimeReport,
): boolean {
  const prev = runtimeSchema.safeParse(stored);
  if (!prev.success) return true;
  const a = prev.data;
  return (
    a.interactive !== next.interactive ||
    a.foreground !== next.foreground ||
    a.standbySinceMs !== next.standbySinceMs ||
    a.powerOnAck !== next.powerOnAck ||
    // A new sleep observation (its timestamp moves only when the player
    // records one) or a change in what the panel CAN do — both rare.
    a.sleep?.last?.at !== next.sleep?.last?.at ||
    a.sleep?.restore?.at !== next.sleep?.restore?.at ||
    a.sleep?.restore?.o !== next.sleep?.restore?.o ||
    a.sleep?.blank !== next.sleep?.blank ||
    a.sleep?.dream !== next.sleep?.dream ||
    a.sleep?.a11y !== next.sleep?.a11y ||
    a.sleep?.admin !== next.sleep?.admin
  );
}

/** Server age, not the kiosk's wall clock. Silence and an expired command never wake a screen. */
export function pendingNativePowerOn(
  value: Date | null | undefined,
  nowMs = Date.now(),
): string | null {
  if (!value) return null;
  const age = nowMs - value.getTime();
  return age >= 0 && age < NATIVE_POWER_ON_TTL_MS ? value.toISOString() : null;
}
