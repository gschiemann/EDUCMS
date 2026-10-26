/**
 * The effective time zone of ONE screen — the API half (2026-10-24).
 *
 * Owner (Greg, 2026-10-24): Goodview GUQ panels ship set to Asia/Shanghai, and
 * every clock and date on those screens read Shanghai time. Android lets no
 * normal app change the system zone, so the zone is decided HERE, once per
 * screen, and the player applies it above the device:
 *
 *   screen override > location setting > automatic from the address > device
 *
 * The precedence and the IANA validation are shared with the dashboard in
 * `@cms/api-types/time-zone.ts`. What this file adds is the AUTOMATIC step —
 * an OFFLINE coordinate → IANA lookup over the coordinates the fleet map
 * already keeps (screen > group > location), so a location with an address
 * needs no setting at all, no network call, and nothing persisted that could
 * go stale when an address changes.
 *
 * THE LOOKUP: `@photostructure/tz-lookup` 11.x — 88 KB, zero dependencies,
 * CC0, updated with each tzdata release (11.7.0 is 2026-09), pure JS, a few
 * microseconds per call. Chosen over `geo-tz` (74 MB of polygon data plus
 * four dependencies, built for sub-kilometre accuracy a building address
 * never needs) and over the original `tz-lookup` (unmaintained since 2022).
 * Its grid is ~4 km; an address right on a zone border can land on the
 * other side, which is exactly what the dashboard override is for.
 *
 * WHAT COUNTS AS UNRESOLVED (the player then uses the device's own zone, as
 * before): no coordinates anywhere; coordinates outside the world (the
 * library throws); an answer the runtime cannot format in; and the ocean /
 * generic answers (`Etc/GMT±N`, `UTC`) — a screen never hangs at sea, and a
 * sea square must never pin a fleet to a fixed offset.
 *
 * STATIC BY CONSTRUCTION: every input is a stored column. The manifest field
 * built from this (`timeZone`) therefore moves only when a column moves, and
 * the manifest content cache busts on exactly those writes (Screen,
 * ScreenGroup and Tenant are all manifest-fed models).
 */

import tzLookup from '@photostructure/tz-lookup';
import {
  isOceanOrGenericZone,
  isValidIanaTimeZone,
  resolveEffectiveTimeZone,
  type EffectiveTimeZone,
  type TimeZoneAutoFrom,
} from '@cms/api-types';

export interface GeoPoint {
  latitude?: number | null;
  longitude?: number | null;
}

const lookupCache = new Map<string, string | null>();
const LOOKUP_CACHE_MAX = 4_096;

function finiteCoordinate(value: unknown): number | null {
  const n =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim()
        ? Number(value)
        : NaN;
  return Number.isFinite(n) ? n : null;
}

/**
 * The IANA zone at (lat, lng), or null when nothing honest can be said.
 * Never throws. Cached per rounded coordinate pair (the fleet list asks for
 * the same building hundreds of times a minute).
 */
export function lookupTimeZoneForCoordinates(
  latitude: unknown,
  longitude: unknown,
): string | null {
  const lat = finiteCoordinate(latitude);
  const lng = finiteCoordinate(longitude);
  if (lat === null || lng === null) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  // ~100 m buckets: more than fine for a building, small enough to cache.
  const key = `${lat.toFixed(3)},${lng.toFixed(3)}`;
  const cached = lookupCache.get(key);
  if (cached !== undefined) return cached;
  let zone: string | null = null;
  try {
    const answer = tzLookup(lat, lng);
    zone =
      typeof answer === 'string' &&
      answer &&
      !isOceanOrGenericZone(answer) &&
      isValidIanaTimeZone(answer)
        ? answer
        : null;
  } catch {
    zone = null;
  }
  if (lookupCache.size >= LOOKUP_CACHE_MAX) {
    const oldest = lookupCache.keys().next().value;
    if (oldest !== undefined) lookupCache.delete(oldest);
  }
  lookupCache.set(key, zone);
  return zone;
}

export interface AutoTimeZoneInput {
  screen?: GeoPoint | null;
  group?: GeoPoint | null;
  location?: GeoPoint | null;
}

/**
 * The automatic zone from the nearest saved coordinates — the same
 * precedence the fleet map uses for a screen's pin (screen > group >
 * location). A level with no usable coordinates is skipped, not treated as
 * "no zone": a screen with no pin of its own still gets its building's zone.
 */
export function autoTimeZoneFor(
  input: AutoTimeZoneInput,
): { zone: string; from: TimeZoneAutoFrom } | null {
  const levels: Array<[TimeZoneAutoFrom, GeoPoint | null | undefined]> = [
    ['screen', input.screen],
    ['group', input.group],
    ['location', input.location],
  ];
  for (const [from, point] of levels) {
    if (!point) continue;
    const zone = lookupTimeZoneForCoordinates(point.latitude, point.longitude);
    if (zone) return { zone, from };
  }
  return null;
}

export interface ScreenTimeZoneInput extends AutoTimeZoneInput {
  /** `Screen.timezone` */
  screenOverride?: string | null;
  /** `Tenant.timezone` of the screen's own location */
  locationSetting?: string | null;
}

/** One answer for the manifest, the fleet list and the screen drawer. */
export function resolveScreenTimeZone(
  input: ScreenTimeZoneInput,
): EffectiveTimeZone {
  return resolveEffectiveTimeZone({
    screenOverride: input.screenOverride ?? null,
    locationSetting: input.locationSetting ?? null,
    auto: autoTimeZoneFor(input),
  });
}

/**
 * The fields the dashboard list routes attach to every screen row. Named
 * so the `/screens` list, the fleet route and the drawer cannot drift apart.
 */
export interface ScreenTimeZoneFields {
  /** The zone this screen uses, or null = the device's own. */
  timeZone: string | null;
  timeZoneSource: EffectiveTimeZone['source'];
  /** The automatic answer for this screen (shown as "Automatic (X)"), or null when no coordinates resolve. */
  timeZoneAuto: string | null;
  timeZoneAutoFrom: TimeZoneAutoFrom | null;
}

export function screenTimeZoneFields(
  input: ScreenTimeZoneInput,
): ScreenTimeZoneFields {
  const r = resolveScreenTimeZone(input);
  return {
    timeZone: r.zone,
    timeZoneSource: r.source,
    timeZoneAuto: r.auto?.zone ?? null,
    timeZoneAutoFrom: r.auto?.from ?? null,
  };
}

/**
 * The manifest's `timeZone` — the same resolver over the three rows the
 * manifest preamble already holds (the Screen row, its ScreenGroup row and
 * the Tenant projection, which carries `timezone` + coordinates since this
 * feature). `null` tells the player "no zone from the server — use the
 * device's"; an ABSENT key (an older API, an emergency manifest) tells it
 * "keep what you had".
 */
export function manifestTimeZone(
  screen: { timezone?: unknown; latitude?: unknown; longitude?: unknown },
  screenGroup: { latitude?: unknown; longitude?: unknown } | null | undefined,
  tenant:
    | { timezone?: unknown; latitude?: unknown; longitude?: unknown }
    | null
    | undefined,
): string | null {
  return resolveScreenTimeZone({
    screenOverride:
      typeof screen.timezone === 'string' ? screen.timezone : null,
    locationSetting:
      typeof tenant?.timezone === 'string' ? tenant.timezone : null,
    screen: {
      latitude: screen.latitude as number | null,
      longitude: screen.longitude as number | null,
    },
    group: screenGroup
      ? {
          latitude: screenGroup.latitude as number | null,
          longitude: screenGroup.longitude as number | null,
        }
      : null,
    location: tenant
      ? {
          latitude: tenant.latitude as number | null,
          longitude: tenant.longitude as number | null,
        }
      : null,
  }).zone;
}

/** Test seam: forget cached lookups. */
export function resetTimeZoneLookupCacheForTests(): void {
  lookupCache.clear();
}
