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

import {
  MIN_SAFE_BRIGHTNESS_PERCENT,
  DISPLAY_RECOVERY_MIN_BRIGHTNESS_PERCENT,
  DISPLAY_VOLUME_MECHANISMS,
  DISPLAY_BRIGHTNESS_MECHANISMS,
  DISPLAY_BLANK_MECHANISMS,
  DISPLAY_REBOOT_MECHANISMS,
  DISPLAY_HARD_POWER_OFF_MECHANISMS,
  DISPLAY_DEVICE_OWNER_PATHS,
  readStoredDisplayVerdict,
} from '@cms/api-types';

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
 *      on a verdict — and neither is a brightness RAISE (accepted by the API
 *      at or above DISPLAY_RECOVERY_MIN_BRIGHTNESS_PERCENT on a screen that
 *      has never reported). BLANK, volume and REBOOT stay gated: the API
 *      refuses all three on a null verdict, so rendering them enabled is a
 *      control with a 100% failure rate. REBOOT additionally resolves to
 *      unavailable on the entire real fleet (no device owner).
 *
 *  C5. THE DEVICE'S PROVIDER-ID VOCABULARY IS AUTHORITATIVE. The verdict is
 *      written by DisplayCapabilityProbe.verdict(), which prefers
 *      DisplayControlRegistry's resolved provider `id` strings and only falls
 *      back to its own heuristic words when registry resolution threw. Both
 *      vocabularies therefore appear on the wire, so both are accepted here.
 *      The ids below were read out of the Kotlin, not guessed:
 *        AudioManagerProvider.id       = "audiomanager"
 *        VendorRecipeProvider.id       = "vendor-recipe"
 *        SysfsBacklightProvider.id     = "sysfs-backlight"   (NOT "sysfs")
 *        SettingsBrightnessProvider.id = "settings"
 *        SoftwareDimProvider.id        = "software-dim"
 *        DeviceAdminBlankProvider.id   = "device-admin"
 *        ScreenTimeoutBlankProvider.id = "screen-timeout"
 *        DeviceOwnerRebootProvider.id  = "device-owner"
 *      An unknown string still degrades to `undefined` = "not reported",
 *      never to a permissive guess.
 */

/**
 * Probe verdict axes — mirrors DisplayCapabilityProbe.kt's `verdict` block,
 * which emits EITHER a DisplayControlRegistry provider id (the normal path)
 * OR its own heuristic word (the throw-fallback path). Legacy members are
 * marked; they are kept because rows written by an older APK are already in
 * `Screen.displayCapabilities` and must keep resolving to real copy.
 */
/**
 * ⚠️ THESE ARE DERIVED, NOT DECLARED (2026-08-14 sweep).
 *
 * This file used to restate all six mechanism unions AND their runtime
 * string lists by hand — a THIRD copy of a vocabulary that already exists in
 * the Kotlin (`override val id`) and in `@cms/api-types`. The drift guard
 * (apps/api/src/display/display-mechanism-drift.spec.ts) parses the Kotlin
 * and pins it against the SERVER enums; nothing pinned this copy, so the
 * exact failure it was written to prevent stayed live one layer up: widen a
 * server enum for a new provider id, the device reports it, the API stores
 * it — and the dashboard silently drops that axis to "not reported", so the
 * brightness slider disappears on precisely the boxes that have real
 * hardware brightness control.
 *
 * Deriving from the shared constants makes that unrepresentable: a new
 * mechanism is accepted here the moment the contract accepts it. Keep the
 * per-member comments below on the CONSTANTS in api-types, not here.
 */
export type VolumeVerdict = (typeof DISPLAY_VOLUME_MECHANISMS)[number];
export type BrightnessVerdict = (typeof DISPLAY_BRIGHTNESS_MECHANISMS)[number];
export type ScreenBlankVerdict = (typeof DISPLAY_BLANK_MECHANISMS)[number];
export type RebootVerdict = (typeof DISPLAY_REBOOT_MECHANISMS)[number];
export type HardPowerOffVerdict = (typeof DISPLAY_HARD_POWER_OFF_MECHANISMS)[number];
export type DeviceOwnerPath = (typeof DISPLAY_DEVICE_OWNER_PATHS)[number];

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
 * The floor a brightness request must clear to count as RECOVERY on a screen
 * that has NEVER reported. Re-exported from the shared contract for the same
 * reason as the floor above: `displayActionSupport('SET_BRIGHTNESS', null,
 * {percent})` refuses anything below it, so a slider whose `min` is lower is
 * a slider whose bottom half 409s.
 */
export const RECOVERY_MIN_BRIGHTNESS = DISPLAY_RECOVERY_MIN_BRIGHTNESS_PERCENT;

/**
 * Dead-man revert the dashboard attaches to BLANK. Per the architecture,
 * operator-initiated actions carry a revert; scheduled ones never do. A
 * permanent nightly off belongs in the schedule editor, not in a button
 * that could strand a screen dark if the operator walks away.
 */
export const BLANK_AUTO_WAKE_MS = 10 * 60_000;

// C5 — the union of every string the probe can put on the wire: the registry
// provider ids (normal path) plus the heuristic/legacy words. Taken from the
// shared contract, never restated — see the note on the types above.
const VOLUME_VALUES: readonly string[] = DISPLAY_VOLUME_MECHANISMS;
const BRIGHTNESS_VALUES: readonly string[] = DISPLAY_BRIGHTNESS_MECHANISMS;
const BLANK_VALUES: readonly string[] = DISPLAY_BLANK_MECHANISMS;
const REBOOT_VALUES: readonly string[] = DISPLAY_REBOOT_MECHANISMS;
const HARD_POWER_VALUES: readonly string[] = DISPLAY_HARD_POWER_OFF_MECHANISMS;
const OWNER_PATH_VALUES: readonly string[] = DISPLAY_DEVICE_OWNER_PATHS;

function pick<T extends string>(raw: unknown, allowed: readonly string[]): T | undefined {
  return typeof raw === 'string' && allowed.includes(raw) ? (raw as T) : undefined;
}

/**
 * Parse whatever is sitting in `Screen.displayCapabilities` (a Prisma Json
 * column — could be anything) into a verdict we trust. Unknown/garbage
 * values for an axis become `undefined`, which the resolver treats as
 * "not reported" rather than "unsupported". Returns null when there is no
 * usable verdict at all.
 *
 * "IS THERE A VERDICT AT ALL" IS NOT DECIDED HERE (2026-08-14 sweep). That
 * question is answered by `readStoredDisplayVerdict` — the SAME function the
 * API's gate uses — so the panel can never treat a document as reported that
 * `displayActionSupport` will treat as unknown. This file only NARROWS the
 * accepted document to the UI's unions afterwards.
 *
 * What that changes, deliberately:
 *   • a document missing any of volume/brightness/screenBlank/reboot is no
 *     longer "partially reported". It is NOT REPORTED, and the panel renders
 *     the recovery-only layout — which is exactly what the API would enforce
 *     anyway, with a 409 instead of a disabled control.
 *   • a BARE verdict object (no `{ verdict: … }` envelope) is refused. The
 *     API's writer (`normalizeCapabilityReport`) always emits the envelope,
 *     so no real row is affected; accepting the bare form only ever made the
 *     dashboard more permissive than the server on a hand-seeded row.
 * Both were live "enabled button, guaranteed 409" paths. Narrowing stays
 * tri-state: an axis whose value is unrecognised is `undefined` = unknown.
 */
export function parseDisplayCapabilities(raw: unknown): DisplayCapabilityVerdict | null {
  const stored = readStoredDisplayVerdict(raw);
  if (!stored) return null;
  const v = stored as unknown as Record<string, unknown>;

  return {
    volume: pick<VolumeVerdict>(v.volume, VOLUME_VALUES),
    brightness: pick<BrightnessVerdict>(v.brightness, BRIGHTNESS_VALUES),
    screenBlank: pick<ScreenBlankVerdict>(v.screenBlank, BLANK_VALUES),
    reboot: pick<RebootVerdict>(v.reboot, REBOOT_VALUES),
    hardPowerOff: pick<HardPowerOffVerdict>(v.hardPowerOff, HARD_POWER_VALUES),
    deviceOwnerPath: pick<DeviceOwnerPath>(v.deviceOwnerPath, OWNER_PATH_VALUES),
  };
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
  /** The screen has sent a probe verdict. False → recovery controls only. */
  reported: boolean;
  verdict: DisplayCapabilityVerdict | null;
  volume: ControlAxis;
  brightness: ControlAxis & {
    kind: BrightnessVerdict | null;
    /** Lowest percent the API will accept for THIS screen right now. */
    floor: number;
    /** True on an unreported screen: raises only, no darkening. */
    recoveryOnly: boolean;
  };
  /** The BLANK action. Gated on a verdict (C4 — risk direction). */
  blank: ControlAxis;
  /** The WAKE action. Never gated (C4 — recovery direction). */
  wake: ControlAxis;
  reboot: ControlAxis;
}

const NOT_REPORTED: ControlAxis = { available: false, softwareOnly: false, noteKey: null };

/**
 * Does this verdict's blank mechanism reach the actual panel, or only cover
 * it with black? `softwareOnly` drives the copy, never the availability.
 *
 * Honesty subtleties baked in:
 *  - `device-admin` does NOT claim "truly turns the screen off". The probe
 *    sets that verdict when ANY app on the box is an active device admin
 *    (`dpm.activeAdmins`), which on a district image is routinely a
 *    third-party MDM and not us — `lockNow()` then throws SecurityException
 *    and the player silently falls through to the software floor. So the
 *    device-admin copy says "should", and only `device-owner` (legacy) keeps
 *    the absolute wording.
 *  - `screen-timeout` is the same shape of hedge: it drops the system screen
 *    timeout to force the panel off, which most signage SoCs honour and some
 *    ignore entirely.
 *  - `vendor-recipe` is a DB-authored vendor command. It is the most likely
 *    to be a real hardware off AND the most likely to be silently wrong (a
 *    broadcast with no receiver is a no-op on Android), so it is hedged too.
 */
function blankNoteKey(mech: ScreenBlankVerdict | undefined): {
  softwareOnly: boolean;
  noteKey: string;
} {
  switch (mech) {
    case 'device-owner':
      return { softwareOnly: false, noteKey: 'screens.display.note.blankHardware' };
    case 'device-admin':
      return { softwareOnly: false, noteKey: 'screens.display.note.blankDeviceAdmin' };
    case 'vendor-recipe':
      return { softwareOnly: false, noteKey: 'screens.display.note.blankVendorRecipe' };
    case 'screen-timeout':
      return { softwareOnly: false, noteKey: 'screens.display.note.blankScreenTimeout' };
    default:
      // 'software-dim', legacy 'none', and anything unrecognised: the
      // player's unconditional floor. Black overlay, backlight still lit.
      return { softwareOnly: true, noteKey: 'screens.display.note.blankSoftware' };
  }
}

/**
 * CONTRACT C3 + C4 — the pair splits.
 *
 * WAKE rides the player's unconditional software floor and can only ever make
 * a dark screen visible, so it renders on every verdict AND on no verdict at
 * all. `displayActionSupport('WAKE', null)` agrees: always supported.
 *
 * BLANK is the risk direction. `displayActionSupport('BLANK', null)` REFUSES
 * with DISPLAY_CAPABILITIES_UNKNOWN ("Blanking stays disabled until it does —
 * Wake still works"), so on an unreported screen the button is not a button:
 * it is an explainer row. Every screen in the pilot is in that state today
 * (the self-report ships with this wave and no field APK has it yet), which
 * is why rendering it enabled was a control with a 100% failure rate rather
 * than an edge case.
 */
export function resolveBlankAxis(
  mech: ScreenBlankVerdict | undefined,
  reported: boolean,
): ControlAxis {
  if (!reported) {
    return {
      available: false,
      softwareOnly: true,
      noteKey: 'screens.display.note.blankNotReported',
    };
  }
  const { softwareOnly, noteKey } = blankNoteKey(mech);
  return { available: true, softwareOnly, noteKey };
}

/** WAKE — recovery direction, never gated (C3/C4). */
export function resolveWakeAxis(
  mech: ScreenBlankVerdict | undefined,
  reported: boolean,
): ControlAxis {
  if (!reported) {
    return {
      available: true,
      softwareOnly: true,
      noteKey: 'screens.display.note.wakeNotReported',
    };
  }
  const { softwareOnly } = blankNoteKey(mech);
  return { available: true, softwareOnly, noteKey: null };
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
      // Volume and reboot have no recovery direction at all — the API
      // refuses both on a null verdict, so neither renders.
      volume: NOT_REPORTED,
      // C4 recovery: a brightness RAISE is accepted on an unreported screen
      // (>= RECOVERY_MIN_BRIGHTNESS), so the slider renders with its floor
      // lifted to exactly what the API will take. Nothing below that is
      // offered, because nothing below that would be executed.
      brightness: {
        available: true,
        softwareOnly: true,
        kind: null,
        floor: RECOVERY_MIN_BRIGHTNESS,
        recoveryOnly: true,
        noteKey: 'screens.display.note.brightnessRecoveryOnly',
      },
      // Blank is withheld (risk); Wake is not (recovery). Splitting these
      // is the whole point — an unrecoverable dark screen is the worst
      // outcome in this feature, and a dead Blank button is the second.
      blank: resolveBlankAxis(undefined, false),
      wake: resolveWakeAxis(undefined, false),
      reboot: NOT_REPORTED,
    };
  }

  const volume: ControlAxis =
    verdict.volume === 'audiomanager'
      ? { available: true, softwareOnly: false, noteKey: 'screens.display.note.volumeOk' }
      : verdict.volume === 'none'
        ? { available: false, softwareOnly: false, noteKey: 'screens.display.note.volumeNone' }
        : NOT_REPORTED;

  // C5: 'sysfs-backlight' is the real SysfsBacklightProvider id; 'sysfs' is
  // the probe's heuristic-fallback spelling of the same thing. Both mean
  // "real backlight control", so both get the same copy.
  const brightnessNote: Record<BrightnessVerdict, { softwareOnly: boolean; noteKey: string }> = {
    'vendor-recipe': { softwareOnly: false, noteKey: 'screens.display.note.brightnessVendorRecipe' },
    'sysfs-backlight': { softwareOnly: false, noteKey: 'screens.display.note.brightnessSysfs' },
    sysfs: { softwareOnly: false, noteKey: 'screens.display.note.brightnessSysfs' },
    settings: { softwareOnly: false, noteKey: 'screens.display.note.brightnessSettings' },
    'software-dim': { softwareOnly: true, noteKey: 'screens.display.note.brightnessSoftware' },
  };

  const brightness: ResolvedDisplayControls['brightness'] = verdict.brightness
    ? {
        available: true,
        kind: verdict.brightness,
        floor: MIN_SAFE_BRIGHTNESS,
        recoveryOnly: false,
        ...brightnessNote[verdict.brightness],
      }
    : {
        ...NOT_REPORTED,
        kind: null,
        floor: MIN_SAFE_BRIGHTNESS,
        recoveryOnly: false,
      };

  const blank: ControlAxis = resolveBlankAxis(verdict.screenBlank, true);
  const wake: ControlAxis = resolveWakeAxis(verdict.screenBlank, true);

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

  return { reported: true, verdict, volume, brightness, blank, wake, reboot };
}

/**
 * Clamp a remote brightness request to the floor that applies to THIS screen.
 *
 * `floor` defaults to the universal safety floor. On a screen that has never
 * reported, the caller passes RECOVERY_MIN_BRIGHTNESS instead — the API only
 * accepts a raise there, so sending anything lower would 409 with a message
 * the operator can do nothing about.
 */
export function clampBrightness(percent: number, floor: number = MIN_SAFE_BRIGHTNESS): number {
  const lo = Math.min(100, Math.max(MIN_SAFE_BRIGHTNESS, Math.round(floor)));
  if (!Number.isFinite(percent)) return lo;
  return Math.min(100, Math.max(lo, Math.round(percent)));
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
