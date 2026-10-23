/**
 * Platform degradation register (2026-10-23).
 *
 * The in-process watchdogs (StorageWatchdogService, PlatformHealthMonitorService)
 * already decide whether THIS replica sees the platform as healthy. They write
 * their verdict here, and anything that must stand down while the platform is
 * degraded reads it — today the customer alert emails: when our own storage,
 * database or realtime path is in trouble, a screen that looks offline or
 * blank is far more likely OUR problem than the customer's, and emailing them
 * about it is the false positive the owner banned.
 *
 * Plain module state, not a provider: the watchdogs live in AppModule and the
 * reader lives in a feature module, and a register needs no injection. A
 * verdict older than STALE_MS is ignored, so a watchdog that stops ticking can
 * never pin the platform "degraded" forever.
 */

export type ComponentStatus = 'ok' | 'degraded' | 'down' | 'critical';

const STALE_MS = 20 * 60_000;
const state = new Map<string, { status: ComponentStatus; at: number }>();

export function reportPlatformComponent(component: string, status: ComponentStatus, nowMs = Date.now()): void {
  state.set(component, { status, at: nowMs });
}

/** Components currently reporting anything but ok (fresh verdicts only). */
export function degradedPlatformComponents(nowMs = Date.now()): string[] {
  const out: string[] = [];
  for (const [name, v] of state) {
    if (v.status !== 'ok' && nowMs - v.at <= STALE_MS) out.push(`${name}:${v.status}`);
  }
  return out;
}

/** Test hook. */
export function resetPlatformDegradationForTests(): void {
  state.clear();
}
