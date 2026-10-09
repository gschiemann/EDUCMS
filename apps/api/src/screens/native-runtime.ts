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

/** Server age, not the kiosk's wall clock. Silence and an expired command never wake a screen. */
export function pendingNativePowerOn(
  value: Date | null | undefined,
  nowMs = Date.now(),
): string | null {
  if (!value) return null;
  const age = nowMs - value.getTime();
  return age >= 0 && age < NATIVE_POWER_ON_TTL_MS ? value.toISOString() : null;
}
