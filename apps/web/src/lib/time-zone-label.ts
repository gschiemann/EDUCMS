/**
 * Time-zone labels and the picker list for the dashboard (2026-10-24).
 *
 * The API answers a screen's (or a location's) effective zone as an IANA id
 * plus where it came from; this module turns that into what an operator
 * reads — "America/Los_Angeles · PDT (UTC−7)" — and builds the picker's
 * option list from the browser's own zone data (`Intl.supportedValuesOf`,
 * Safari 15.4+ / Chrome 99+), with a short built-in list as the fallback so
 * the picker is never empty. Pure; `nowMs` is injected for tests.
 */

import { isValidIanaTimeZone, offsetMinutes } from '@cms/api-types';

/** Shown first when the runtime cannot list zones; also the "common" group in the picker. */
export const COMMON_TIME_ZONES: readonly string[] = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Phoenix',
  'America/Los_Angeles',
  'America/Anchorage',
  'Pacific/Honolulu',
  'America/Toronto',
  'America/Vancouver',
  'America/Mexico_City',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Madrid',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Singapore',
  'Asia/Shanghai',
  'Asia/Tokyo',
  'Australia/Sydney',
  'UTC',
];

/** Every zone the picker offers: the common ones first, then the rest the runtime knows, A→Z. */
export function timeZoneOptions(): readonly string[] {
  let all: string[] = [];
  try {
    const intl = Intl as unknown as { supportedValuesOf?: (key: string) => string[] };
    all = typeof intl.supportedValuesOf === 'function' ? intl.supportedValuesOf('timeZone') : [];
  } catch {
    all = [];
  }
  const common = COMMON_TIME_ZONES.filter((z) => isValidIanaTimeZone(z));
  const seen = new Set(common);
  const rest = all.filter((z) => !seen.has(z) && isValidIanaTimeZone(z)).sort();
  return [...common, ...rest];
}

/** "UTC−7" / "UTC+5:30" / "UTC" — the human offset at `nowMs`. */
export function formatUtcOffset(zone: string, nowMs: number): string | null {
  const minutes = offsetMinutes(zone, nowMs);
  if (minutes === null) return null;
  if (minutes === 0) return 'UTC';
  const sign = minutes > 0 ? '+' : '−';
  const abs = Math.abs(minutes);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `UTC${sign}${h}${m ? `:${String(m).padStart(2, '0')}` : ''}`;
}

/** The short name the runtime gives ("PDT", "GMT+8", "CST") at `nowMs`, or null. */
export function timeZoneAbbreviation(zone: string, nowMs: number, locale = 'en-US'): string | null {
  if (!isValidIanaTimeZone(zone)) return null;
  try {
    const part = new Intl.DateTimeFormat(locale, { timeZone: zone, timeZoneName: 'short' })
      .formatToParts(new Date(nowMs))
      .find((p) => p.type === 'timeZoneName');
    return part?.value ?? null;
  } catch {
    return null;
  }
}

/** The zone's city as a word: "America/Argentina/Buenos_Aires" → "Buenos Aires". */
export function timeZoneCity(zone: string): string {
  const last = zone.split('/').pop() ?? zone;
  return last.replace(/_/g, ' ');
}

/**
 * "America/Los_Angeles · PDT (UTC−7)". The id stays — it is what the operator
 * searches for and what the API stores — and the abbreviation + offset are
 * what tells a GUQ set to Shanghai apart at a glance.
 */
export function describeTimeZone(zone: string, nowMs: number, locale = 'en-US'): string {
  const abbr = timeZoneAbbreviation(zone, nowMs, locale);
  const offset = formatUtcOffset(zone, nowMs);
  const detail = [abbr && !/^GMT|^UTC/.test(abbr) ? abbr : null, offset ? `(${offset})` : null].filter(Boolean).join(' ');
  return detail ? `${zone} · ${detail}` : zone;
}

/** "3:42 PM" in `zone` right now — the proof the zone is the right one. */
export function localTimeIn(zone: string, nowMs: number, locale = 'en-US'): string | null {
  if (!isValidIanaTimeZone(zone)) return null;
  try {
    return new Intl.DateTimeFormat(locale, { timeZone: zone, hour: 'numeric', minute: '2-digit' }).format(new Date(nowMs));
  } catch {
    return null;
  }
}
