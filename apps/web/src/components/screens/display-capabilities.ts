/**
 * display-capabilities.ts — the CAPABILITY-TRUTH resolver for the
 * per-screen display-control panel.
 *
 * WHY THIS FILE EXISTS
 *
 * The player runs a read-only probe (DisplayCapabilityProbe.kt) at boot and
 * POSTs its `verdict` to /screens/:id/display-capabilities. That verdict is
 * the ONLY thing that may decide which controls the dashboard renders.
 *
 * The standing rule this enforces (CLAUDE.md §20 "Coming soon wearing a
 * real-button costume", plus the APK-push precedent in screens/page.tsx
 * lines ~1041-1095): we do not render a control the hardware cannot
 * perform, and we do not imply a control does more than it does. A box
 * whose brightness verdict is `software-dim` gets a slider that says, in
 * plain language, that it dims the IMAGE and not the backlight — because
 * that is the literal truth of SoftwareDimProvider (window brightness +
 * a black overlay; the LCD backlight keeps drawing full power).
 *
 * TRI-STATE DISCIPLINE (also copied from the APK-push row): "not reported
 * yet" is NOT "unsupported". A screen that has never sent a verdict gets an
 * explainer, never a guess.
 *
 * Pure module: no React, no i18n runtime, no network — it returns message
 * KEYS and the caller translates. Keeps it unit-testable and keeps the
 * honesty logic in one auditable place.
 */

import { MIN_SAFE_BRIGHTNESS_PERCENT } from '@cms/api-types';

/**
 * BINDING CROSS-DOMAIN CONTRACTS (lead, 2026-08-13 remediation wave) — the
 * three that this module is the web-side owner of:
 *
 *  C2. `daysOfWeek` is `Int[]`, 0 = Sunday … 6 = Saturday, exactly like the
 *      existing `Schedule` / `PlaylistItem` convention in schema.prisma. The
 *      Prisma model is authoritative. This file used to emit a comma-joined
 *      label string ('Mon,Tue,…') and collapse "all"/"none" to null, which
 *      the API's `z.array(z.number().int().min(0).max(6)).min(1)` rejected —
 *      no day selection this UI could produce was acceptable, so NO on/off
 *      schedule could ever be saved, and reading one back threw a TypeError
 *      mid-render (`number[].replace is not a function`).
 *
 *  C3. BLANK and WAKE are ALWAYS AVAILABLE on every device. The player's
 *      software floor (window brightness + a black overlay) cannot fail, so
 *      the probe verdict names the MECHANISM, not the availability. That is
 *      why `screenBlank: 'none'` — and even a screen that has never reported
 *      at all — still gets a Blank/Wake pair, with copy that says which of
 *      the two it is.
 *
 *  C4. Fail-OPEN for recovery, fail-CLOSED for risk. WAKE is the one control
 *      that can only ever make a dark screen visible, so it is never gated
 *      on a verdict. REBOOT stays gated (and, since the no-device-owner
 *      product decision, resolves to unavailable on the entire real fleet).
 */

/** Probe verdict axes — mirrors DisplayCapabilityProbe.kt's `verdict` block. */
export type VolumeVerdict = 'audiomanager' | 'none';
export type BrightnessVerdict = 'sysfs' | 'settings' | 'software-dim';
export type ScreenBlankVerdict = 'device-owner' | 'device-admin' | 'none';
export type RebootVerdict = 'device-owner' | 'none';
export type HardPowerOffVerdict = 'serial-candidate' | 'none';
export type DeviceOwnerPath =
  | 'held'
  | 'blocked-other-owner'
  | 'provisionable-after-factory-reset';

export interface DisplayCapabilityVerdict {
  volume?: VolumeVerdict;
  brightness?: BrightnessVerdict;
  screenBlank?: ScreenBlankVerdict;
  reboot?: RebootVerdict;
  hardPowerOff?: HardPowerOffVerdict;
  deviceOwnerPath?: DeviceOwnerPath;
}

/**
 * Remote-brightness floor. A remote 0% on a wall-mounted screen we cannot
 * physically reach is a truck roll — the player clamps to this and so does
 * the dashboard, so the operator never even has the option. (The player's
 * `allowBlack` escape hatch is deliberately NOT exposed here; blanking is a
 * separate, auto-reverting action.)
 *
 * Re-exported from the shared contract rather than redeclared — the floor
 * existing as two independent `5`s is how the API and the dashboard drift
 * apart without either side's tests noticing.
 */
export const MIN_SAFE_BRIGHTNESS = MIN_SAFE_BRIGHTNESS_PERCENT;

/**
 * Dead-man revert the dashboard attaches to BLANK. Per the architecture,
 * operator-initiated actions carry a revert; scheduled ones never do. A
 * permanent nightly off belongs in the schedule editor, not in a button
 * that could strand a screen dark if the operator walks away.
 */
export const BLANK_AUTO_WAKE_MS = 10 * 60_000;

const VOLUME_VALUES: readonly string[] = ['audiomanager', 'none'];
const BRIGHTNESS_VALUES: readonly string[] = ['sysfs', 'settings', 'software-dim'];
const BLANK_VALUES: readonly string[] = ['device-owner', 'device-admin', 'none'];
const REBOOT_VALUES: readonly string[] = ['device-owner', 'none'];
const HARD_POWER_VALUES: readonly string[] = ['serial-candidate', 'none'];
const OWNER_PATH_VALUES: readonly string[] = [
  'held',
  'blocked-other-owner',
  'provisionable-after-factory-reset',
];

function pick<T extends string>(raw: unknown, allowed: readonly string[]): T | undefined {
  return typeof raw === 'string' && allowed.includes(raw) ? (raw as T) : undefined;
}

/**
 * Parse whatever is sitting in `Screen.displayCapabilities` (a Prisma Json
 * column — could be anything) into a verdict we trust. Unknown/garbage
 * values for an axis become `undefined`, which the resolver treats as
 * "not reported" rather than "unsupported". Returns null when there is no
 * usable verdict at all.
 */
export function parseDisplayCapabilities(raw: unknown): DisplayCapabilityVerdict | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  // Tolerate both a bare verdict object and a `{ verdict: {...} }` envelope —
  // the probe emits a richer document and the API may store either.
  const v =
    o.verdict && typeof o.verdict === 'object' && !Array.isArray(o.verdict)
      ? (o.verdict as Record<string, unknown>)
      : o;

  const out: DisplayCapabilityVerdict = {
    volume: pick<VolumeVerdict>(v.volume, VOLUME_VALUES),
    brightness: pick<BrightnessVerdict>(v.brightness, BRIGHTNESS_VALUES),
    screenBlank: pick<ScreenBlankVerdict>(v.screenBlank, BLANK_VALUES),
    reboot: pick<RebootVerdict>(v.reboot, REBOOT_VALUES),
    hardPowerOff: pick<HardPowerOffVerdict>(v.hardPowerOff, HARD_POWER_VALUES),
    deviceOwnerPath: pick<DeviceOwnerPath>(v.deviceOwnerPath, OWNER_PATH_VALUES),
  };

  const anything =
    out.volume || out.brightness || out.screenBlank || out.reboot || out.hardPowerOff;
  return anything ? out : null;
}

export interface ControlAxis {
  /** Render an actual control? False = render the note as muted text only. */
  available: boolean;
  /** The action works, but only by dimming/covering the image — say so. */
  softwareOnly: boolean;
  /** i18n key for the plain-language truth about this axis. */
  noteKey: string | null;
}

export interface ResolvedDisplayControls {
  /** The screen has sent a probe verdict. False → explainer only, no controls. */
  reported: boolean;
  verdict: DisplayCapabilityVerdict | null;
  volume: ControlAxis;
  brightness: ControlAxis & { kind: BrightnessVerdict | null };
  blank: ControlAxis;
  reboot: ControlAxis;
}

const NOT_REPORTED: ControlAxis = { available: false, softwareOnly: false, noteKey: null };

/**
 * CONTRACT C3 — Blank/Wake are ALWAYS available, on every verdict and on no
 * verdict at all. The software floor (window brightness + black overlay) is
 * unconditional in the player, so the only thing the verdict decides here is
 * WHICH TRUTH we print, never whether the pair renders.
 *
 * Two honesty subtleties baked in:
 *  - `device-admin` no longer claims "truly turns the screen off". The probe
 *    sets that verdict when ANY app on the box is an active device admin
 *    (`dpm.activeAdmins`), which on a district image is routinely a
 *    third-party MDM and not us — `lockNow()` then throws SecurityException
 *    and the player silently falls through to the software floor. So the
 *    device-admin copy says "should", and only `device-owner` keeps the
 *    absolute wording.
 *  - "never reported" gets the software-floor copy rather than silence,
 *    because per C4 the WAKE half of this pair is the fleet's only remote
 *    recovery from a dark screen and must never be gated on a probe.
 */
export function resolveBlankAxis(mech: ScreenBlankVerdict | undefined): ControlAxis {
  if (mech === 'device-owner') {
    return { available: true, softwareOnly: false, noteKey: 'screens.display.note.blankHardware' };
  }
  if (mech === 'device-admin') {
    return {
      available: true,
      softwareOnly: false,
      noteKey: 'screens.display.note.blankDeviceAdmin',
    };
  }
  if (mech === 'none') {
    return { available: true, softwareOnly: true, noteKey: 'screens.display.note.blankSoftware' };
  }
  return { available: true, softwareOnly: true, noteKey: 'screens.display.note.blankUnknown' };
}

/**
 * Verdict → what the UI is allowed to render.
 *
 * The subtlety worth reading twice: the verdict describes the HARDWARE path
 * the probe found. The player still has an always-available software floor
 * (SoftwareDimProvider) for BRIGHTNESS and BLANK, so those two axes stay
 * actionable even on a `software-dim` / `none` box — they just get honest
 * copy about what actually happens. VOLUME and REBOOT have no floor: if the
 * probe says `none`, the control is not rendered at all.
 */
export function resolveDisplayControls(raw: unknown): ResolvedDisplayControls {
  const verdict = parseDisplayCapabilities(raw);
  if (!verdict) {
    return {
      reported: false,
      verdict: null,
      volume: NOT_REPORTED,
      brightness: { ...NOT_REPORTED, kind: null },
      // C3/C4: the blank/wake pair survives "never reported". Everything
      // else stays honestly blank — but the ONE control that can rescue a
      // dark screen is not something we withhold pending a probe.
      blank: resolveBlankAxis(undefined),
      reboot: NOT_REPORTED,
    };
  }

  const volume: ControlAxis =
    verdict.volume === 'audiomanager'
      ? { available: true, softwareOnly: false, noteKey: 'screens.display.note.volumeOk' }
      : verdict.volume === 'none'
        ? { available: false, softwareOnly: false, noteKey: 'screens.display.note.volumeNone' }
        : NOT_REPORTED;

  const brightness: ControlAxis & { kind: BrightnessVerdict | null } =
    verdict.brightness === 'sysfs'
      ? {
          available: true,
          softwareOnly: false,
          kind: 'sysfs',
          noteKey: 'screens.display.note.brightnessSysfs',
        }
      : verdict.brightness === 'settings'
        ? {
            available: true,
            softwareOnly: false,
            kind: 'settings',
            noteKey: 'screens.display.note.brightnessSettings',
          }
        : verdict.brightness === 'software-dim'
          ? {
              available: true,
              softwareOnly: true,
              kind: 'software-dim',
              noteKey: 'screens.display.note.brightnessSoftware',
            }
          : { ...NOT_REPORTED, kind: null };

  const blank: ControlAxis = resolveBlankAxis(verdict.screenBlank);

  const reboot: ControlAxis =
    verdict.reboot === 'device-owner'
      ? { available: true, softwareOnly: false, noteKey: 'screens.display.note.rebootOk' }
      : verdict.reboot === 'none'
        ? {
            available: false,
            softwareOnly: false,
            noteKey:
              verdict.deviceOwnerPath === 'blocked-other-owner'
                ? 'screens.display.note.rebootBlockedOtherOwner'
                : verdict.deviceOwnerPath === 'provisionable-after-factory-reset'
                  ? 'screens.display.note.rebootNeedsProvisioning'
                  : 'screens.display.note.rebootUnavailable',
          }
        : NOT_REPORTED;

  return { reported: true, verdict, volume, brightness, blank, reboot };
}

/** Clamp a remote brightness request to the safe floor. */
export function clampBrightness(percent: number): number {
  if (!Number.isFinite(percent)) return MIN_SAFE_BRIGHTNESS;
  return Math.min(100, Math.max(MIN_SAFE_BRIGHTNESS, Math.round(percent)));
}

/** Clamp a remote volume request to 0..100. */
export function clampVolume(percent: number): number {
  if (!Number.isFinite(percent)) return 0;
  return Math.min(100, Math.max(0, Math.round(percent)));
}

// ─── Schedule helpers (shared by the modal + the summary chips) ──────────

/**
 * CONTRACT C2. `DisplaySchedule.daysOfWeek` is `Int[]` with **0 = Sunday …
 * 6 = Saturday** — the encoding `Schedule` and `PlaylistItem` already use in
 * schema.prisma, and the one `DisplayScheduleCreateSchema` validates. The
 * chips read Mon→Sun because that is how an operator reads a week; the wire
 * value is always the integer.
 *
 * There is deliberately NO "empty means every day" collapse any more. It
 * inverted the operator's intent — tapping all seven chips off (i.e. "never
 * auto-power-off") used to serialize to null and read back as "every day",
 * scheduling the exact nightly blank they had just switched off. Zero days
 * is now simply invalid and Save is disabled, which is also what the API's
 * `.min(1)` says.
 */
export interface DisplayDay {
  /** Wire value. 0 = Sunday … 6 = Saturday. */
  index: number;
  /** Chip label / summary label. */
  label: string;
}

export const DISPLAY_SCHEDULE_DAYS: readonly DisplayDay[] = [
  { index: 1, label: 'Mon' },
  { index: 2, label: 'Tue' },
  { index: 3, label: 'Wed' },
  { index: 4, label: 'Thu' },
  { index: 5, label: 'Fri' },
  { index: 6, label: 'Sat' },
  { index: 0, label: 'Sun' },
];

/** Mon–Fri, in wire encoding. The "School day" preset. */
export const WEEKDAY_INDEXES: readonly number[] = [1, 2, 3, 4, 5];
/** All seven, in the canonical Sun→Sat order the API/DB stores. */
export const ALL_DAY_INDEXES: readonly number[] = [0, 1, 2, 3, 4, 5, 6];

function isDayIndex(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 6;
}

/**
 * Read whatever the API handed back into a clean, deduped, canonically
 * sorted `number[]`. Tolerates a legacy comma-joined label string so a row
 * written by the pre-fix build (or a hand-seeded fixture) renders instead of
 * throwing during list.map — see the P1 this replaces.
 */
export function parseDays(raw: unknown): number[] {
  if (Array.isArray(raw)) {
    return [...new Set(raw.filter(isDayIndex))].sort((a, b) => a - b);
  }
  if (typeof raw === 'string' && raw.trim()) {
    const byLabel = new Map(DISPLAY_SCHEDULE_DAYS.map((d) => [d.label.toLowerCase(), d.index]));
    const out = raw
      .split(',')
      .map((s) => s.trim())
      .map((s) => (/^\d+$/.test(s) ? Number(s) : byLabel.get(s.toLowerCase())))
      .filter(isDayIndex);
    return [...new Set(out)].sort((a, b) => a - b);
  }
  return [];
}

/** Wire form: deduped, canonically sorted, never null. May be empty (invalid). */
export function serializeDays(days: readonly number[]): number[] {
  return [...new Set(days.filter(isDayIndex))].sort((a, b) => a - b);
}

/** "Mon Tue Wed" for the saved-schedule summary line. */
export function formatDays(days: readonly number[]): string {
  const set = new Set(serializeDays(days));
  return DISPLAY_SCHEDULE_DAYS.filter((d) => set.has(d.index))
    .map((d) => d.label)
    .join(' ');
}

/** True when every day of the week is selected (summary says "Every day"). */
export function isEveryDay(days: readonly number[]): boolean {
  return serializeDays(days).length === 7;
}

/** True when the on→off window crosses midnight (on 18:00 → off 02:00). */
export function crossesMidnight(onTime: string, offTime: string): boolean {
  if (!/^\d{2}:\d{2}$/.test(onTime) || !/^\d{2}:\d{2}$/.test(offTime)) return false;
  return offTime <= onTime;
}
