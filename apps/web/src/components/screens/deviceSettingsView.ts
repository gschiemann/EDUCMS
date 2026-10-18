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
  | { kind: 'ready'; rows: DeviceSettingRow[]; load: DeviceLoad | null };

export function buildSection(view: DeviceSettingsView): SectionModel {
  const report = view.report;
  if (!report) return { kind: 'not-reported', desired: view.desired };
  const caps = DEVICE_SETTING_KEYS.map((k) => report.cap?.[k]);
  if (caps.length > 0 && caps.every((c) => c === 'api-level')) {
    return { kind: 'old-android', sdk: report.sdk ?? null };
  }
  const rows = DEVICE_SETTING_KEYS.map((key): DeviceSettingRow => {
    const desired = view.desired[key];
    const state = deviceSettingState(key, desired, report);
    return {
      key,
      state,
      editable: state.kind !== 'not-possible' && state.kind !== 'unknown',
      desired,
      observed: report.obs?.[key],
    };
  });
  return { kind: 'ready', rows, load: report.load ?? null };
}

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
