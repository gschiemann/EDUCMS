/**
 * Companion Manager health, carried by the Player (2026-11-08, Manager deep
 * dive §5 items 1 and 2).
 *
 * The Manager holds no device credential. It publishes its own health facts
 * in its provider (apps/player/manager/.../health/ManagerHealthReport.kt,
 * schema 1); the Player reads them every 30 s and carries them on its
 * DEVICE-AUTHENTICATED native heartbeat as `x-venueos-manager-health`. The
 * same Player relays the Manager's `ota-state` / `crash-report` posts with its
 * device token (body `source: 'manager', relayedBy: 'player'`).
 *
 * Every device timestamp is converted to the SERVER clock on receipt
 * (`serverAt = receivedAt − (deviceNow − deviceAt)`), so a panel whose clock
 * is wrong never reads as "not reporting". Anything malformed is dropped,
 * field by field; a report with no usable `now` is refused whole.
 *
 * THE KILL SWITCH. `MANAGER_REPORT_RELAY=off` (exactly; anything else, or
 * unset, is on): the header is ignored, and the heartbeat reply tells each
 * Player `managerRelay: 'off'`, so it stops relaying and the Manager goes back
 * to its anonymous posts — the 1.0.24 behaviour. Failure direction: open —
 * a report the server cannot parse is simply not stored; nothing on the
 * screen's content, credential or OTA state depends on it.
 */

export const MANAGER_HEALTH_HEADER = 'x-venueos-manager-health';
export const MANAGER_REPORT_RELAY_ENV = 'MANAGER_REPORT_RELAY';
export const MANAGER_RELAUNCH_REASONS = ['player-unresponsive', 'after-update'] as const;
export type ManagerRelaunchReason = (typeof MANAGER_RELAUNCH_REASONS)[number];

const MAX_HEADER_CHARS = 4096;
const MAX_RECENT = 20;
const WEEK_MS = 7 * 24 * 60 * 60_000;

/** What `Screen.managerHealthReport` holds. All times are ISO, server clock. */
export interface StoredManagerHealth {
  schema: 1;
  reportedAt: string;
  version: string | null;
  versionCode: number | null;
  watchdogTickAt: string | null;
  watchdogStartedAt: string | null;
  relaunches: { total: number; recent: Array<{ at: string; reason: ManagerRelaunchReason }> };
  rollback: { at: string; versionCode: number | null } | null;
  quarantined: number[];
  installPermission: boolean | null;
  installTapPendingSince: string | null;
}

export function managerReportRelayOff(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.MANAGER_REPORT_RELAY ?? '').trim().toLowerCase() === 'off';
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function parseManagerHealthHeader(raw: unknown, receivedAt: Date): StoredManagerHealth | null {
  const text = Array.isArray(raw) ? raw[0] : raw;
  if (typeof text !== 'string' || !text.trim() || text.length > MAX_HEADER_CHARS) return null;
  let j: any;
  try {
    j = JSON.parse(text);
  } catch {
    return null;
  }
  if (!j || typeof j !== 'object' || j.schema !== 1 || !finite(j.now) || j.now <= 0) return null;
  const deviceNow: number = j.now;
  const recvMs = receivedAt.getTime();
  // A device time → the server clock. Future stamps (beyond the row's own
  // `now`) and zero are "no fact", never a guess.
  const toServer = (v: unknown): string | null => {
    if (!finite(v) || v <= 0 || v > deviceNow) return null;
    return new Date(recvMs - (deviceNow - v)).toISOString();
  };

  const recentRaw: unknown[] = Array.isArray(j.relaunches?.recent) ? j.relaunches.recent : [];
  const recent = recentRaw
    .map((r: any) => ({ at: toServer(r?.at), reason: r?.reason }))
    .filter((r): r is { at: string; reason: ManagerRelaunchReason } =>
      !!r.at && (MANAGER_RELAUNCH_REASONS as readonly string[]).includes(r.reason) &&
      recvMs - Date.parse(r.at) <= WEEK_MS)
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
    .slice(-MAX_RECENT);
  const total = finite(j.relaunches?.total) && j.relaunches.total >= 0 ? Math.floor(j.relaunches.total) : recent.length;

  const rollbackAt = j.rollback && typeof j.rollback === 'object' ? toServer(j.rollback.at) : null;
  const quarantined = Array.isArray(j.quarantined)
    ? Array.from(new Set<number>(j.quarantined.filter((v: unknown) => finite(v) && v > 0).map((v: number) => Math.floor(v)))).sort((a, b) => a - b).slice(0, 10)
    : [];

  return {
    schema: 1,
    reportedAt: receivedAt.toISOString(),
    version: typeof j.version === 'string' && j.version.trim() ? j.version.trim().slice(0, 40) : null,
    versionCode: finite(j.versionCode) && j.versionCode > 0 ? Math.floor(j.versionCode) : null,
    watchdogTickAt: toServer(j.watchdogTickAt),
    watchdogStartedAt: toServer(j.watchdogStartedAt),
    relaunches: { total: Math.max(total, recent.length), recent },
    rollback: rollbackAt
      ? { at: rollbackAt, versionCode: finite(j.rollback.versionCode) && j.rollback.versionCode > 0 ? Math.floor(j.rollback.versionCode) : null }
      : null,
    quarantined: quarantined as number[],
    installPermission: typeof j.installPermission === 'boolean' ? j.installPermission : null,
    installTapPendingSince: toServer(j.installTapPendingSince),
  };
}

/**
 * Does this report say something NEW enough to force a write outside the
 * 25 s ping debounce? A relaunch, a rollback, a quarantine, a tap prompt
 * starting or ending, a permission change, a new Manager build — or the
 * first report. An unchanged report rides the debounce like every other
 * heartbeat field (the watchdog tick moves every 30 s by design).
 */
export function managerHealthChanged(prior: unknown, next: StoredManagerHealth | null): boolean {
  if (!next) return false;
  const p = prior as Partial<StoredManagerHealth> | null | undefined;
  if (!p || typeof p !== 'object' || p.schema !== 1) return true;
  return (
    (p.relaunches?.total ?? -1) !== next.relaunches.total ||
    (p.rollback?.versionCode ?? null) !== (next.rollback?.versionCode ?? null) ||
    !!p.rollback !== !!next.rollback ||
    JSON.stringify(p.quarantined ?? []) !== JSON.stringify(next.quarantined) ||
    !!p.installTapPendingSince !== !!next.installTapPendingSince ||
    (p.installPermission ?? null) !== next.installPermission ||
    (p.version ?? null) !== next.version
  );
}

/** A relayed Manager report: the body says so AND the caller proved the screen's credential. */
export function isRelayedManagerReport(body: { source?: unknown; relayedBy?: unknown } | null | undefined, deviceAuthenticated: boolean): boolean {
  return deviceAuthenticated && String(body?.source ?? '').toLowerCase() === 'manager' && String(body?.relayedBy ?? '').toLowerCase() === 'player';
}
