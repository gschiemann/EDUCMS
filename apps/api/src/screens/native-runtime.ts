import { z } from 'zod';

/** Native heartbeat evidence is independent of web rendering and cache readiness. */
export const NATIVE_RUNTIME_HEADER = 'x-venueos-native-runtime';
export const NATIVE_POWER_ON_TTL_MS = 5 * 60_000;

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
    a.powerOnAck !== next.powerOnAck
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
