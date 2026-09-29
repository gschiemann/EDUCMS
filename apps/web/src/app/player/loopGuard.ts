/**
 * loopGuard — the two-deck path's own circuit breaker.
 *
 * Two hardware decoders at once is the risk on a box nobody has qualified: the
 * benign failure is an element that errors (the engine falls back on its own);
 * the bad one is a renderer that dies and restarts in a loop. This is the
 * memory that survives a restart:
 *
 *   BLOCK   — after a device-shaped failure ("standby-error", "handoff-timeout",
 *             …) two-deck stays off on this device for 24 h, then gets another
 *             chance (a new bundle, a new WebView, a firmware update).
 *   MARKER  — set while the engine runs, refreshed once a minute, cleared on a
 *             clean unload. A boot that finds it means the last session ended
 *             without `pagehide`. That alone is NOT a crash — a venue that cuts
 *             the mains every night leaves it too — so only a session that died
 *             within `CRASH_WINDOW_MS` of starting counts. Two such deaths in a
 *             row block two-deck for the same 24 h. A session that ran longer
 *             than that proves the path is not what killed it.
 *
 * Pure over a `KV` (localStorage-shaped) and an injected clock; every read and
 * write is guarded, because storage can be unreadable and must never throw into
 * playback.
 */
export interface KV {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}

export const LS_LOOP_BLOCKED_UNTIL = 'edu_loop_twodeck_blocked_until';
export const LS_LOOP_MARKER = 'edu_loop_twodeck_marker';
export const LS_LOOP_CRASHES = 'edu_loop_twodeck_crashes';
export const LS_LOOP_LEAD_MS = 'edu_loop_lead_ms';

export const BLOCK_MS = 24 * 60 * 60 * 1000;
export const CRASH_WINDOW_MS = 15 * 60 * 1000;
export const CRASH_LIMIT = 2;

const num = (v: string | null): number | null => {
  if (v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

export function isBlocked(kv: KV, nowMs: number): boolean {
  const until = safe(() => num(kv.getItem(LS_LOOP_BLOCKED_UNTIL)), null);
  return until !== null && until > nowMs;
}

export function blockFor(kv: KV, nowMs: number, ms: number = BLOCK_MS): void {
  safe(() => kv.setItem(LS_LOOP_BLOCKED_UNTIL, String(nowMs + ms)), undefined);
}

/** The engine started: record when, and that it is alive. */
export function markStarted(kv: KV, nowMs: number): void {
  safe(() => kv.setItem(LS_LOOP_MARKER, JSON.stringify({ start: nowMs, alive: nowMs })), undefined);
}

/** Once a minute while running. */
export function markAlive(kv: KV, nowMs: number): void {
  safe(() => {
    const raw = kv.getItem(LS_LOOP_MARKER);
    const m = raw ? (JSON.parse(raw) as { start?: number }) : null;
    const start = m && Number.isFinite(m.start) ? (m.start as number) : nowMs;
    kv.setItem(LS_LOOP_MARKER, JSON.stringify({ start, alive: nowMs }));
  }, undefined);
}

/** A clean unload (`pagehide`) or the engine stopped on purpose. */
export function markStopped(kv: KV): void {
  safe(() => kv.removeItem(LS_LOOP_MARKER), undefined);
}

/**
 * At page boot. Returns true when this boot just BLOCKED two-deck because the
 * last two sessions each died soon after starting it.
 */
export function bootCheck(kv: KV, nowMs: number): boolean {
  return safe(() => {
    const raw = kv.getItem(LS_LOOP_MARKER);
    if (!raw) {
      // The last session ended cleanly (or never ran two-deck): the streak is over.
      kv.removeItem(LS_LOOP_CRASHES);
      return false;
    }
    kv.removeItem(LS_LOOP_MARKER);
    let start = NaN;
    let alive = NaN;
    try {
      const m = JSON.parse(raw) as { start?: number; alive?: number };
      start = Number(m.start);
      alive = Number(m.alive);
    } catch { /* unreadable marker: treat as a short session? no — as unknown */ }
    // A session that ran past the window proves two-deck was not what killed it.
    if (!Number.isFinite(start) || !Number.isFinite(alive) || alive - start >= CRASH_WINDOW_MS) {
      kv.removeItem(LS_LOOP_CRASHES);
      return false;
    }
    const crashes = (num(kv.getItem(LS_LOOP_CRASHES)) ?? 0) + 1;
    if (crashes >= CRASH_LIMIT) {
      blockFor(kv, nowMs);
      kv.removeItem(LS_LOOP_CRASHES);
      return true;
    }
    kv.setItem(LS_LOOP_CRASHES, String(crashes));
    return false;
  }, false);
}

/** The engine's persisted resume-latency guess. */
export function readLeadMs(kv: KV): number | null {
  const n = safe(() => num(kv.getItem(LS_LOOP_LEAD_MS)), null);
  return n !== null && n >= 20 && n <= 600 ? n : null;
}

export function writeLeadMs(kv: KV, ms: number): void {
  if (!Number.isFinite(ms)) return;
  safe(() => kv.setItem(LS_LOOP_LEAD_MS, String(Math.round(ms))), undefined);
}

/** Failure reasons that mean "this device cannot do it" (block for a day), versus a one-off. */
export function isDeviceShapedFailure(reason: string): boolean {
  // `degraded-playback` is the post-swap frame-rate check (loopDecks.ts degrade()): the
  // second element presented a fraction of the first one's rate — a second decoder
  // that is not a real one. Without it here, an undone hand-off would be tried, and
  // undone, again on every mount.
  // A reason may carry detail after a colon (`standby-not-ready:rs1p1t0`); only the head names the failure.
  return /^(standby-error|standby-not-ready|standby-setup-failed|handoff-timeout|play-rejected|play-threw|degraded-playback)$/.test(reason.split(':')[0]);
}
