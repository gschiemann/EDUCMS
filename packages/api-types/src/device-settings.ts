/**
 * Basic Android settings, without device owner — the shared contract between
 * the player APK, the API and the dashboard (2026-10-18).
 *
 * THE OWNER ASK: the app sets a unit's everyday Android settings itself on
 * the Android 13+ fleet, so an installer no longer walks the Settings menus
 * on every panel — and without device owner (owner decision 2026-10-17). The
 * inventory of what a sideloaded app can reach is
 * `docs/research/2026-10-17-player-rock-solid/05-android-settings-without-device-owner.md`.
 *
 * THE SHAPE:
 *   - an operator stores a DESIRED value per setting on the screen
 *     (`PUT /screens/:id/device-settings`, audited before/after);
 *   - the native heartbeat (`GET /screens/status/:fp`) carries the desired
 *     set down and the unit's report up in the `x-venueos-device-settings`
 *     header — what it CAN set right now and why not, what Android READS
 *     BACK, and what happened to each value's identity;
 *   - the dashboard renders a control only where the unit says it can, the
 *     observed value next to it, and "not possible on this unit: <reason>"
 *     everywhere else.
 *
 * The vocabularies below are the player's (`apps/player/.../settings/
 * DeviceSettingKey.kt`); `device-settings-drift.spec.ts` in apps/api parses
 * the Kotlin and fails when the two disagree.
 *
 * Pure: zod + plain functions, no I/O.
 */

import { z } from 'zod';

// ─────────────────────────────────────────────────────────────────────
// Vocabularies (mirrors DeviceSettingKey / DeviceSettingCodes in Kotlin)
// ─────────────────────────────────────────────────────────────────────

export const DEVICE_SETTINGS_HEADER = 'x-venueos-device-settings';
/** The unit never builds a longer header; the API refuses one. */
export const DEVICE_SETTINGS_MAX_HEADER_CHARS = 2048;

export const DEVICE_SETTING_KEYS = [
  'brightness',
  'volume',
  'screenOffTimeoutMs',
  'rotationLock',
  'autoTime',
  'autoTimeZone',
  'ntpServer',
  'wifi',
] as const;
export type DeviceSettingKey = (typeof DEVICE_SETTING_KEYS)[number];

/** `ok`, or why this unit cannot set the setting right now. */
export const DEVICE_SETTING_CAPABILITY_CODES = [
  'ok',
  'api-level',
  'no-write-settings',
  'no-secure-settings',
  'vendor-brightness',
  'picture-only',
  'volume-fixed',
  'no-wifi',
  'wifi-disallowed',
  'unsupported',
] as const;
export type DeviceSettingCapability = (typeof DEVICE_SETTING_CAPABILITY_CODES)[number];

export const DEVICE_SETTING_STATUSES = ['applied', 'failed', 'unsupported', 'waiting', 'pending'] as const;
export type DeviceSettingStatus = (typeof DEVICE_SETTING_STATUSES)[number];

/** Every `why` a unit may report next to a status. */
export const DEVICE_SETTING_WHY_CODES = [
  ...DEVICE_SETTING_CAPABILITY_CODES.filter((c) => c !== 'ok'),
  // waiting — no attempt spent
  'emergency',
  'screen-off',
  'blanked',
  'settling',
  // an attempt that did not land
  'not-taken',
  'write-refused',
  'invalid-value',
  'error',
  'needs-secret',
  'already-set',
  'unverified',
  'wifi-rejected',
  'wifi-limit',
  'wifi-invalid',
  'wifi-restricted',
  'wifi-error',
] as const;
export type DeviceSettingWhy = (typeof DEVICE_SETTING_WHY_CODES)[number];

export const DEVICE_WIFI_SECURITY = ['open', 'wpa2', 'wpa3'] as const;
export type DeviceWifiSecurity = (typeof DEVICE_WIFI_SECURITY)[number];
export const DEVICE_WIFI_APPROVAL = ['approved', 'pending', 'rejected', 'unknown'] as const;

// ─────────────────────────────────────────────────────────────────────
// Value rules — the SAME rules the unit applies on its own side
// ─────────────────────────────────────────────────────────────────────

/** Same floor as the display layer's MIN_SAFE_BRIGHTNESS: a remote 0% is a truck roll. */
export const DEVICE_SETTINGS_MIN_BRIGHTNESS = 5;
/** "Never", as Android signage ROMs store it. */
export const DEVICE_SETTINGS_TIMEOUT_NEVER = 2_147_483_647;
/**
 * The offered screen-off timeouts. None shorter than a minute: the timeout
 * only governs a panel the player is not holding on, and the screen-off
 * blank sets (and restores) its own 15 s value.
 */
export const DEVICE_SETTING_TIMEOUTS_MS = [
  60_000,
  300_000,
  600_000,
  1_800_000,
  3_600_000,
  DEVICE_SETTINGS_TIMEOUT_NEVER,
] as const;

const HOST_LABEL = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;
const IPV4 =
  /^(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

/** A host name or IPv4 address for Android's time-server override; `''` = Android's own. */
export function isValidNtpServer(value: string): boolean {
  if (value === '') return true;
  if (value.length > 253) return false;
  if (IPV4.test(value)) return true;
  const labels = value.split('.');
  if (/^\d+$/.test(labels[labels.length - 1])) return false;
  return labels.every((l) => HOST_LABEL.test(l));
}

/** 1–32 bytes of UTF-8, no control characters (IEEE 802.11). */
export function isValidSsid(ssid: string): boolean {
  const bytes = new TextEncoder().encode(ssid).length;
  // eslint-disable-next-line no-control-regex
  return bytes >= 1 && bytes <= 32 && !/[\u0000-\u001f\u007f]/.test(ssid);
}

/** WPA2/WPA3 personal: 8–63 printable ASCII. */
export function isValidWifiPassphrase(passphrase: string): boolean {
  return passphrase.length >= 8 && passphrase.length <= 63 && /^[\x20-\x7e]+$/.test(passphrase);
}

// ─────────────────────────────────────────────────────────────────────
// PUT /screens/:id/device-settings
// ─────────────────────────────────────────────────────────────────────

/**
 * A PARTIAL update. A key that is absent is left as it is; a key that is
 * `null` stops VenueOS managing that setting (the unit keeps its current
 * value — nothing is reverted). The Wi-Fi passphrase is write-only: it is
 * never returned, and it may be left out to keep the saved one for the same
 * network.
 */
export const DeviceWifiInputSchema = z
  .object({
    ssid: z.string().refine(isValidSsid, 'The network name must be 1–32 characters.'),
    security: z.enum(DEVICE_WIFI_SECURITY),
    hidden: z.boolean().optional(),
    passphrase: z
      .string()
      .refine(isValidWifiPassphrase, 'The Wi-Fi password must be 8–63 characters.')
      .optional(),
  })
  .strict()
  .refine((w) => w.security !== 'open' || w.passphrase === undefined, {
    message: 'An open network has no password.',
    path: ['passphrase'],
  });
export type DeviceWifiInput = z.infer<typeof DeviceWifiInputSchema>;

export const DeviceSettingsPatchSchema = z
  .object({
    brightness: z.number().int().min(DEVICE_SETTINGS_MIN_BRIGHTNESS).max(100).nullable().optional(),
    volume: z.number().int().min(0).max(100).nullable().optional(),
    screenOffTimeoutMs: z
      .number()
      .int()
      .refine((v) => (DEVICE_SETTING_TIMEOUTS_MS as readonly number[]).includes(v), 'Not an offered timeout.')
      .nullable()
      .optional(),
    rotationLock: z.boolean().nullable().optional(),
    autoTime: z.boolean().nullable().optional(),
    autoTimeZone: z.boolean().nullable().optional(),
    ntpServer: z
      .string()
      .trim()
      .toLowerCase()
      .refine(isValidNtpServer, 'Enter a host name such as time.google.com, or leave it empty.')
      .nullable()
      .optional(),
    wifi: DeviceWifiInputSchema.nullable().optional(),
  })
  .strict()
  .refine((p) => Object.keys(p).length > 0, { message: 'Nothing to change.' });
export type DeviceSettingsPatch = z.infer<typeof DeviceSettingsPatchSchema>;

// ─────────────────────────────────────────────────────────────────────
// The unit's report (the x-venueos-device-settings header)
// ─────────────────────────────────────────────────────────────────────

const itemId = z.string().regex(/^r\d{1,10}$/);
const wallMs = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
/**
 * A capability code a NEWER player knows and this API does not reads as
 * `unsupported` ("not possible on this unit") rather than costing the whole
 * report — the honest direction. Same for an unknown `why` (dropped). The
 * status vocabulary itself stays strict.
 */
const capability = z.enum(DEVICE_SETTING_CAPABILITY_CODES).catch('unsupported');

const ackSchema = z.object({
  id: itemId,
  st: z.enum(DEVICE_SETTING_STATUSES),
  n: z.number().int().min(0).max(99),
  why: z.enum(DEVICE_SETTING_WHY_CODES).optional().catch(undefined),
  at: wallMs.optional(),
});
export type DeviceSettingAck = z.infer<typeof ackSchema>;

/**
 * Heat and load, as FACTS (lead's addition, 2026-10-18) — numbers only,
 * every one bounded, nothing acted on. `thermal` is Android's
 * `PowerManager.THERMAL_STATUS_*` (0 none … 6 shutdown).
 */
export const DeviceLoadSchema = z.object({
  thermal: z.number().int().min(0).max(6).optional(),
  thermalAt: wallMs.optional(),
  headroom: z.number().min(0).max(10).optional(),
  cpu: z.number().int().min(0).max(100).optional(),
  sysCpu: z.number().int().min(0).max(100).optional(),
  memAvailMb: z.number().int().min(0).max(1_048_576).optional(),
  memTotalMb: z.number().int().min(0).max(1_048_576).optional(),
  memLow: z.boolean().optional(),
  socC: z.number().int().min(-40).max(150).optional(),
  zones: z.number().int().min(0).max(64).optional(),
});
export type DeviceLoad = z.infer<typeof DeviceLoadSchema>;

export const DeviceSettingsReportSchema = z.object({
  schema: z.literal(1),
  rev: z.number().int().min(0).max(2_147_483_647),
  need: z.boolean().optional(),
  sdk: z.number().int().min(1).max(99).optional(),
  cap: z
    .object({
      brightness: capability.optional(),
      volume: capability.optional(),
      screenOffTimeoutMs: capability.optional(),
      rotationLock: capability.optional(),
      autoTime: capability.optional(),
      autoTimeZone: capability.optional(),
      ntpServer: capability.optional(),
      wifi: capability.optional(),
    })
    .optional(),
  obs: z
    .object({
      brightness: z.number().int().min(0).max(100).optional(),
      volume: z.number().int().min(0).max(100).optional(),
      screenOffTimeoutMs: z.number().int().min(1).max(DEVICE_SETTINGS_TIMEOUT_NEVER).optional(),
      rotationLock: z.boolean().optional(),
      autoTime: z.boolean().optional(),
      autoTimeZone: z.boolean().optional(),
      ntpServer: z.string().max(253).optional(),
      wifi: z
        .object({
          ssid: z.string().max(64).nullable(),
          approval: z.enum(DEVICE_WIFI_APPROVAL),
        })
        .optional(),
    })
    .optional(),
  ack: z
    .object({
      brightness: ackSchema.optional(),
      volume: ackSchema.optional(),
      screenOffTimeoutMs: ackSchema.optional(),
      rotationLock: ackSchema.optional(),
      autoTime: ackSchema.optional(),
      autoTimeZone: ackSchema.optional(),
      ntpServer: ackSchema.optional(),
      wifi: ackSchema.optional(),
    })
    .optional(),
  load: DeviceLoadSchema.optional(),
});
export type DeviceSettingsReport = z.infer<typeof DeviceSettingsReportSchema>;

/** Parse the header value; null for anything absent, oversized or malformed. */
export function parseDeviceSettingsReport(value: unknown): DeviceSettingsReport | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > DEVICE_SETTINGS_MAX_HEADER_CHARS) {
    return null;
  }
  try {
    const result = DeviceSettingsReportSchema.safeParse(JSON.parse(value));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────
// What the dashboard reads (GET /screens/:id/device-settings)
// ─────────────────────────────────────────────────────────────────────

export type DeviceSettingDesiredValue =
  | number
  | boolean
  | string
  | { ssid: string; security: DeviceWifiSecurity; hidden: boolean; passphraseSaved: boolean };

export interface DeviceSettingDesired {
  value: DeviceSettingDesiredValue;
  /** The identity the unit acknowledges (`r<revision>`). */
  id: string;
  changedAt: string;
}

export interface DeviceSettingsView {
  screenId: string;
  /** A side of a double-sided unit: its Android settings are the primary side's. */
  faceOfScreenId: string | null;
  revision: number;
  desired: Partial<Record<DeviceSettingKey, DeviceSettingDesired>>;
  report: DeviceSettingsReport | null;
  /** When the unit's report last CHANGED. */
  reportChangedAt: string | null;
  /** The last heartbeat that carried a report (debounced) — "checked N ago". */
  reportedAt: string | null;
}

/** Where one setting stands, as the dashboard says it. */
export type DeviceSettingState =
  | { kind: 'unknown' }
  | { kind: 'not-possible'; why: DeviceSettingCapability }
  | { kind: 'not-managed' }
  | { kind: 'sending' }
  | { kind: 'applied'; why?: DeviceSettingWhy }
  | { kind: 'waiting'; why?: DeviceSettingWhy }
  | { kind: 'failed'; why?: DeviceSettingWhy }
  | { kind: 'not-possible-now'; why?: DeviceSettingWhy };

/**
 * One rule for "where does this setting stand", shared by the API and the
 * dashboard so they can never disagree:
 *   - no report at all → unknown (never "not possible");
 *   - nothing stored → not managed, or not possible with the unit's reason;
 *   - stored, and the unit's acknowledgement is for an OLDER identity → the
 *     unit has not picked this value up yet (`sending`);
 *   - otherwise the unit's own status, with its reason.
 * Acknowledgement is by identity EQUALITY — never by time.
 */
export function deviceSettingState(
  key: DeviceSettingKey,
  desired: DeviceSettingDesired | undefined,
  report: DeviceSettingsReport | null,
): DeviceSettingState {
  if (!report) return desired ? { kind: 'sending' } : { kind: 'unknown' };
  const cap = report.cap?.[key];
  if (!desired) {
    if (cap && cap !== 'ok') return { kind: 'not-possible', why: cap };
    return { kind: 'not-managed' };
  }
  const ack = report.ack?.[key];
  if (!ack || ack.id !== desired.id) return { kind: 'sending' };
  switch (ack.st) {
    case 'applied':
      return { kind: 'applied', why: ack.why };
    case 'failed':
      return { kind: 'failed', why: ack.why };
    case 'unsupported':
      return { kind: 'not-possible-now', why: ack.why };
    case 'waiting':
    case 'pending':
      return { kind: 'waiting', why: ack.why };
  }
}

/** Android's thermal status names, for display (0 none … 6 shutdown). */
export const DEVICE_THERMAL_LEVELS = [
  'none',
  'light',
  'moderate',
  'severe',
  'critical',
  'emergency',
  'shutdown',
] as const;
