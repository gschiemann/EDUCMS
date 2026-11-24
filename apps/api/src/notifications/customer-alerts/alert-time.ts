/**
 * Alert times as the SCREEN's clock shows them (2026-11-23). Pure.
 *
 * The owner, after a live demo: "My alert email give me utc time but I want
 * local time of the screen". The record copy of a trigger / drill / all-clear
 * printed `2026-11-23 20:41 UTC` in every language, whatever the location or
 * the screen was set to. It now prints the moment in the zone the reached
 * screens' clocks show, with the zone always named:
 *
 *     en  Mon, Nov 23, 2026, 2:41 PM CST
 *     es  lun, 23 nov 2026, 14:41 hora estándar central
 *     zh  2026年11月23日周一 北美中部标准时间下午2:41
 *
 * Spanish and Chinese name the zone in full: their short ICU names are only
 * "GMT-6", which says the offset but not the place. The date is always
 * printed, because two zones can be on different days.
 *
 * WHICH ZONE (one answer, shared with the glass):
 *   - a screen: exactly its manifest `timeZone` (`manifestTimeZone` — screen
 *     override > location setting > automatic from the nearest saved
 *     coordinates). Where the glass would fall back to the device's own
 *     zone, the email uses the nearest location above it that has one;
 *   - a location: its setting, else the zone at its address, else the
 *     nearest organisation above it with one;
 *   - nothing resolves: UTC, and the label says so ("8:41 PM UTC").
 * `Screen.deviceTimeZone` is never used: Goodview panels ship set to
 * Asia/Shanghai, which would turn into a confidently wrong time.
 */
import { isValidIanaTimeZone } from '@cms/api-types';
import { manifestTimeZone } from '../../screens/screen-time-zone';
import type { AlertLocale } from './customer-alert-copy';

const LABEL_FORMAT: Record<AlertLocale, [string, Intl.DateTimeFormatOptions]> = {
  en: ['en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }],
  es: ['es', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'long' }],
  zh: ['zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short', hour: 'numeric', minute: '2-digit', hour12: true, timeZoneName: 'long' }],
};

/**
 * The moment `atMs` as a clock in `zone` shows it, date and zone included, in
 * the reader's language. An unknown, invalid or missing zone formats in UTC
 * (labelled UTC). Never throws. ICU versions differ on the space before
 * AM/PM (U+202F or U+00A0); both become a plain space so the text is the same
 * on every runtime.
 */
export function alertTimeLabel(locale: AlertLocale, atMs: number, zone?: string | null): string {
  if (!Number.isFinite(atMs)) return '—';
  const [lang, opts] = LABEL_FORMAT[locale] ?? LABEL_FORMAT.en;
  const timeZone = isValidIanaTimeZone(zone) ? zone : 'UTC';
  let text: string;
  try {
    text = new Intl.DateTimeFormat(lang, { ...opts, timeZone }).format(atMs);
  } catch {
    text = new Intl.DateTimeFormat(lang, { ...opts, timeZone: 'UTC' }).format(atMs);
  }
  return text.replace(/[\u202f\u00a0]/g, ' ');
}

/** The tenant columns a clock reads (`TenantMeta` carries them). */
export interface ClockTenant {
  parentId?: string | null;
  timezone?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}

/**
 * The zone a screen with no setting and no coordinates of its own shows at
 * this location: the location's setting, else the zone at its address; null
 * when neither resolves.
 */
export function locationClockZone(tenant: ClockTenant | null | undefined): string | null {
  return tenant ? manifestTimeZone({}, null, tenant) : null;
}

/**
 * A location's zone for an email: its own (setting > address), else the
 * nearest organisation above it with one (a school with nothing set is
 * almost always in its district's zone), else null = UTC, labelled.
 */
export function alertZoneForLocation(id: string | null | undefined, tenants: ReadonlyMap<string, ClockTenant>): string | null {
  const seen = new Set<string>();
  let cur: string | null | undefined = id;
  while (cur && !seen.has(cur) && seen.size < 10) {
    seen.add(cur);
    const t = tenants.get(cur);
    const zone = locationClockZone(t);
    if (zone) return zone;
    cur = t?.parentId;
  }
  return null;
}

/** The Screen columns a clock reads (the same ones the manifest's `timeZone` reads). */
export const SCREEN_CLOCK_SELECT = {
  id: true,
  tenantId: true,
  timezone: true,
  latitude: true,
  longitude: true,
  screenGroup: { select: { latitude: true, longitude: true } },
} as const;

export interface ScreenClockRow {
  id: string;
  tenantId: string | null;
  timezone?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  screenGroup?: { latitude?: number | null; longitude?: number | null } | null;
}

/**
 * The zone this screen's glass shows (identical to its manifest `timeZone`
 * whenever that is set); where the glass would use the device's own zone,
 * its location's zone, walking up.
 */
export function alertZoneForScreen(row: ScreenClockRow, tenants: ReadonlyMap<string, ClockTenant>): string | null {
  const own = row.tenantId ? tenants.get(row.tenantId) : undefined;
  return manifestTimeZone(row, row.screenGroup ?? null, own ?? null) ?? alertZoneForLocation(row.tenantId, tenants);
}
