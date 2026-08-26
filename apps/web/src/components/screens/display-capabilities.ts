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
  resolveDisplayScheduleOffPath,
} from '@cms/api-types';

import type { RenderTrustGrade } from './renderTrust';

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
 *      has never reported). volume and REBOOT stay gated: the API refuses
 *      both on a null verdict, so rendering them enabled is a control with a
 *      100% failure rate. REBOOT additionally resolves to unavailable on the
 *      entire real fleet (no device owner).
 *
 *      ── AMENDED 2026-08-25 (the blank/power split). BLANK left this list.
 *      It is soft now — a black overlay drawn by the player's own page — so
 *      the API accepts it on every verdict INCLUDING none, and gating it here
 *      would re-create the dead-control problem C4 exists to prevent. What
 *      took its place is POWER_OFF, which is where the hardware went and is
 *      allowlisted to mechanisms proven to round-trip. POWER_ON stays
 *      recovery-direction, exactly like WAKE.
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
  /**
   * Literal copy, used INSTEAD of `noteKey` when one is present.
   *
   * ⚠️ AN I18N DEBT, NOT A PATTERN (2026-08-25). The blank/power split landed
   * during a live field incident, in a wave explicitly barred from touching
   * the locale catalogs (another workstream owns them tonight), and
   * `check-i18n-parity.cjs` is a HARD gate — an en-only key would turn CI red
   * and a missing key renders its raw dot-path to a Spanish or Chinese
   * operator. Literal English is the honest interim: it is readable by
   * everyone, it is wrong for nobody in the way a raw key path is, and it is
   * a one-commit fix. OWED: move every `noteText` here into
   * `screens.display.note.*` across en/es/zh and delete this field.
   */
  noteText?: string | null;
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
  /** The BLANK action. SOFT and universal since 2026-08-25 — never gated. */
  blank: ControlAxis;
  /** The WAKE action. Never gated (C4 — recovery direction). */
  wake: ControlAxis;
  reboot: ControlAxis;
  /**
   * The HARD power pair (2026-08-25 blank/power split). Separate from
   * blank/wake because it is the only thing here that touches panel power.
   */
  power: {
    /** POWER_OFF — only on a mechanism proven to round-trip. */
    off: ControlAxis;
    /** POWER_ON — recovery direction, so available whenever we know anything. */
    on: ControlAxis;
    /** The resolved hard mechanism, for the copy. Null when unreported. */
    mechanism: ScreenBlankVerdict | null;
  };
}

const NOT_REPORTED: ControlAxis = { available: false, softwareOnly: false, noteKey: null };

/**
 * ── THE BLANK/POWER SPLIT (live field incident, 2026-08-25) ────────────
 *
 * Operator contract, verbatim: *"wake and blank should just do that and turn
 * on and off should do that, keep them separate and make them work perfectly
 * on all our models."*
 *
 * A remote BLANK used to be forwarded to the APK, which takes an Android
 * device-admin lock. That lock latched a Goodview G43 and a Mobile A-Frame
 * into a VENDOR standby — glass dark, IR remote and the physical power button
 * both dead, WAKE delivered and useless, mains power-cycle required — and the
 * A-Frame then woke ITSELF back up minutes later with nothing sent to it. An
 * L55VEC with a byte-identical verdict recovered normally. So the standby is
 * a vendor firmware timer, unreliable in BOTH directions, and no probe
 * verdict predicts which panel does which.
 *
 * BLANK is therefore no longer a hardware action on ANY model: the player
 * covers its own viewport with black. The verdict copy below stops describing
 * blank and starts describing the thing it actually gates now — POWER.
 */
const BLANK_NOTE =
  'Covers the screen with black from inside the player — the panel stays ' +
  'powered. Wake brings it back, and an emergency alert always overrides it.';

const POWER_ON_NOTE = 'Turns the panel back on if something left it dark.';

/**
 * Is this the panel's HARD power mechanism, and can it be trusted to come
 * back? Drives the power row's copy AND whether "Turn panel off" is a
 * button at all.
 *
 *  - `vendor-recipe` is the only PROVEN class: a direct write to a named
 *    backlight/power node, reversed by the same node (TC22's writable
 *    `bl_power` is the reference case). No vendor standby state is entered,
 *    so nothing else's firmware gets to decide when the panel comes back.
 *  - `device-admin` / `device-owner` are the admin-lock family — the one
 *    that produced the incident. Refused server-side with
 *    DISPLAY_BLANK_MECHANISM_UNPROVEN, so this must not render a button.
 *  - `screen-timeout` / `software-dim` / `none` cannot reach panel power at
 *    all; the server answers DISPLAY_ACTION_UNSUPPORTED.
 */
function powerOffNote(mech: ScreenBlankVerdict | undefined): {
  available: boolean;
  noteText: string;
} {
  switch (mech) {
    case 'vendor-recipe':
      return {
        available: true,
        noteText:
          'Switches the panel itself off. “Turn panel on” brings it back.',
      };
    case 'device-admin':
    case 'device-owner':
      // ENGINEERING DETAIL, DELIBERATELY NOT ON SCREEN: the only power path
      // this family exposes is an Android device-admin lock. On 2026-08-25 it
      // left a Goodview G43 and a Mobile A-Frame in a vendor standby that
      // ignored Wake and needed mains pulled, and the A-Frame then woke
      // itself minutes later — unreliable in BOTH directions, so the API
      // refuses it with DISPLAY_BLANK_MECHANISM_UNPROVEN until a supervised
      // on-site off/on test. The operator does not need that story; they need
      // to know what to press instead. Keep incident narrative in comments.
      return {
        available: false,
        noteText:
          'This model can’t be switched off remotely. Use Blank to darken the screen.',
      };
    default:
      return {
        available: false,
        noteText:
          'This panel has no remote power control. Use Blank to darken the screen.',
      };
  }
}

// ─────────────────────────────────────────────────────────────────────
// PANEL POWER STATE — offer the verb that matches the glass (2026-08-25)
//
// Operator, looking at a screen that was ONLINE and actively painting and
// being offered exactly one button, "Turn panel on": *"thats not correct
// really, the screen is already on...it should know that and say power
// off....or sleep, or whatever its doing."*
//
// He is right, and we already know the answer: the render-proof verdict on
// every fleet row says whether pixels are advancing. Capability decides WHICH
// power verbs this hardware can perform; state decides which one is worth
// offering right now. Two separate questions, resolved separately, joined
// here — no polling, no endpoint, no schema.
// ─────────────────────────────────────────────────────────────────────

/** What we can honestly say about the glass right now. */
export type PanelPowerState =
  /** Online AND proving fresh paints — the panel is on and showing content. */
  | 'on'
  /** Online but not painting — dark, asleep, or wedged. Either way: not lit. */
  | 'dark'
  /** Offline, or no render proof at all. We do not guess. */
  | 'unknown';

/**
 * Render-proof trust grade → panel power state.
 *
 * `checking` (a stale gap under 5 minutes — usually a reload or an OTA)
 * counts as 'dark' on purpose. We genuinely cannot tell a reloading panel
 * from one that just went dark, and of the two mistakes, offering "Turn panel
 * on" to a panel that is already coming back is harmless, while withholding
 * it from one that is actually dark is the truck roll this feature exists to
 * prevent. Recovery direction wins ties — the same asymmetry as C4.
 */
export function derivePanelPowerState(trust: RenderTrustGrade): PanelPowerState {
  switch (trust) {
    case 'painting':
      return 'on';
    case 'not-painting':
    case 'checking':
    case 'stale-chronic':
      return 'dark';
    // 'offline' — unreachable, so no command would land anyway.
    // 'unknown'  — this build never posted render proof. Never a guess.
    default:
      return 'unknown';
  }
}

export interface PanelPowerOffer {
  showOff: boolean;
  showOn: boolean;
  /** The one line under the row. Always populated. */
  note: string;
}

const PANEL_STATE_UNKNOWN_NOTE =
  'We can’t tell whether this panel is on right now, so power controls stay hidden. Blank and Wake still work.';

const PANEL_UNREPORTED_NOTE =
  'Available once this screen reports what its panel can do. Blank and Wake work in the meantime.';

/**
 * Join capability with state into the buttons this row should actually show.
 *
 *   panel ON   + proven power  → "Turn panel off" only. Never offer to turn
 *                                on a screen that is visibly painting.
 *   panel ON   + unproven      → no buttons; say what to use instead.
 *   panel DARK                 → "Turn panel on" only, whenever the API would
 *                                accept it (i.e. the screen has reported).
 *   UNKNOWN                    → no buttons, one honest line.
 *
 * ⚠️ THE DARK CASE IS DELIBERATELY NOT RESTRICTED TO PROVEN HARDWARE. On the
 * admin-lock panels POWER_ON is the only hardware control left — the soft
 * Wake button never reaches the bridge, so a panel darkened by its own
 * nightly schedule has no other way back from this dashboard. Contract C4 is
 * explicit that recovery is never gated, and `displayActionSupport('POWER_ON')`
 * agrees: it refuses only on an unreported verdict, never on the unproven
 * code. Withholding it here would be the dead-recovery-control mistake, one
 * layer up.
 */
export function panelPowerOffer(
  power: ResolvedDisplayControls['power'],
  state: PanelPowerState,
): PanelPowerOffer {
  // Nothing reported: capability is unknown before state is even relevant.
  if (!power.off.available && !power.on.available) {
    return {
      showOff: false,
      showOn: false,
      note: power.off.noteText ?? PANEL_UNREPORTED_NOTE,
    };
  }
  if (state === 'unknown') {
    return { showOff: false, showOn: false, note: PANEL_STATE_UNKNOWN_NOTE };
  }
  if (state === 'dark') {
    return {
      showOff: false,
      showOn: power.on.available,
      note: power.on.noteText ?? POWER_ON_NOTE,
    };
  }
  // state === 'on'
  return {
    showOff: power.off.available,
    showOn: false,
    note: power.off.noteText ?? '',
  };
}

/**
 * CONTRACT C3 + C4, after the split.
 *
 * BLANK and WAKE are the SOFT pair and are now BOTH ungated, on every verdict
 * and on no verdict at all — `displayActionSupport` agrees for both, because
 * the outcome is a black div in the player's own page and there is no
 * hardware left to fail-closed against. (This is a reversal: from 2026-08-13
 * to 2026-08-25 BLANK was risk-direction and hidden on an unreported screen,
 * because back then it really could reach a device-admin lock.)
 */
export function resolveBlankAxis(): ControlAxis {
  return {
    available: true,
    softwareOnly: true,
    noteKey: null,
    noteText: BLANK_NOTE,
  };
}

/** WAKE — recovery direction, never gated (C3/C4). Soft, like BLANK. */
export function resolveWakeAxis(): ControlAxis {
  return { available: true, softwareOnly: true, noteKey: null, noteText: null };
}

/**
 * The HARD pair. OFF is allowlisted; ON is the recovery direction.
 *
 * The asymmetry is the same one BLANK/WAKE have always had, for the same
 * reason: a panel that is genuinely dark must always have a dashboard path
 * back, and `displayActionSupport('POWER_ON', …)` never refuses on the
 * unproven code. So on a reported screen the ON button renders even when OFF
 * is refused — which is exactly the state the incident panels are in.
 */
export function resolvePowerAxes(
  mech: ScreenBlankVerdict | undefined,
  reported: boolean,
): ResolvedDisplayControls['power'] {
  if (!reported) {
    // The API refuses POWER_OFF with DISPLAY_CAPABILITIES_UNKNOWN here, and
    // POWER_ON on an unreported screen is indistinguishable from WAKE (which
    // is already on screen), so the whole row stays text.
    return {
      off: {
        available: false,
        softwareOnly: false,
        noteKey: null,
        noteText:
          'Not available until this screen reports what its panel can do. ' +
          'Blank and Wake work in the meantime.',
      },
      on: { available: false, softwareOnly: false, noteKey: null, noteText: null },
      mechanism: null,
    };
  }
  const off = powerOffNote(mech);
  return {
    off: {
      available: off.available,
      softwareOnly: false,
      noteKey: null,
      noteText: off.noteText,
    },
    on: {
      available: true,
      softwareOnly: false,
      noteKey: null,
      noteText: POWER_ON_NOTE,
    },
    mechanism: mech ?? null,
  };
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
      // Blank AND Wake both render, even here (2026-08-25): the soft blank
      // is a black div in the player's own page, so an unprobed screen
      // blanks exactly as safely as a probed one and the server accepts it.
      // Withholding it produced a dead control on a fleet where every screen
      // was unreported.
      blank: resolveBlankAxis(),
      wake: resolveWakeAxis(),
      reboot: NOT_REPORTED,
      // Panel POWER still needs an observed verdict — that is where the
      // hardware went, so that is where fail-closed moved.
      power: resolvePowerAxes(undefined, false),
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
  //
  // ── `settings` MOVED TO THE SOFTWARE SIDE (field evidence, 2026-08-25) ──
  //
  // It used to read "Sets the Android system brightness", which was true and
  // useless: the write succeeds and the backlight does not move. Two of the
  // four field panels resolve `settings` precisely BECAUSE their
  // `/sys/class/backlight/*` node is not writable, and their sliders were
  // dead while M43's and L55VEC's (writable node → `sysfs-backlight`) worked.
  // The API now routes `settings` onto the soft path — the player dims its
  // own picture — so `softwareOnly: true` here is not a downgrade in
  // capability, it is the label finally matching what happens. It also drives
  // the "Brightness (image only)" label, which is the honest one.
  //
  // The proven mechanisms are unchanged and keep their real-backlight copy;
  // this list must stay in step with DISPLAY_BRIGHTNESS_PROVEN_MECHANISMS in
  // @cms/api-types (the test asserts they agree).
  const brightnessNote: Record<BrightnessVerdict, { softwareOnly: boolean; noteKey: string }> = {
    'vendor-recipe': { softwareOnly: false, noteKey: 'screens.display.note.brightnessVendorRecipe' },
    'sysfs-backlight': { softwareOnly: false, noteKey: 'screens.display.note.brightnessSysfs' },
    sysfs: { softwareOnly: false, noteKey: 'screens.display.note.brightnessSysfs' },
    settings: { softwareOnly: true, noteKey: 'screens.display.note.brightnessSettings' },
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

  const blank: ControlAxis = resolveBlankAxis();
  const wake: ControlAxis = resolveWakeAxis();
  const power = resolvePowerAxes(verdict.screenBlank, true);

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

  return { reported: true, verdict, volume, brightness, blank, wake, reboot, power };
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

// ─────────────────────────────────────────────────────────────────────
// What a scheduled "off" will ACTUALLY do (2026-08-25)
// ─────────────────────────────────────────────────────────────────────

/**
 * How many of these panels will have their scheduled "off" executed in
 * SOFTWARE rather than by cutting panel power.
 *
 * WHY THE EDITOR HAS TO SAY THIS. The operator saved one 07:00/14:45 window
 * on a screen GROUP and got four different outcomes: one panel dark and
 * unrecoverable, two rebooted, two that did nothing at all. The schedule was
 * never the problem — the panels were, and the editor gave no sign of it.
 * The server now routes each panel's off onto the path its own hardware can
 * survive, and this reports that same answer BEFORE the operator commits.
 *
 * It calls `resolveDisplayScheduleOffPath` — the server's own gate, imported
 * — rather than re-deriving anything. A dashboard that reached a different
 * verdict than the manifest would be lying about the thing being saved.
 *
 * PER PANEL, NEVER PER GROUP: a group routinely spans mechanisms, which is
 * exactly the shape that made the incident so confusing to read.
 */
export interface ScheduleOffPathSummary {
  /** Panels the schedule targets. */
  total: number;
  /** …of which will darken in software (the panel stays powered). */
  soft: number;
  /** …of which will genuinely cut panel power. */
  hard: number;
}

export function summarizeScheduleOffPaths(
  screens: ReadonlyArray<{ displayCapabilities?: unknown }>,
): ScheduleOffPathSummary {
  let soft = 0;
  for (const s of screens) {
    if (
      resolveDisplayScheduleOffPath(
        readStoredDisplayVerdict(s?.displayCapabilities ?? null),
      ) === 'soft-blank'
    ) {
      soft++;
    }
  }
  return { total: screens.length, soft, hard: screens.length - soft };
}
