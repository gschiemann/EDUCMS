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
 */
export const MIN_SAFE_BRIGHTNESS = 5;

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
      blank: NOT_REPORTED,
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

  const blank: ControlAxis =
    verdict.screenBlank === 'device-owner' || verdict.screenBlank === 'device-admin'
      ? { available: true, softwareOnly: false, noteKey: 'screens.display.note.blankHardware' }
      : verdict.screenBlank === 'none'
        ? { available: true, softwareOnly: true, noteKey: 'screens.display.note.blankSoftware' }
        : NOT_REPORTED;

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

export const DISPLAY_SCHEDULE_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

/**
 * `daysOfWeek` is stored the same way Playlist/Schedule store it: a
 * comma-joined subset, or null meaning "every day". Keep the round-trip in
 * one place so the collapse rule (0 or 7 selected → null) can't drift.
 */
export function parseDays(csv: string | null | undefined): string[] {
  if (!csv) return [...DISPLAY_SCHEDULE_DAYS];
  return csv
    .split(',')
    .map((s) => s.trim())
    .filter((s) => (DISPLAY_SCHEDULE_DAYS as readonly string[]).includes(s));
}

export function serializeDays(days: string[]): string | null {
  const kept = DISPLAY_SCHEDULE_DAYS.filter((d) => days.includes(d));
  if (kept.length === 0 || kept.length === DISPLAY_SCHEDULE_DAYS.length) return null;
  return kept.join(',');
}

/** True when the on→off window crosses midnight (on 18:00 → off 02:00). */
export function crossesMidnight(onTime: string, offTime: string): boolean {
  if (!/^\d{2}:\d{2}$/.test(onTime) || !/^\d{2}:\d{2}$/.test(offTime)) return false;
  return offTime <= onTime;
}
