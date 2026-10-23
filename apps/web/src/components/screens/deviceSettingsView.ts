/**
 * The pure half of the "Android settings" section (2026-10-18): which rows
 * exist, which offer a control, and what each one says — derived from the
 * API's view with the ONE state rule shared with the server
 * (`deviceSettingState` in `@cms/api-types`). No React here; tested in
 * `__tests__/deviceSettingsView.test.ts`.
 *
 * HONESTY RULES (the same ones ScreenDisplayControls lives by):
 *  1. No report from the unit → no controls. "Not reported" is never
 *     rendered as "not possible".
 *  2. A setting the unit cannot set, with nothing stored, shows the unit's
 *     reason and NO control — a greyed control reads as "this exists and my
 *     permissions are wrong".
 *  3. A stored value shows its control even when the unit can no longer set
 *     it, so it can be cleared.
 *  4. What the row shows as current is what ANDROID READ BACK, labelled as
 *     such — never the value that was sent.
 */

import {
  DEVICE_SETTING_KEYS,
  DEVICE_SETTINGS_ATTENTIVE_NEVER,
  DEVICE_SETTINGS_TIMEOUT_NEVER,
  DEVICE_THERMAL_LEVELS,
  deviceSettingState,
  type DeviceLoad,
  type DeviceNetStatus,
  type DeviceSettingDesired,
  type DeviceSettingKey,
  type DeviceSettingState,
  type DeviceSettingsReport,
  type DeviceSettingsView,
} from '@cms/api-types';

export const BRIGHTNESS_OPTIONS = [100, 90, 80, 70, 60, 50, 40, 30, 20, 10, 5] as const;
export const VOLUME_OPTIONS = [100, 90, 80, 70, 60, 50, 40, 30, 20, 10, 0] as const;
/** Longest first: "Never" is what a signage screen almost always wants. */
export const TIMEOUT_OPTIONS = [DEVICE_SETTINGS_TIMEOUT_NEVER, 3_600_000, 1_800_000, 600_000, 300_000, 60_000] as const;
/** Android TV's inactivity sleep: Never first — what a signage screen wants. */
export const ATTENTIVE_OPTIONS = [DEVICE_SETTINGS_ATTENTIVE_NEVER, 86_400_000, 43_200_000, 28_800_000, 14_400_000] as const;

export interface DeviceSettingRow {
  key: DeviceSettingKey;
  state: DeviceSettingState;
  /** Render a control (select / input) for this row. */
  editable: boolean;
  desired: DeviceSettingDesired | undefined;
  /** What Android read back (report.obs[key]); undefined = not reported. */
  observed: unknown;
}

export type SectionModel =
  | { kind: 'not-reported'; desired: DeviceSettingsView['desired'] }
  | { kind: 'old-android'; sdk: number | null }
  | {
      kind: 'ready';
      rows: DeviceSettingRow[];
      load: DeviceLoad | null;
      /**
       * Wi-Fi works below Android 13 (2026-10-23) but the other settings do
       * not: their identical "needs Android 13" rows collapse into this one
       * note instead of eight rows saying the same thing.
       */
      olderAndroidSdk: number | null;
      /** How Wi-Fi works on this unit, worded before Save (null = the unit does not say). */
      wifiPlan: WifiPlan | null;
      /** The connection right now, as the unit reports it. */
      net: DeviceNetStatus | null;
    };

export function buildSection(view: DeviceSettingsView): SectionModel {
  const report = view.report;
  if (!report) return { kind: 'not-reported', desired: view.desired };
  const caps = DEVICE_SETTING_KEYS.map((k) => report.cap?.[k]);
  if (caps.length > 0 && caps.every((c) => c === 'api-level')) {
    return { kind: 'old-android', sdk: report.sdk ?? null };
  }
  // An older Android with Wi-Fi: everything else is "needs Android 13".
  const olderAndroid = DEVICE_SETTING_KEYS.filter((k) => k !== 'wifi').every((k) => report.cap?.[k] === 'api-level');
  const rows = DEVICE_SETTING_KEYS.flatMap((key): DeviceSettingRow[] => {
    const desired = view.desired[key];
    // Collapsed into the note — unless something is stored, which keeps its row so it can be cleared.
    if (olderAndroid && key !== 'wifi' && !desired) return [];
    const state = deviceSettingState(key, desired, report);
    return [
      {
        key,
        state,
        editable: state.kind !== 'not-possible' && state.kind !== 'unknown',
        desired,
        observed: report.obs?.[key],
      },
    ];
  });
  return {
    kind: 'ready',
    rows,
    load: report.load ?? null,
    olderAndroidSdk: olderAndroid ? (report.sdk ?? null) : null,
    wifiPlan: wifiPlan(report),
    net: report.net ?? null,
  };
}

/**
 * WHAT WILL HAPPEN when the operator presses Save on the Wi-Fi row — said
 * per screen BEFORE they press it (2026-10-23), from the facts the unit
 * reports. Pure; the words live in the i18n catalogue (`wifi.plan.*`).
 *
 *  • `silent`          Android 9 and older: joined with no one touching the screen.
 *  • `allowed`         Android 10+, VenueOS's networks already allowed: joins when in range.
 *  • `approval`        Android 12+, not allowed yet: one tap on the screen the first time.
 *  • `approval-unknown` Android 10–11: Android asks once and never says whether it was allowed.
 *  • `dialog-fallback` declined suggestions, but Android's save dialog opens: one person, once.
 *  • `unavailable`     no Wi-Fi, or declined with no dialog.
 */
export type WifiPlanKind = 'silent' | 'allowed' | 'approval' | 'approval-unknown' | 'dialog-fallback' | 'unavailable';

export interface WifiPlan {
  kind: WifiPlanKind;
  /** "Save it on the screen permanently" can be offered (Android's dialog opens here). */
  dialog: boolean;
  /** WPA3 can be offered. */
  wpa3: boolean;
  /** The Wi-Fi radio is off (Android 9 and older wait for it; nothing turns it on). */
  radioOff: boolean;
}

export function wifiPlan(report: DeviceSettingsReport | null): WifiPlan | null {
  const facts = report?.wifi;
  if (!report || !facts || !facts.via) return null;
  const cap = report.cap?.wifi;
  const approval = report.obs?.wifi?.approval;
  const dialog = facts.dialog === true;
  const base = { dialog, wpa3: facts.wpa3 !== false, radioOff: facts.radio === false };
  if (cap === 'no-wifi' || cap === 'unsupported') return { ...base, kind: 'unavailable', dialog: false };
  if (facts.via === 'legacy') return { ...base, kind: 'silent', dialog: false };
  if (approval === 'rejected') return { ...base, kind: dialog ? 'dialog-fallback' : 'unavailable' };
  if (approval === 'approved') return { ...base, kind: 'allowed' };
  if ((report.sdk ?? 0) >= 31) return { ...base, kind: 'approval' };
  return { ...base, kind: 'approval-unknown' };
}

/** Wi-Fi reasons a "Save" fixes — the screen never retries them by itself. */
export const WIFI_RETRY_WHYS: ReadonlySet<string> = new Set([
  'wifi-unreachable',
  'wifi-no-connect',
  'wifi-declined',
  'wifi-no-answer',
  'wifi-error',
  'not-taken',
  'error',
]);

/** The value a select shows: the stored one, or '' for "not managed". */
export function selectValue(row: DeviceSettingRow): string {
  const v = row.desired?.value;
  if (v === undefined) return '';
  if (typeof v === 'object') return '';
  return String(v);
}

/** The PUT body for a select change ('' = stop managing). */
export function patchFor(key: DeviceSettingKey, raw: string): Record<string, unknown> {
  if (raw === '') return { [key]: null };
  switch (key) {
    case 'brightness':
    case 'volume':
    case 'screenOffTimeoutMs':
    case 'attentiveTimeoutMs':
      return { [key]: Number(raw) };
    case 'rotationLock':
    case 'autoTime':
    case 'autoTimeZone':
      return { [key]: raw === 'true' };
    default:
      return { [key]: raw };
  }
}

/** A timeout as the unit it reads best in. ≤ 0 (the inactivity sleep's "off") and Int max both read Never. */
export function timeoutParts(ms: number): { never: true } | { unit: 'hours' | 'minutes'; n: number } {
  if (ms <= 0 || ms >= DEVICE_SETTINGS_TIMEOUT_NEVER) return { never: true };
  if (ms >= 3_600_000 && ms % 3_600_000 === 0) return { unit: 'hours', n: ms / 3_600_000 };
  return { unit: 'minutes', n: Math.max(1, Math.round(ms / 60_000)) };
}

/** Android's thermal status as a level name (0 none … 6 shutdown). */
export function thermalLevel(status: number | undefined): (typeof DEVICE_THERMAL_LEVELS)[number] | null {
  if (status === undefined || status < 0 || status >= DEVICE_THERMAL_LEVELS.length) return null;
  return DEVICE_THERMAL_LEVELS[status];
}

/** Megabytes as "812 MB" / "2.0 GB". */
export function formatMemory(mb: number, locale: string): string {
  if (mb >= 1024) {
    return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1, minimumFractionDigits: 1 }).format(mb / 1024)} GB`;
  }
  return `${new Intl.NumberFormat(locale).format(mb)} MB`;
}

/** Did the unit report anything at all about heat and load? */
export function hasLoadFacts(load: DeviceLoad | null): load is DeviceLoad {
  return !!load && Object.keys(load).length > 0;
}

export type { DeviceSettingsReport };
