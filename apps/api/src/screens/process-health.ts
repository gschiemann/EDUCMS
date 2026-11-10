import { z } from 'zod';

/**
 * THE PLAYER PROCESS HEALTH REPORT (2026-11-09, player stability gaps 1, 4, 8).
 *
 * The Android Player's native heartbeat carries, under the device credential,
 * what only the process itself can see (`apps/player/app/.../health/ProcessHealthReport.kt`):
 *
 *   {"v":1,
 *    "mem":{"n":3,"max":15,"last":15,"ageMs":40000,"frees":1,"rssMb":310,"availMb":420,"low":false},
 *    "main":{"openMs":0,"n":2,"maxMs":14000,"lastMs":11000,"ageMs":600000,"starved":0,"stack":"…"},
 *    "exits":[{"at":1762700000000,"r":6,"st":0,"imp":100,"pssKb":0,"rssKb":0,"desc":"…"}],
 *    "th":0}
 *
 *  • `mem`   — memory-pressure callbacks in this process (`n` count, `max` / `last`
 *              trim level, `frees` = times the WebView RAM cache was dropped).
 *  • `main`  — the main-thread probe: `openMs` > 0 means the thread that draws
 *              the glass is NOT answering right now (the heartbeat thread is a
 *              different one, so it can say so); `n` stalls of ≥ 10 s this process.
 *  • `exits` — the previous processes' OS exit records (`ApplicationExitInfo`, API 30+):
 *              reason 3 low-memory, 5 native crash, 6 ANR, 2 signalled (OEM / lmkd kill).
 *  • `th`    — PowerManager thermal status 0–6 (API 29+), absent on older boxes.
 *
 * TELEMETRY ONLY: stored INSIDE `nativeRuntimeReport` (already in
 * `SCREEN_TELEMETRY_ONLY_FIELDS`), never a manifest input, never a forced
 * write; `.catch(undefined)` so a malformed block can never cost the power
 * report it rides with. `PLAYER_PROCESS_HEALTH=off` ignores the header and
 * tells each Player `processHealth: 'off'` (it stops the probe, the memory
 * free, the header and its ANR trace posts).
 */
export const PROCESS_HEALTH_HEADER = 'x-venueos-process-health';

const count = z.number().int().min(0).max(1_000_000);
const ms = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const printable = (max: number) => z.string().max(max).regex(/^[\x20-\x7e]*$/);

export const processHealthSchema = z.strictObject({
  v: z.literal(1),
  mem: z.strictObject({
    n: count,
    max: z.number().int().min(0).max(100),
    last: z.number().int().min(0).max(100),
    frees: count,
    ageMs: ms.optional(),
    rssMb: z.number().int().min(0).max(1_000_000).optional(),
    availMb: z.number().int().min(0).max(10_000_000).optional(),
    low: z.boolean().optional(),
  }),
  main: z.strictObject({
    openMs: ms,
    n: count,
    maxMs: ms,
    lastMs: ms,
    starved: count,
    ageMs: ms.optional(),
    stack: printable(600).optional(),
  }),
  exits: z.array(z.strictObject({
    at: ms,
    r: z.number().int().min(0).max(99),
    st: z.number().int().min(-2_147_483_648).max(2_147_483_647),
    imp: z.number().int().min(0).max(10_000),
    pssKb: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    rssKb: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    desc: printable(160).optional(),
  })).max(4).optional(),
  th: z.number().int().min(0).max(6).optional(),
});

export type ProcessHealthReport = z.infer<typeof processHealthSchema>;

export function processHealthOff(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.PLAYER_PROCESS_HEALTH ?? '').trim().toLowerCase() === 'off';
}

/** The header, parsed; null when absent, too long or malformed in any way. */
export function parseProcessHealthHeader(value: unknown): ProcessHealthReport | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2048) return null;
  try {
    const parsed = processHealthSchema.safeParse(JSON.parse(value));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
