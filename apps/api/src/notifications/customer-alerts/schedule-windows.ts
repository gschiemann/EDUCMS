/**
 * On/off-window math for the customer alert emails (2026-10-23).
 *
 * A server-side PORT of the player's own window math —
 * `apps/web/src/app/player/softSchedule.ts` (`parseSoftWindow`, `covers`,
 * `desiredOnAt`), itself a port of the APK's `DisplayScheduleMath.kt` — plus
 * the dashboard's "which rows govern this screen" precedence
 * (`apps/web/src/components/dashboard/district/uptime.ts` `windowsForScreen`:
 * the screen's own rows beat its group's, which beat tenant-wide rows).
 *
 * The alert worker must answer "was this screen SUPPOSED to be off?" the same
 * way the screen itself does, or it would email an admin about a panel that
 * was switched off on schedule. `schedule-windows.spec.ts` runs the web module
 * and this one over the same fixtures so the two cannot drift.
 *
 * Rules (verbatim from the player):
 *   - the ON window runs [onTime, offTime); when offTime <= onTime it crosses
 *     midnight and `daysOfWeek` names the day it STARTS on;
 *   - onTime == offTime is a typo and drops the row;
 *   - the screen's IANA zone, an unknown zone reads as UTC;
 *   - no rows → no opinion (null), never "off".
 */

export interface OnWindow {
  id: string;
  /** 0 = Sunday … 6 = Saturday. */
  daysOfWeek: ReadonlySet<number>;
  onMinute: number;
  offMinute: number;
  timezone: string;
}

const MINUTES_PER_DAY = 24 * 60;
const DOW_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const formatterCache = new Map<string, Intl.DateTimeFormat | null>();

export function parseHHmm(raw: unknown): number | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (!s || s.length > 8) return null;
  const parts = s.split(':');
  if (parts.length < 2 || parts.length > 3) return null;
  if (!parts.every((p) => /^\d{1,2}$/.test(p))) return null;
  const h = Number(parts[0]);
  const m = Number(parts[1]);
  if (parts.length === 3) {
    const sec = Number(parts[2]);
    if (sec < 0 || sec > 59) return null;
  }
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return h * 60 + m;
}

export function parseOnWindow(row: unknown): OnWindow | null {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
  const r = row as Record<string, unknown>;
  if (r.isActive === false) return null;
  const onMinute = parseHHmm(r.onTime);
  const offMinute = parseHHmm(r.offTime);
  if (onMinute === null || offMinute === null) return null;
  if (onMinute === offMinute) return null;
  if (!Array.isArray(r.daysOfWeek)) return null;
  const days = new Set<number>();
  for (const d of r.daysOfWeek) {
    if (typeof d === 'number' && Number.isInteger(d) && d >= 0 && d <= 6) days.add(d);
  }
  if (days.size === 0) return null;
  const timezone = typeof r.timezone === 'string' && r.timezone.trim() ? r.timezone.trim() : 'UTC';
  const id = typeof r.id === 'string' && r.id ? r.id : `${onMinute}-${offMinute}-${timezone}`;
  return { id, daysOfWeek: days, onMinute, offMinute, timezone };
}

function formatterFor(zone: string): Intl.DateTimeFormat | null {
  const key = zone.trim() || 'UTC';
  const cached = formatterCache.get(key);
  if (cached !== undefined) return cached;
  let fmt: Intl.DateTimeFormat | null = null;
  try {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: key,
      hourCycle: 'h23',
      hour12: false,
      weekday: 'short',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
  } catch {
    fmt = null;
  }
  formatterCache.set(key, fmt);
  return fmt;
}

function resolveZone(zone: string): string {
  return formatterFor(zone) ? zone.trim() || 'UTC' : 'UTC';
}

function localPartsOf(zone: string, ms: number) {
  const fmt = formatterFor(zone) ?? (formatterFor('UTC') as Intl.DateTimeFormat);
  const parts = fmt.formatToParts(new Date(ms));
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
  let hour = Number(get('hour'));
  if (hour === 24) hour = 0;
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour,
    minute: Number(get('minute')),
    second: Number(get('second')),
    dow: DOW_INDEX[get('weekday')] ?? new Date(ms).getUTCDay(),
  };
}

function zonedInstant(zone: string, y: number, m: number, d: number, minuteOfDay: number): number {
  const wall = Date.UTC(y, m - 1, d, Math.floor(minuteOfDay / 60), minuteOfDay % 60, 0, 0);
  let guess = wall;
  for (let i = 0; i < 2; i++) {
    const p = localPartsOf(zone, guess);
    const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second, 0);
    const next = wall - (asUtc - guess);
    if (next === guess) break;
    guess = next;
  }
  return guess;
}

function instantOnDay(zone: string, baseMs: number, dayOffset: number, minuteOfDay: number): number | null {
  if (minuteOfDay < 0 || minuteOfDay >= MINUTES_PER_DAY) return null;
  const p = localPartsOf(zone, baseMs);
  const shifted = new Date(Date.UTC(p.year, p.month - 1, p.day + dayOffset, 12, 0, 0, 0));
  return zonedInstant(zone, shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate(), minuteOfDay);
}

/** True when `w`'s ON window contains `atMs`. */
export function covers(w: OnWindow, atMs: number): boolean {
  const zone = resolveZone(w.timezone);
  for (let dayOffset = -1; dayOffset <= 0; dayOffset++) {
    const start = instantOnDay(zone, atMs, dayOffset, w.onMinute);
    if (start === null) continue;
    if (!w.daysOfWeek.has(localPartsOf(zone, start).dow)) continue;
    const extraDay = w.offMinute <= w.onMinute ? 1 : 0;
    const end = instantOnDay(zone, atMs, dayOffset + extraDay, w.offMinute) ?? Number.MAX_SAFE_INTEGER;
    if (atMs >= start && atMs < end) return true;
  }
  return false;
}

/** true = some window is on; false = windows exist and none covers it (OFF); null = no windows. */
export function desiredOnAt(windows: readonly OnWindow[], atMs: number): boolean | null {
  if (windows.length === 0) return null;
  return windows.some((w) => covers(w, atMs));
}

export interface DisplayScheduleRowLike {
  id?: string;
  screenId?: string | null;
  screenGroupId?: string | null;
  daysOfWeek: number[];
  onTime: string;
  offTime: string;
  timezone: string;
  isActive?: boolean;
}

/** The rows that govern one screen: its own beat its group's beat tenant-wide (all-or-nothing per level). */
export function windowsForScreen(
  screen: { id: string; screenGroupId?: string | null },
  rows: readonly DisplayScheduleRowLike[],
): OnWindow[] {
  const active = rows.filter((r) => r.isActive !== false);
  const own = active.filter((r) => r.screenId && r.screenId === screen.id);
  const group = screen.screenGroupId
    ? active.filter((r) => !r.screenId && r.screenGroupId && r.screenGroupId === screen.screenGroupId)
    : [];
  const tenant = active.filter((r) => !r.screenId && !r.screenGroupId);
  const pick = own.length ? own : group.length ? group : tenant;
  return pick.map(parseOnWindow).filter((w): w is OnWindow => !!w);
}

/**
 * The tenant's player-update (OTA) install window as an every-day window, or
 * null when none is configured. `otaWindowStart`/`End` are "HH:MM" with
 * wrap-around ("22:00"–"04:00" = 10 PM to 4 AM).
 */
export function otaWindowOf(t: {
  otaWindowStart?: string | null;
  otaWindowEnd?: string | null;
  otaWindowTimezone?: string | null;
}): OnWindow | null {
  return parseOnWindow({
    id: 'ota-window',
    onTime: t.otaWindowStart,
    offTime: t.otaWindowEnd,
    timezone: t.otaWindowTimezone || 'UTC',
    daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
  });
}
