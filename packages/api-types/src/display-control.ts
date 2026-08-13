/**
 * Display control — shared contract between the API, the dashboard and the
 * player APK (2026-08-13).
 *
 * THE PROBLEM: the operator has to control screen volume, brightness,
 * blank/wake and scheduled on/off from the dashboard, across Goodview
 * (today), NovaStar Taurus, TCL and whatever Android signage SoC ships next,
 * WITHOUT us holding a per-vendor SDK.
 *
 * THE SHAPE: the player runs a read-only capability probe
 * (apps/player/.../display/DisplayCapabilityProbe.kt) and reports its
 * `verdict` — per-capability, "can we drive this TODAY on this box, and by
 * which mechanism". Everything downstream keys off that verdict:
 *
 *   - the dashboard renders ONLY the controls the verdict supports, and says
 *     out loud what the fallback actually does ("dims the image only — this
 *     box exposes no backlight control") instead of pretending;
 *   - POST /screens/:id/display-control validates the requested action
 *     against the verdict and 409s when it exceeds it.
 *
 * That is the capability-registry truth-gate applied to hardware: never a
 * button the hardware cannot perform.
 *
 * SAFETY: this drives wall-mounted screens nobody can physically reach.
 * Two rules live here because both ends have to agree on them:
 *   - MIN_SAFE_BRIGHTNESS_PERCENT — a remote 0% on an unreachable screen is
 *     a truck roll. Clamped server-side AND player-side unless the caller
 *     explicitly passes allowBlack.
 *   - revertAfterMs — every operator-initiated TEST carries a dead-man
 *     revert; scheduled actions never do.
 */

import { z } from 'zod';

// ─────────────────────────────────────────────────────────────────────
// Capability verdict — mirrors DisplayCapabilityProbe.verdict()
// ─────────────────────────────────────────────────────────────────────

/** How volume can be driven. */
export type DisplayVolumeMechanism = 'audiomanager' | 'none';
/** How brightness can be driven, most-real first. */
export type DisplayBrightnessMechanism = 'sysfs' | 'settings' | 'software-dim';
/** How the screen can be blanked/woken. */
export type DisplayBlankMechanism = 'device-owner' | 'device-admin' | 'none';
/** Reboot is device-owner only — no fallback exists. */
export type DisplayRebootMechanism = 'device-owner' | 'none';
/** Hard power-off has no public Android API at any privilege level. */
export type DisplayHardPowerOffMechanism = 'serial-candidate' | 'none';
/** Whether we could ever take device owner on this box. */
export type DisplayDeviceOwnerPath =
  | 'held'
  | 'blocked-other-owner'
  | 'provisionable-after-factory-reset';

export interface DisplayCapabilityVerdict {
  volume: DisplayVolumeMechanism;
  brightness: DisplayBrightnessMechanism;
  screenBlank: DisplayBlankMechanism;
  reboot: DisplayRebootMechanism;
  hardPowerOff: DisplayHardPowerOffMechanism;
  deviceOwnerPath: DisplayDeviceOwnerPath;
}

/** Build identity we keep alongside the verdict, for vendor-recipe triage. */
export interface DisplayBuildIdentity {
  manufacturer: string | null;
  brand: string | null;
  model: string | null;
  device: string | null;
  board: string | null;
  sdk: number | null;
  release: string | null;
}

/** What we persist on `Screen.displayCapabilities`. */
export interface DisplayCapabilityReport {
  /** Probe schema version, so server-side parsing can branch later. */
  schema: number;
  /** Device clock at probe time (ms). Advisory only — never trusted. */
  probedAt: number | null;
  /** Server clock when the report landed (ms). This is the authoritative one. */
  reportedAt: number;
  build: DisplayBuildIdentity;
  verdict: DisplayCapabilityVerdict;
}

const VOLUME_MECHANISMS = ['audiomanager', 'none'] as const;
const BRIGHTNESS_MECHANISMS = ['sysfs', 'settings', 'software-dim'] as const;
const BLANK_MECHANISMS = ['device-owner', 'device-admin', 'none'] as const;
const REBOOT_MECHANISMS = ['device-owner', 'none'] as const;
const HARD_POWER_OFF_MECHANISMS = ['serial-candidate', 'none'] as const;
const DEVICE_OWNER_PATHS = [
  'held',
  'blocked-other-owner',
  'provisionable-after-factory-reset',
] as const;

/**
 * Body of POST /screens/:id/display-capabilities.
 *
 * Accepts the probe's OWN document (schema/probedAt/build/verdict/…) and
 * keeps only what we store — the raw probe carries a full filesystem +
 * settings + package dump that is a diagnostics artifact, not fleet state.
 * `.passthrough()` on the outer object so a newer APK's extra sections are
 * accepted rather than 400'd; the extra keys are dropped by the mapper.
 */
export const DisplayCapabilityReportSchema = z
  .object({
    schema: z.number().int().min(1).max(1000).optional(),
    probedAt: z.number().int().nonnegative().optional(),
    build: z
      .object({
        manufacturer: z.string().max(120).optional(),
        brand: z.string().max(120).optional(),
        model: z.string().max(120).optional(),
        device: z.string().max(120).optional(),
        board: z.string().max(120).optional(),
        sdk: z.number().int().min(0).max(1000).optional(),
        release: z.string().max(60).optional(),
      })
      .passthrough()
      .optional(),
    verdict: z
      .object({
        volume: z.enum(VOLUME_MECHANISMS),
        brightness: z.enum(BRIGHTNESS_MECHANISMS),
        screenBlank: z.enum(BLANK_MECHANISMS),
        reboot: z.enum(REBOOT_MECHANISMS),
        hardPowerOff: z.enum(HARD_POWER_OFF_MECHANISMS),
        deviceOwnerPath: z.enum(DEVICE_OWNER_PATHS),
      })
      .passthrough(),
  })
  .passthrough();
export type DisplayCapabilityReportInput = z.infer<typeof DisplayCapabilityReportSchema>;

// ─────────────────────────────────────────────────────────────────────
// Actions
// ─────────────────────────────────────────────────────────────────────

export const DISPLAY_ACTIONS = [
  'SET_VOLUME',
  'SET_BRIGHTNESS',
  'BLANK',
  'WAKE',
  'REBOOT',
] as const;
export type DisplayActionType = (typeof DISPLAY_ACTIONS)[number];

/**
 * Brightness floor. A remote SetBrightness below this is CLAMPED, not
 * rejected — a screen nobody can reach must never end up at 0% because an
 * operator fat-fingered a slider or a UI sent a stale value. The only way
 * past it is an explicit `allowBlack: true` on the action, which is an
 * operator decision recorded in the audit row.
 */
export const MIN_SAFE_BRIGHTNESS_PERCENT = 5;

/** Bounds on the dead-man revert window (1 s … 15 min). */
export const DISPLAY_REVERT_MIN_MS = 1_000;
export const DISPLAY_REVERT_MAX_MS = 15 * 60_000;

/** WS message type published on `device:<screenId>` for an immediate action. */
export const DISPLAY_CONTROL_WS_TYPE = 'DISPLAY_CONTROL';

export const DisplayControlActionSchema = z
  .object({
    action: z.enum(DISPLAY_ACTIONS),
    /** 0..100. Required for SET_VOLUME / SET_BRIGHTNESS, ignored otherwise. */
    percent: z.number().int().min(0).max(100).optional(),
    /**
     * Dead-man revert. The player snapshots prior state, applies, and
     * schedules a revert — persisting the pending revert to prefs BEFORE
     * applying so a process death or reboot mid-test still restores the
     * screen. Operator TEST actions always carry one.
     */
    revertAfterMs: z.number().int().min(DISPLAY_REVERT_MIN_MS).max(DISPLAY_REVERT_MAX_MS).optional(),
    /** Explicit opt-out of the MIN_SAFE_BRIGHTNESS floor. Audited. */
    allowBlack: z.boolean().optional(),
    /** Free-text operator note carried into the audit row. */
    reason: z.string().max(500).optional(),
  })
  .passthrough();
export type DisplayControlActionInput = z.infer<typeof DisplayControlActionSchema>;

/** Which verdict field gates each action. */
export const DISPLAY_ACTION_CAPABILITY: Record<
  DisplayActionType,
  keyof DisplayCapabilityVerdict
> = {
  SET_VOLUME: 'volume',
  SET_BRIGHTNESS: 'brightness',
  BLANK: 'screenBlank',
  WAKE: 'screenBlank',
  REBOOT: 'reboot',
};

export type DisplayActionSupport =
  | { supported: true; mechanism: string }
  | { supported: false; code: string; message: string };

/**
 * THE capability gate. Pure, so the API, the dashboard and the tests all
 * reach the same verdict from the same input.
 *
 * A screen that has NEVER reported (verdict null) supports NOTHING — we do
 * not guess, and we do not optimistically fire an action at hardware whose
 * surface we have not observed. That is the honest reading of "never render
 * a control the hardware cannot perform".
 */
export function displayActionSupport(
  action: DisplayActionType,
  verdict: DisplayCapabilityVerdict | null | undefined,
): DisplayActionSupport {
  if (!verdict) {
    return {
      supported: false,
      code: 'DISPLAY_CAPABILITIES_UNKNOWN',
      message:
        'This screen has not reported its display capabilities yet. Controls stay disabled until it does.',
    };
  }
  const key = DISPLAY_ACTION_CAPABILITY[action];
  const mechanism = verdict[key];
  if (!mechanism || mechanism === 'none') {
    return {
      supported: false,
      code: 'DISPLAY_ACTION_UNSUPPORTED',
      message: `This screen reports no ${key} control (${action}).`,
    };
  }
  return { supported: true, mechanism };
}

/**
 * Apply the safety floor. Returns the value actually sent to the device plus
 * whether it was clamped, so the response and the audit row can both say so.
 */
export function clampBrightnessPercent(
  percent: number,
  allowBlack: boolean,
  floor: number = MIN_SAFE_BRIGHTNESS_PERCENT,
): { value: number; clamped: boolean } {
  if (allowBlack) return { value: percent, clamped: false };
  if (percent < floor) return { value: floor, clamped: true };
  return { value: percent, clamped: false };
}

// ─────────────────────────────────────────────────────────────────────
// Schedules
// ─────────────────────────────────────────────────────────────────────

/** "HH:MM", 24-hour, zero-padded. */
export const DISPLAY_TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

const DisplayTimeString = z.string().regex(DISPLAY_TIME_RE, 'Expected 24-hour "HH:MM"');
const DisplayDaysOfWeek = z
  .array(z.number().int().min(0).max(6))
  .min(1, 'Pick at least one day')
  .max(7)
  .refine((d) => new Set(d).size === d.length, 'Duplicate day');

/**
 * IANA timezone check. `Intl.DateTimeFormat` throws RangeError on an
 * unknown zone, which is a real validation rather than a regex that accepts
 * "Not/AZone". Node ships full ICU here.
 */
export function isValidIanaTimezone(tz: unknown): boolean {
  if (typeof tz !== 'string' || tz.length === 0 || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const DisplayTimezone = z.string().refine(isValidIanaTimezone, 'Unknown IANA timezone');

export const DisplayScheduleCreateSchema = z
  .object({
    screenId: z.string().min(1).max(128).optional(),
    screenGroupId: z.string().min(1).max(128).optional(),
    name: z.string().max(120).optional(),
    daysOfWeek: DisplayDaysOfWeek,
    /** Local wake time. */
    onTime: DisplayTimeString,
    /** Local blank time. onTime > offTime is a legal overnight window. */
    offTime: DisplayTimeString,
    timezone: DisplayTimezone,
    isActive: z.boolean().optional(),
  })
  .passthrough()
  .refine((b) => b.onTime !== b.offTime, {
    message: 'onTime and offTime must differ — an equal pair is an ambiguous 0h/24h window',
    path: ['offTime'],
  });
export type DisplayScheduleCreateInput = z.infer<typeof DisplayScheduleCreateSchema>;

export const DisplayScheduleUpdateSchema = z
  .object({
    name: z.string().max(120).nullish(),
    daysOfWeek: DisplayDaysOfWeek.optional(),
    onTime: DisplayTimeString.optional(),
    offTime: DisplayTimeString.optional(),
    timezone: DisplayTimezone.optional(),
    isActive: z.boolean().optional(),
  })
  .passthrough();
export type DisplayScheduleUpdateInput = z.infer<typeof DisplayScheduleUpdateSchema>;

/** The manifest's per-schedule shape. Stable, DB-sourced, no clock values. */
export interface DisplayScheduleManifestEntry {
  id: string;
  daysOfWeek: number[];
  onTime: string;
  offTime: string;
  timezone: string;
}

// ─────────────────────────────────────────────────────────────────────
// Vendor recipes
// ─────────────────────────────────────────────────────────────────────

/**
 * Recipe shape. Validated here for STRUCTURE only — the security boundary is
 * the player's native allowlist (sysfs canonicalized under
 * /sys/class/backlight or /sys/class/leds; allowlisted broadcast action
 * prefixes, no explicit component/package targeting; Settings.System only,
 * never Secure or Global; no shell execution, ever). A recipe that fails the
 * device-side allowlist is REJECTED WHOLE and logged, never partially
 * applied. Nothing here can widen that allowlist.
 */
const RecipeExtra = z
  .object({
    key: z.string().min(1).max(120),
    type: z.enum(['int', 'string', 'bool']),
    from: z.enum(['percent', 'literal']),
    value: z.union([z.string().max(200), z.number(), z.boolean()]).optional(),
    scale: z.tuple([z.number(), z.number()]).optional(),
  })
  .strict();

const RecipeBroadcast = z
  .object({
    kind: z.literal('broadcast'),
    action: z.string().min(1).max(200),
    extras: z.array(RecipeExtra).max(12).optional(),
  })
  .strict();

const RecipeSysfs = z
  .object({
    kind: z.literal('sysfs'),
    path: z.string().min(1).max(300),
    value: z.union([z.string().max(64), z.number()]).optional(),
    valueFrom: z.literal('percent').optional(),
    scale: z.tuple([z.number(), z.number()]).optional(),
  })
  .strict();

const RecipeSettings = z
  .object({
    kind: z.literal('settings'),
    key: z.string().min(1).max(120),
    valueFrom: z.literal('percent').optional(),
    value: z.union([z.string().max(64), z.number()]).optional(),
    scale: z.tuple([z.number(), z.number()]).optional(),
  })
  .strict();

const RecipeStep = z.discriminatedUnion('kind', [RecipeBroadcast, RecipeSysfs, RecipeSettings]);

export const DisplayVendorRecipeSchema = z
  .object({
    vendorId: z
      .string()
      .min(1)
      .max(60)
      .regex(/^[a-z0-9][a-z0-9-]*$/, 'kebab-case slug'),
    match: z
      .object({
        manufacturer: z.string().max(120).optional(),
        model: z.string().max(120).optional(),
        board: z.string().max(120).optional(),
      })
      .strict()
      .refine(
        (m) => !!(m.manufacturer || m.model || m.board),
        'match needs at least one of manufacturer / model / board',
      ),
    brightness: RecipeStep.optional(),
    blank: RecipeStep.optional(),
    wake: RecipeStep.optional(),
  })
  .strict()
  .refine(
    (r) => !!(r.brightness || r.blank || r.wake),
    'a recipe with no brightness/blank/wake does nothing',
  );
export type DisplayVendorRecipeDoc = z.infer<typeof DisplayVendorRecipeSchema>;

export const DisplayVendorRecipeUpsertSchema = z
  .object({
    name: z.string().min(1).max(120),
    recipe: DisplayVendorRecipeSchema,
    isActive: z.boolean().optional(),
    priority: z.number().int().min(-1000).max(1000).optional(),
    notes: z.string().max(1000).optional(),
  })
  .passthrough();
export type DisplayVendorRecipeUpsertInput = z.infer<typeof DisplayVendorRecipeUpsertSchema>;

// ─────────────────────────────────────────────────────────────────────
// Manifest block
// ─────────────────────────────────────────────────────────────────────

/**
 * The `display` block of the player manifest.
 *
 * EVERY FIELD MUST BE STABLE. No clock values, no "ms until next off", no
 * telemetry echo — this block is part of the ETag-hashed payload and is
 * stored verbatim in the per-screen manifest hot cache. One volatile field
 * here kills 304s fleet-wide and re-creates the 25 GB/mo Supabase egress the
 * cache was built to kill (CLAUDE.md → manifest content cache, rule 7).
 *
 * The player resolves "what time is it" itself; the server only says WHAT the
 * windows are.
 */
export interface DisplayManifestBlock {
  /** On/off windows the player arms as local AlarmManager alarms. */
  schedules: DisplayScheduleManifestEntry[];
  /** Server-tunable safety policy, so the floor can move without an APK. */
  brightness: {
    minSafePercent: number;
    /** Scheduled/automatic paths never blank the panel to 0. */
    allowBlack: false;
  };
  /**
   * The active recipe CATALOG, not a per-screen selection. The player picks
   * the row whose `match` block fits its own Build.* identity. Keeping the
   * choice on-device is what lets this block stay identical for every screen
   * in the fleet and independent of Screen.displayCapabilities.
   */
  vendorRecipes: Array<{ vendorId: string; priority: number; recipe: unknown }>;
}
