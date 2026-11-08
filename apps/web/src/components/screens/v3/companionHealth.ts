/**
 * The companion line in the screen drawer's Device card (2026-11-08, Manager
 * deep dive §5 item 1).
 *
 * The companion Manager publishes its health; the Player carries it on its
 * signed heartbeat; the API stores it as `Screen.managerHealthReport`
 * (apps/api/src/screens/manager-health.ts — every time already on the server
 * clock). This turns that report into ONE plain line, as a message key under
 * `screens.drawer.companion` plus its values, and says only what the report
 * proves (Player Reliability rule 10):
 *
 *   * no report (every build before this one) → `null`: the Device card keeps
 *     its existing version-only "Player app" row and nothing else;
 *   * an install waiting for a person on the panel → that, first;
 *   * a fresh report whose watchdog tick is old → "not reporting since …"
 *     (the Player is alive and says the companion's watchdog has stopped);
 *   * a report that stopped arriving while the screen still checks in →
 *     "not reporting since …";
 *   * a report that stopped arriving because the SCREEN went quiet → a quiet
 *     "last reported … ago" — the screen's own offline state already says
 *     the rest, and blaming the companion would be a guess;
 *   * otherwise "healthy", with this week's player restarts and the latest
 *     reason when there were any.
 *
 * Pure; `now` is passed in.
 */
import { compactAge, msOf } from './screenOps';

export interface ManagerHealthReport {
  schema: 1;
  reportedAt?: string | null;
  version?: string | null;
  watchdogTickAt?: string | null;
  relaunches?: { total?: number; recent?: Array<{ at: string; reason: string }> } | null;
  rollback?: { at: string; versionCode?: number | null } | null;
  quarantined?: number[] | null;
  installPermission?: boolean | null;
  installTapPendingSince?: string | null;
}

export interface CompanionInput {
  managerHealth?: ManagerHealthReport | null;
  managerHealthAt?: string | null;
  lastPingAt?: string | null;
}

export interface CompanionLine {
  key: 'healthy' | 'healthyRestarts' | 'tapPending' | 'notReporting' | 'lastReported';
  values?: Record<string, string | number>;
  /** The quieter second line, if any — also a key under `screens.drawer.companion`. */
  hint?: { key: 'quarantined' | 'noInstallPermission'; values?: Record<string, string | number> };
  tone?: 'warn';
}

/** The watchdog ticks every 30 s; five minutes without one is not jitter. */
export const WATCHDOG_SILENT_MS = 5 * 60_000;
/** The native heartbeat carries the report at least every 5 minutes. */
export const REPORT_FRESH_MS = 15 * 60_000;
/** A screen that checked in this recently is "still checking in". */
const SCREEN_CHECKING_IN_MS = 5 * 60_000;
const WEEK_MS = 7 * 24 * 60 * 60_000;

/** Locale-neutral clock time for "since …" (the drawer already uses compact ages elsewhere). */
function clock(ms: number): string {
  return new Date(ms).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function companionHealthLine(screen: CompanionInput, now: number): CompanionLine | null {
  const h = screen.managerHealth;
  if (!h || typeof h !== 'object' || h.schema !== 1) return null;
  const reportedAt = msOf(screen.managerHealthAt ?? h.reportedAt ?? null);
  if (reportedAt == null) return null;

  const hint = (): CompanionLine['hint'] => {
    const q = Array.isArray(h.quarantined) ? h.quarantined.length : 0;
    if (q > 0) return { key: 'quarantined', values: { count: q } };
    if (h.installPermission === false) return { key: 'noInstallPermission' };
    return undefined;
  };

  const reportAge = now - reportedAt;
  if (reportAge > REPORT_FRESH_MS) {
    const ping = msOf(screen.lastPingAt ?? null);
    const screenCheckingIn = ping != null && now - ping >= 0 && now - ping < SCREEN_CHECKING_IN_MS;
    if (screenCheckingIn) return { key: 'notReporting', values: { since: clock(reportedAt) }, tone: 'warn', hint: hint() };
    const ago = compactAge(reportedAt, now);
    return ago ? { key: 'lastReported', values: { ago }, hint: hint() } : null;
  }

  const tapSince = msOf(h.installTapPendingSince ?? null);
  if (tapSince != null) {
    return { key: 'tapPending', values: { ago: compactAge(tapSince, now) ?? '0s' }, tone: 'warn', hint: hint() };
  }

  const tick = msOf(h.watchdogTickAt ?? null);
  if (tick != null && reportedAt - tick > WATCHDOG_SILENT_MS) {
    return { key: 'notReporting', values: { since: clock(tick) }, tone: 'warn', hint: hint() };
  }

  const recent = (h.relaunches?.recent ?? [])
    .map((r) => ({ at: msOf(r?.at ?? null), reason: r?.reason }))
    .filter((r): r is { at: number; reason: string } => r.at != null && now - r.at >= 0 && now - r.at <= WEEK_MS)
    .sort((a, b) => a.at - b.at);
  if (recent.length > 0) {
    const reason = recent[recent.length - 1].reason === 'after-update' ? 'afterUpdate' : 'unresponsive';
    return { key: 'healthyRestarts', values: { count: recent.length, reason }, hint: hint() };
  }
  return { key: 'healthy', hint: hint() };
}
