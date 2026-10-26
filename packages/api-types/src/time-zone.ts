/**
 * Per-screen time zones — the shared, pure half (2026-10-24).
 *
 * THE OWNER ASK (Greg, 2026-10-24): "I set time zone today in Goodview app
 * and it's always set to China to start… auto time zone would be amazing but
 * maybe setting from dashboard as well." A Goodview GUQ panel ships set to
 * Asia/Shanghai, and a normal Android app cannot change the system zone
 * (SET_TIME_ZONE is signature|privileged), so every clock and date on those
 * screens read Shanghai time. The fix lives above the device: every screen
 * gets ONE effective zone that the API computes and the player applies to
 * every time-showing widget and to its off-hours update window — whatever
 * the box itself is set to.
 *
 * PRECEDENCE (the only rule; `resolveEffectiveTimeZone` is it):
 *   1. the screen's own override (dashboard, `Screen.timezone`)
 *   2. the location's setting (dashboard, `Tenant.timezone`)
 *   3. automatic — from the nearest saved coordinates (screen > group >
 *      location), through an offline coordinate→IANA lookup on the API
 *      (`apps/api/src/screens/screen-time-zone.ts`)
 *   4. none — the player falls back to the device's own zone, exactly as
 *      before this feature existed.
 *
 * This module has NO lookup table and no I/O: it validates an IANA id with
 * the runtime's own `Intl` data and applies the precedence. The API and the
 * dashboard both import it, so they can never disagree about which zone
 * wins or what counts as a valid one.
 */

/** Where a screen's effective zone came from. */
export const TIME_ZONE_SOURCES = ['screen', 'location', 'auto', 'device'] as const;
export type TimeZoneSource = (typeof TIME_ZONE_SOURCES)[number];

/** Which saved coordinates the automatic zone was derived from. */
export const TIME_ZONE_AUTO_FROM = ['screen', 'group', 'location'] as const;
export type TimeZoneAutoFrom = (typeof TIME_ZONE_AUTO_FROM)[number];

/** IANA ids are short; anything longer is not one (and is not stored). */
export const TIME_ZONE_MAX_LENGTH = 64;

/**
 * Conservative shape of an IANA zone id — letters, digits, `_`, `+`, `-`
 * and up to three `/` segments ("America/Argentina/Buenos_Aires",
 * "Etc/GMT+8", "UTC"). Rejects control characters and anything
 * `Intl` would never know before the (more expensive) runtime check.
 */
const IANA_SHAPE = /^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+){0,3}$/;

const validityCache = new Map<string, boolean>();

/**
 * Is `zone` an IANA id THIS runtime can format in? Uses `Intl` as the
 * authority (the same data the player will format with), never a baked
 * list that goes stale. Cached: `Intl.DateTimeFormat` construction is the
 * expensive part.
 */
export function isValidIanaTimeZone(zone: unknown): zone is string {
  if (typeof zone !== 'string') return false;
  const z = zone.trim();
  if (!z || z.length > TIME_ZONE_MAX_LENGTH || z !== zone || !IANA_SHAPE.test(z)) return false;
  const cached = validityCache.get(z);
  if (cached !== undefined) return cached;
  let ok = false;
  try {
    // A runtime that knows the zone echoes it back canonically; an unknown
    // one throws RangeError. `UTC` and `Etc/*` are fine here — the AUTO
    // path filters the ocean fallbacks separately (see the API module).
    new Intl.DateTimeFormat('en-US', { timeZone: z });
    ok = true;
  } catch {
    ok = false;
  }
  validityCache.set(z, ok);
  return ok;
}

/**
 * `Etc/GMT±N` style ids (and bare `GMT`) are what an offline lookup answers
 * for the open ocean and for a factory default — never a place a screen
 * hangs. The automatic path treats them as "unresolved" so the screen falls
 * through to the device's zone instead of being pinned to a sea square.
 */
export function isOceanOrGenericZone(zone: string): boolean {
  return /^(?:Etc\/.*|GMT(?:[+-]\d{1,2})?|UTC|Universal|Zulu)$/i.test(zone.trim());
}

export type TimeZoneInputVerdict =
  | { ok: true; zone: string | null }
  | { ok: false; reason: 'not-a-string' | 'too-long' | 'unknown-zone' };

/**
 * Normalise an operator's zone from a PUT/PATCH body. `null`, `undefined`
 * or an empty string means "clear the setting" (back to automatic); a
 * valid IANA id is kept as typed (trimmed); anything else is refused so an
 * unknown zone can never reach a screen's manifest.
 */
export function normalizeTimeZoneInput(value: unknown): TimeZoneInputVerdict {
  if (value === null || value === undefined) return { ok: true, zone: null };
  if (typeof value !== 'string') return { ok: false, reason: 'not-a-string' };
  const z = value.trim();
  if (!z) return { ok: true, zone: null };
  if (z.length > TIME_ZONE_MAX_LENGTH) return { ok: false, reason: 'too-long' };
  if (!isValidIanaTimeZone(z)) return { ok: false, reason: 'unknown-zone' };
  return { ok: true, zone: z };
}

export interface EffectiveTimeZoneInput {
  /** `Screen.timezone` — the per-screen override. */
  screenOverride?: string | null;
  /** `Tenant.timezone` — the location's setting. */
  locationSetting?: string | null;
  /** What the coordinate lookup answered (already filtered of ocean ids), or null. */
  auto?: { zone: string; from: TimeZoneAutoFrom } | null;
}

export interface EffectiveTimeZone {
  /** The zone the screen should use, or null = "use the device's own zone". */
  zone: string | null;
  source: TimeZoneSource;
  /** The automatic answer, whether or not it won — the dashboard shows "Automatic (X)" from it. */
  auto: { zone: string; from: TimeZoneAutoFrom } | null;
}

/**
 * THE PRECEDENCE. An invalid stored value (a column edited by hand, a
 * runtime missing a zone) is skipped, never passed on: the next rule
 * answers instead, and the player never receives a zone it cannot format.
 */
export function resolveEffectiveTimeZone(input: EffectiveTimeZoneInput): EffectiveTimeZone {
  const auto = input.auto && isValidIanaTimeZone(input.auto.zone) ? input.auto : null;
  if (isValidIanaTimeZone(input.screenOverride)) {
    return { zone: input.screenOverride, source: 'screen', auto };
  }
  if (isValidIanaTimeZone(input.locationSetting)) {
    return { zone: input.locationSetting, source: 'location', auto };
  }
  if (auto) return { zone: auto.zone, source: 'auto', auto };
  return { zone: null, source: 'device', auto: null };
}

/** The screen's own clock setting disagrees with the zone it should use. */
export function deviceTimeZoneDiffers(effectiveZone: string | null | undefined, deviceZone: string | null | undefined): boolean {
  if (!effectiveZone || !deviceZone) return false;
  if (!isValidIanaTimeZone(deviceZone)) return false;
  if (effectiveZone === deviceZone) return false;
  // Two ids can name the same rules (America/Los_Angeles vs US/Pacific):
  // compare what they actually show for "now" and six months from now,
  // never just the strings.
  const now = Date.now();
  const same = [now, now + 183 * 86_400_000].every((ms) => offsetMinutes(effectiveZone, ms) === offsetMinutes(deviceZone, ms));
  return !same;
}

/** UTC offset of `zone` at `ms`, in minutes (positive east of UTC); null if the zone is unknown. */
export function offsetMinutes(zone: string, ms: number): number | null {
  if (!isValidIanaTimeZone(zone)) return null;
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    }).formatToParts(new Date(ms));
    const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? NaN);
    let hour = get('hour');
    if (hour === 24) hour = 0;
    const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), hour, get('minute'), get('second'));
    if (!Number.isFinite(asUtc)) return null;
    return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / 60_000);
  } catch {
    return null;
  }
}
