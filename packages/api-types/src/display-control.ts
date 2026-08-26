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

/**
 * ─────────────────────────────────────────────────────────────────────
 * MECHANISM VOCABULARY — THE DEVICE IS AUTHORITATIVE (contract C5)
 * ─────────────────────────────────────────────────────────────────────
 *
 * THE P0 THIS CLOSES (2026-08-13 verify wave, P0-2). Wave 2 changed
 * `DisplayCapabilityProbe.verdict()` to prefer the answer resolved by
 * `DisplayControlRegistry` — i.e. the id of the provider that ACTUALLY won
 * the chain on that box ("vendor-recipe", "sysfs-backlight", "screen-timeout"
 * …). The zod enums below still only accepted the older heuristic vocabulary,
 * so `POST /screens/:id/display-capabilities` 400'd on EVERY screen in the
 * fleet and no screen could ever self-describe. Every capability-gated
 * control then stayed on the unknown-verdict path forever.
 *
 * The resolution is that the DEVICE's provider-id vocabulary is the truth:
 * `DisplayControlRegistry` is what decides what the box can do, so its
 * provider ids are what the server must accept. These sets are therefore
 * derived from the Kotlin, and `display-mechanism-drift.spec.ts` in
 * apps/api PINS them against the real `override val id` constants and the
 * probe's own fallback literals — parsed out of the .kt files — so this
 * cannot silently drift again.
 *
 * Two sources feed each key, and BOTH are enumerated here:
 *   (a) the resolved provider id, from the `control.capabilities` section;
 *   (b) the probe's own raw heuristic literal, which is the fallback used
 *       when that section threw (`resolved?.optString(...) ?: <literal>`).
 * (b) is why brightness accepts BOTH 'sysfs-backlight' (the provider id) and
 * 'sysfs' (the heuristic literal) — they are different strings meaning the
 * same thing, and a box whose registry resolution threw emits the latter.
 *
 * ⚠️ ADDING A PROVIDER? Add its id here in the SAME commit, or the first
 * screen that resolves to it 400s its whole report. The drift spec fails
 * loudly if you forget.
 */

/** How volume can be driven. `AudioManagerProvider.id` + the probe fallback. */
export type DisplayVolumeMechanism = 'audiomanager' | 'none';
/**
 * How brightness can be driven, most-real first.
 * Chain: VendorRecipe → SysfsBacklight → SettingsBrightness → SoftwareDim.
 * 'sysfs' is the probe's heuristic literal for the same thing as
 * 'sysfs-backlight'; both are reachable, so both are accepted.
 */
export type DisplayBrightnessMechanism =
  | 'vendor-recipe'
  | 'sysfs-backlight'
  | 'sysfs'
  | 'settings'
  | 'software-dim';
/**
 * How the screen can be blanked/woken.
 * Chain: VendorRecipe → DeviceAdminBlank → ScreenTimeout → SoftwareDim.
 * 'device-owner' and 'none' are LEGACY values from the pre-wave-2 heuristic
 * vocabulary. They are kept accepted on purpose — refusing them would 400 a
 * whole report over a value that is already handled (`blankMechanism` maps
 * 'none' to the software floor, per C3), which is the exact failure this
 * section exists to prevent.
 */
export type DisplayBlankMechanism =
  | 'vendor-recipe'
  | 'device-admin'
  | 'screen-timeout'
  | 'software-dim'
  | 'device-owner'
  | 'none';
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
  /**
   * Which JS↔native transport the player reached the APK over.
   *
   * ⚠️ WHY THIS IS PERSISTED (2026-08-24). The APK marks EVERY caller on the
   * legacy every-frame `addJavascriptInterface` surface as untrusted, and
   * untrusted callers get only the recovery-direction subset — so SET_VOLUME
   * is refused outright there and SET_BRIGHTNESS only survives when RAISING.
   * The refusal comes back as a JSON string rather than an exception, so the
   * API still audits `delivered:true` and the dashboard still paints success.
   *
   * An operator dragged volume and brightness on a real screen for an hour
   * with every command "delivered" and nothing happening, and NOTHING
   * server-side recorded which transport that screen was on — the one fact
   * that separates "refused at the bridge" from "never arrived". Diagnosing it
   * required physically walking to the screen to read its log, which does not
   * scale past one box and is exactly what this product exists to avoid.
   *
   * 'none' is normal and expected for a browser player with no APK.
   */
  bridgeTransport: 'channel' | 'legacy' | 'none' | null;
}

export const DISPLAY_VOLUME_MECHANISMS = ['audiomanager', 'none'] as const;
export const DISPLAY_BRIGHTNESS_MECHANISMS = [
  'vendor-recipe',
  'sysfs-backlight',
  'sysfs',
  'settings',
  'software-dim',
] as const;
export const DISPLAY_BLANK_MECHANISMS = [
  'vendor-recipe',
  'device-admin',
  'screen-timeout',
  'software-dim',
  'device-owner',
  'none',
] as const;
export const DISPLAY_REBOOT_MECHANISMS = ['device-owner', 'none'] as const;
export const DISPLAY_HARD_POWER_OFF_MECHANISMS = [
  'serial-candidate',
  'none',
] as const;
export const DISPLAY_DEVICE_OWNER_PATHS = [
  'held',
  'blocked-other-owner',
  'provisionable-after-factory-reset',
] as const;

const VOLUME_MECHANISMS = DISPLAY_VOLUME_MECHANISMS;
const BRIGHTNESS_MECHANISMS = DISPLAY_BRIGHTNESS_MECHANISMS;
const BLANK_MECHANISMS = DISPLAY_BLANK_MECHANISMS;
const REBOOT_MECHANISMS = DISPLAY_REBOOT_MECHANISMS;
const HARD_POWER_OFF_MECHANISMS = DISPLAY_HARD_POWER_OFF_MECHANISMS;
const DEVICE_OWNER_PATHS = DISPLAY_DEVICE_OWNER_PATHS;

/**
 * Pick EXACTLY the six known verdict keys, each coerced to a known
 * mechanism, and drop everything else.
 *
 * WHY THIS EXISTS (2026-08-13 review, P1). The report schema keeps
 * `.passthrough()` on `verdict` so a newer APK that adds a seventh key is
 * ACCEPTED rather than 400'd — but the persisted document is read live on
 * every manifest poll (`screen.findUnique` with the full row, outside the
 * manifest hot cache). Persisting the verdict verbatim therefore let any
 * paired screen park megabytes in `Screen.displayCapabilities` and turn its
 * own 5 s poll into a fleet-scale Supabase egress bill — the exact bug class
 * the manifest cache was built to kill. Validation stays permissive at the
 * door; STORAGE is bounded here, by construction.
 *
 * Every fallback is the LEAST capable value, so a malformed or truncated
 * document degrades toward "we cannot drive this", never toward permissive.
 */
export function normalizeVerdict(raw: unknown): DisplayCapabilityVerdict {
  const v = (
    raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  ) as Record<string, unknown>;
  const pick = <T extends string>(
    key: string,
    allowed: readonly T[],
    fallback: T,
  ): T => {
    const got = v[key];
    return typeof got === 'string' && (allowed as readonly string[]).includes(got)
      ? (got as T)
      : fallback;
  };
  return {
    volume: pick('volume', VOLUME_MECHANISMS, 'none'),
    brightness: pick('brightness', BRIGHTNESS_MECHANISMS, 'software-dim'),
    screenBlank: pick('screenBlank', BLANK_MECHANISMS, 'none'),
    reboot: pick('reboot', REBOOT_MECHANISMS, 'none'),
    hardPowerOff: pick('hardPowerOff', HARD_POWER_OFF_MECHANISMS, 'none'),
    deviceOwnerPath: pick(
      'deviceOwnerPath',
      DEVICE_OWNER_PATHS,
      'provisionable-after-factory-reset',
    ),
  };
}

/**
 * READ a stored `Screen.displayCapabilities` document back into a verdict.
 *
 * THIS IS THE ONE DEFINITION OF "does this screen have a verdict?" and every
 * consumer must call it — the API's gate (`displayActionSupport`), the
 * manifest/controller read paths, and the DASHBOARD resolver
 * (`apps/web/src/components/screens/display-capabilities.ts`). It lives in
 * the shared contract for exactly one reason: it used to exist twice with
 * DIFFERENT rules, and the two disagreed in the risk direction.
 *
 * THE DIVERGENCE THIS CLOSES (2026-08-14 sweep, P2 from the wire-verify
 * wave). The server required all four of volume/brightness/screenBlank/reboot
 * inside a `{ verdict: … }` envelope; the dashboard's own parser returned a
 * verdict when ANY ONE axis parsed, and also accepted a bare (un-enveloped)
 * verdict object. So for a document like `{ verdict: { volume:'audiomanager' } }`
 * the panel rendered an ENABLED Blank button while the API refused BLANK with
 * DISPLAY_CAPABILITIES_UNKNOWN — a 100%-failure control, which is the precise
 * defect the whole capability-gating wave was written to kill. Not reachable
 * from an API-written row today (the schema + `normalizeVerdict` always fill
 * all six keys), but a hand-seeded, migrated, or second-writer row makes it
 * live, and there was no test that would have caught it: the anti-drift spec
 * fed the DASHBOARD's parser into the SERVER's gate, so the one place the two
 * ends really disagreed passed silently.
 *
 * Tolerant by design in every OTHER respect: this reads a column written by a
 * device, on a path that gates operator UI, so a malformed/legacy document
 * must degrade to "we know nothing" (recovery-only controls) rather than
 * throw or — far worse — be coerced into a permissive verdict.
 */
export function readStoredDisplayVerdict(
  stored: unknown,
): DisplayCapabilityVerdict | null {
  if (!stored || typeof stored !== 'object' || Array.isArray(stored))
    return null;
  const v = (stored as { verdict?: unknown }).verdict;
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const rec = v as Record<string, unknown>;
  const str = (k: string): string | null =>
    typeof rec[k] === 'string' && rec[k] !== '' ? (rec[k] as string) : null;
  const volume = str('volume');
  const brightness = str('brightness');
  const screenBlank = str('screenBlank');
  const reboot = str('reboot');
  if (!volume || !brightness || !screenBlank || !reboot) return null;
  return {
    volume,
    brightness,
    screenBlank,
    reboot,
    hardPowerOff: str('hardPowerOff') ?? 'none',
    deviceOwnerPath:
      str('deviceOwnerPath') ?? 'provisionable-after-factory-reset',
  } as DisplayCapabilityVerdict;
}

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

/**
 * ── THE BLANK/POWER SPLIT (field incident night, 2026-08-25) ───────────
 *
 * Operator contract, verbatim: *"wake and blank should just do that and turn
 * on and off should do that, keep them separate and make them work perfectly
 * on all our models."*
 *
 * BLANK / WAKE are now the SOFT pair: a black composition-layer overlay
 * drawn by the player's own web page. No hardware mechanism is consulted, no
 * device-admin lock is taken, no vendor power node is written — so BLANK is
 * unbrickable BY CONSTRUCTION on every model, including a browser player, and
 * WAKE always reverses it.
 *
 * POWER_OFF / POWER_ON are the HARD pair: they genuinely drive the panel, and
 * they are gated on an ALLOWLIST of mechanisms proven to round-trip on real
 * hardware (see DISPLAY_POWER_PROVEN_MECHANISMS).
 *
 * ⚠️ POWER_OFF/POWER_ON DO NOT REACH THE DEVICE UNDER THESE NAMES. Every APK
 * in the field understands exactly five action verbs, so the server
 * TRANSLATES a power action onto the legacy frame — POWER_OFF → 'BLANK' with
 * `hard: true`, POWER_ON → 'WAKE' with `hard: true`. `org.json` opt* parsing
 * ignores the extra field, so an old APK behaves exactly as it does today.
 * The AUDIT ROW always records the real requested action.
 */
export const DISPLAY_ACTIONS = [
  'SET_VOLUME',
  'SET_BRIGHTNESS',
  'BLANK',
  'WAKE',
  'REBOOT',
  'POWER_OFF',
  'POWER_ON',
  // ── 2026-08-25 (v1.1.6) — NOT A DISPLAY MECHANISM ────────────────────
  // Raises the first-boot setup checklist ON the panel. It rides this
  // endpoint rather than a new one because everything it needs already
  // exists here and nowhere else: the same operator RBAC, the same
  // throttle, the same AuditLog row, the same signed per-screen fan-out,
  // the same per-eventId dedup on the device, and the same per-command
  // outcome ring that tells the operator whether it landed.
  //
  // ⚠️ IT TOUCHES NO HARDWARE, so it is deliberately outside every rule
  // this file exists to enforce: it is never gated on a capability
  // verdict (there is nothing to verify), it is never `soft`/`hard`, it
  // carries no percent and no revert, and `isDarkeningAction` must keep
  // answering false for it — an operator finishing setup on a panel is
  // not a reason to consult emergency state.
  //
  // ⚠️ AND IT DOES NOT REACH `displayApply`. The APK's display vocabulary
  // is still exactly five verbs; the web player routes this one to the
  // dedicated `openSetupChecklist` bridge method instead (see
  // apps/web/src/app/player/displayControl.ts).
  'OPEN_SETUP',
] as const;
export type DisplayActionType = (typeof DISPLAY_ACTIONS)[number];

/**
 * Mechanism string recorded for [DISPLAY_ACTIONS]' `OPEN_SETUP`.
 *
 * Not a probe verdict value, for the same reason DISPLAY_SOFT_BLANK_MECHANISM
 * is not: nothing about the hardware was consulted. The audit row, the API
 * response and the WS payload all carry this string so "was this a display
 * action at all?" is a one-field answer in the forensic log.
 */
export const DISPLAY_SETUP_MECHANISM = 'setup-checklist' as const;

/**
 * The mechanism recorded for a SOFT blank/wake.
 *
 * Not a probe verdict value on purpose: the whole point is that BLANK/WAKE no
 * longer resolve against the hardware at all. Audit rows, the API response
 * and the WS payload all carry this string so "was this blank soft?" is a
 * one-field answer in the forensic log.
 */
export const DISPLAY_SOFT_BLANK_MECHANISM = 'web-overlay' as const;

/**
 * Hard power mechanisms PROVEN to round-trip on real hardware.
 *
 * `vendor-recipe` only: a vendor recipe is a direct write to a named
 * backlight/power node (e.g. TC22's writable `bl_power`), and the WAKE step
 * writes the SAME node back. The panel never enters a vendor standby state
 * whose exit is controlled by the vendor's own firmware, which is the exact
 * failure mode the admin-lock family exhibits (below).
 *
 * A hardware model rejoins this list only after a supervised on-site
 * round-trip test, never from anything the probe can infer.
 */
export const DISPLAY_POWER_PROVEN_MECHANISMS = ['vendor-recipe'] as const;

/**
 * ── THE BRIGHTNESS SPLIT (field evidence, 2026-08-25) ─────────────────
 *
 * Brightness mechanisms PROVEN to move the actual backlight, from each
 * panel's OWN hardware probe (`ScreenDeviceInventory.report.backlightNodes`)
 * cross-checked against what the operator saw on the glass:
 *
 *   M43      /sys/class/backlight/aml-bl   writable:true   → sysfs-backlight  WORKS
 *   L55VEC   /sys/class/backlight/aml-bl   writable:true   → sysfs-backlight  WORKS
 *   G43      /sys/class/backlight/aml-bl   writable:false  → settings         DEAD
 *   A-Frame  /sys/class/backlight/backlight writable:false → settings         DEAD
 *
 * All four report `canWriteSettings: true` and `windowBrightnessAvailable:
 * true`, and the `settings` write genuinely SUCCEEDS at the API level — G43's
 * stored `screen_brightness` reads 102, not 255. The vendor firmware simply
 * ignores that value for the real backlight. So `settings` is a mechanism
 * that reports success and does nothing to the glass: the same failure shape
 * as the blank incident, and the reason brightness now gets the same soft
 * fallback that BLANK got.
 *
 * The list is an ALLOWLIST, not a denylist, for the reason
 * DISPLAY_POWER_PROVEN_MECHANISMS is: "we have not observed it working" and
 * "it works" are different claims, and only the first one is safe to assume.
 *
 *  • `vendor-recipe` — a direct write to a named backlight node, authored
 *    per hardware class and validated by `displayRecipeBrightnessIssue`
 *    (percent-derived, minimum scale span). Same class of evidence as the
 *    proven power path.
 *  • `sysfs-backlight` / `sysfs` — a writable `/sys/class/backlight/*`
 *    node. Two spellings of ONE thing: the provider id and the probe's
 *    heuristic-fallback literal (see the C5 note at the top of this file).
 *    Omitting the second would silently drop every box whose registry
 *    resolution threw back onto the soft path.
 *
 * NOT proven, and therefore soft: `settings` (writes succeed, backlight
 * ignores them on this hardware class) and `software-dim` (which is the soft
 * path by definition).
 *
 * A mechanism joins this list only from observed behaviour on real glass,
 * never from anything the probe infers about itself.
 */
export const DISPLAY_BRIGHTNESS_PROVEN_MECHANISMS = [
  'vendor-recipe',
  'sysfs-backlight',
  'sysfs',
] as const;

/**
 * The mechanism recorded for a SOFT brightness change.
 *
 * Unlike the soft BLANK — which got its own `web-overlay` word because no
 * probe verdict describes it — a soft dim IS software dimming, and
 * `software-dim` is already the contract's name for that. Reusing it keeps
 * the audit vocabulary closed over `DISPLAY_BRIGHTNESS_MECHANISMS`; the audit
 * row carries `softDim: true` plus `reportedMechanism` alongside it so the
 * forensic trail still distinguishes "this panel's own SoftwareDimProvider"
 * from "we routed around a mechanism that lies".
 */
export const DISPLAY_SOFT_DIM_MECHANISM = 'software-dim' as const;

const BRIGHTNESS_PROVEN: readonly string[] = DISPLAY_BRIGHTNESS_PROVEN_MECHANISMS;

/**
 * Will this brightness mechanism actually move the backlight?
 *
 * `false` routes SET_BRIGHTNESS onto the soft path (a dim overlay drawn by
 * the player's own page), which works identically on every model including a
 * browser player. Unknown / absent is `false` — fail toward the path that
 * provably does something.
 */
export function isBrightnessMechanismProven(
  mechanism: string | null | undefined,
): boolean {
  return typeof mechanism === 'string' && BRIGHTNESS_PROVEN.includes(mechanism);
}

/**
 * The admin-lock family — hard, and NOT proven reversible on command.
 *
 * FIELD EVIDENCE (2026-08-25). Four panels, three different outcomes from the
 * same `device-admin` verdict:
 *   • L55VEC (device-admin, provisionable) — panel shut down on blank, WAKE
 *     recovered it.
 *   • G43 (device-admin, blocked-other-owner) — latched into vendor standby:
 *     glass dark, IR remote AND the physical power button dead, WAKE
 *     delivered and useless. Recovered only by pulling mains.
 *   • Mobile A-Frame (device-admin, provisionable — verdict IDENTICAL to the
 *     recovering L55VEC) — latched the same way as the G43… and then, minutes
 *     later, WOKE ITSELF back up with no command sent.
 *
 * That last observation is why this family is refused in the darkening
 * direction rather than merely warned about: on this hardware the standby
 * state is driven by the VENDOR'S OWN TIMER, so it is unreliable in BOTH
 * directions — it will not wake when told to, and it will not stay dark when
 * told to. A control that does neither thing on command is not a control.
 */
export const DISPLAY_POWER_UNPROVEN_MECHANISMS = [
  'device-admin',
  'device-owner',
] as const;

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

/**
 * The signed `DISPLAY_CONTROL` payload, exactly as `DisplayService.dispatch`
 * emits it and the player must consume it.
 *
 * DECLARED HERE ON PURPOSE (2026-08-13 verify wave). P0-1 was that the player
 * bundle has no handler for this message at all, and P0-3 was two ends
 * spelling one field name differently. Both are the same defect — a wire
 * contract that existed only as an object literal at the sending end. Typing
 * it once, in the package BOTH ends import, is what makes the next mismatch a
 * compile error instead of a silent no-op on a wall-mounted screen.
 *
 * NOTE `issuedAt` rides HERE and never in the manifest: it is a per-request
 * clock value, and one of those in the manifest kills 304s fleet-wide
 * (CLAUDE.md manifest-cache rule 7).
 */
export interface DisplayControlWsPayload {
  screenId: string;
  /** Idempotency key — the player MUST de-duplicate on this (replayed WS). */
  actionId: string;
  /**
   * The verb ON THE WIRE, which is not always the verb the operator asked
   * for: a POWER_OFF ships as `'BLANK'` + `hard:true` so the five-verb APKs
   * already in the field understand it. The audit row carries the REAL
   * requested action; this field carries what the device will parse.
   */
  action: DisplayActionType;
  /** Already clamped by the server. 0..100, or null for BLANK/WAKE/REBOOT. */
  percent: number | null;
  /** Dead-man revert window, or null for a scheduled/permanent action. */
  revertAfterMs: number | null;
  allowBlack: boolean;
  /** The mechanism the SERVER expects; advisory — the device re-resolves. */
  mechanism: string;
  /** ISO-8601, server clock. Advisory/forensic only. */
  issuedAt: string;
  /**
   * SOFT frame. The player's WEB PAGE handles it with its own full-viewport
   * black overlay, and MUST NOT forward it to the APK bridge.
   *
   * Three verbs can arrive soft:
   *   • BLANK / WAKE — always. Forwarding one re-fires the device-admin lock,
   *     i.e. the whole 2026-08-25 incident.
   *   • SET_BRIGHTNESS — only when the panel's resolved brightness mechanism
   *     is NOT in DISPLAY_BRIGHTNESS_PROVEN_MECHANISMS. `percent` then names
   *     the DIM LEVEL the overlay renders rather than a backlight value.
   *     Forwarding one would hand it to a mechanism the field proved is a
   *     silent no-op on that hardware class.
   *
   * A brightness frame WITHOUT this flag is a real hardware write and is
   * forwarded to the bridge exactly as before.
   */
  soft?: true;
  /**
   * HARD frame (POWER_OFF / POWER_ON, translated onto the legacy verb). The
   * player forwards it to the APK bridge untouched. Old APKs ignore the extra
   * key (org.json opt* parsing), so this is additive on-device.
   */
  hard?: true;
}

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
  .passthrough()
  /**
   * `allowBlack` is the ONE flag that can deliberately black a panel nobody
   * can reach, and the dead-man revert is the thing that makes it
   * survivable. The API is the only place that can enforce the conjunction —
   * the player cannot invent a revert window the operator never sent — so a
   * UI bug, a replayed curl or an operator experimenting can no longer mint
   * a PERMANENT blackout whose only recovery is a second successful WS
   * delivery. Every other path stays at or above the 5% floor via
   * clampBrightnessPercent.
   */
  .refine((b) => b.allowBlack !== true || typeof b.revertAfterMs === 'number', {
    message:
      'allowBlack requires revertAfterMs — a deliberate blackout must carry a dead-man revert window',
    path: ['revertAfterMs'],
  });
export type DisplayControlActionInput = z.infer<typeof DisplayControlActionSchema>;

/**
 * Which verdict field gates each action.
 *
 * ⚠️ `screenBlank` IS A HISTORICAL KEY NAME. Since the 2026-08-25 split it no
 * longer gates BLANK at all (BLANK is soft and ungated); it is the slot where
 * the probe reports the panel's resolved HARD blank/power mechanism, which is
 * what POWER_OFF / POWER_ON are gated on. Renaming it would mean re-cutting
 * the probe, the drift spec and every stored `Screen.displayCapabilities` row
 * in the fleet, so the name stays and this comment carries the meaning.
 */
export const DISPLAY_ACTION_CAPABILITY: Record<
  DisplayActionType,
  keyof DisplayCapabilityVerdict
> = {
  SET_VOLUME: 'volume',
  SET_BRIGHTNESS: 'brightness',
  BLANK: 'screenBlank',
  WAKE: 'screenBlank',
  REBOOT: 'reboot',
  POWER_OFF: 'screenBlank',
  POWER_ON: 'screenBlank',
  // OPEN_SETUP drives no hardware, so no verdict field gates it. The map is
  // an exhaustive Record and every action needs an entry; `deviceOwnerPath`
  // is the one key that is pure metadata (a provisioning FACT, never a
  // mechanism), so naming it here cannot be mistaken for a gate the way
  // 'screenBlank' or 'brightness' could. Nothing reads this entry — see
  // `displayActionSupport`, which answers `supported: true` before any
  // verdict lookup happens.
  OPEN_SETUP: 'deviceOwnerPath',
};

/** Refusal codes. Stable strings — the dashboard keys its copy off these. */
export const DISPLAY_REFUSAL_CODES = {
  /** The screen has never reported, and the action is not a recovery action. */
  UNKNOWN: 'DISPLAY_CAPABILITIES_UNKNOWN',
  /** The reported verdict has no mechanism for this action. */
  UNSUPPORTED: 'DISPLAY_ACTION_UNSUPPORTED',
  /** Reboot specifically — see the NO-DEVICE-OWNER note below. */
  REBOOT_UNAVAILABLE: 'DISPLAY_REBOOT_UNAVAILABLE',
  /** allowBlack without a dead-man revert window. */
  ALLOW_BLACK_REQUIRES_REVERT: 'DISPLAY_ALLOW_BLACK_REQUIRES_REVERT',
  /**
   * @deprecated SUPERSEDED 2026-08-25 by the blank/power split — nothing
   * raises it any more, because BLANK no longer touches hardware at all on
   * ANY panel, foreign-owner or not. The string stays EXPORTED because
   * AuditLog rows written during the incident window reference it verbatim
   * and AuditLog is append-only; deleting the constant would leave those rows
   * pointing at a code with no definition anywhere in the tree.
   *
   * History: BLANK whose only mechanism was a device-admin lock on a panel
   * where ANOTHER app is device/profile owner (G43). The lock latched the
   * vendor firmware into panel standby while the Android board stayed online;
   * WAKE delivered but could not reverse it.
   */
  BLANK_ADMIN_LOCK_FOREIGN_OWNER: 'DISPLAY_BLANK_ADMIN_LOCK_FOREIGN_OWNER',
  /**
   * POWER_OFF via a mechanism not PROVEN to round-trip on real hardware.
   *
   * Field night 2026-08-25: two panels with IDENTICAL verdicts (device-admin,
   * provisionable owner path) behaved oppositely — the L55VEC woke back up,
   * the Mobile A-Frame latched into standby (glass dark, IR remote dead,
   * mains-pull required), same as the G43 an hour earlier. Then the A-Frame
   * woke ITSELF several minutes later with nothing sent to it. So the standby
   * this mechanism produces is driven by the vendor's own firmware timer and
   * is unreliable in BOTH directions: it will not come back when commanded,
   * and it will not stay dark when commanded.
   *
   * Recoverability is therefore per-vendor-firmware and NOT predictable from
   * anything we probe, so the hardware POWER-OFF direction runs on an
   * ALLOWLIST (DISPLAY_POWER_PROVEN_MECHANISMS) rather than a denylist. Note
   * this refusal costs the operator nothing they need: BLANK still darkens
   * the glass on this panel, softly and reversibly.
   */
  BLANK_MECHANISM_UNPROVEN: 'DISPLAY_BLANK_MECHANISM_UNPROVEN',
} as const;

/**
 * Composition-level (SOFT) mechanisms: they darken at the Android/web
 * composition layer and cannot touch panel or backlight power.
 *
 * ⚠️ NO LONGER A GATE (2026-08-25). BLANK does not consult any mechanism now
 * — it is universally soft via the player's own web overlay, which is safer
 * still than either of these (it never even reaches the APK). Kept exported
 * as the shared vocabulary of "cannot possibly power a panel", which is what
 * the POWER_OFF unsupported branch uses to explain itself.
 */
export const DISPLAY_BLANK_SAFE_MECHANISMS = [
  'software-dim',
  'screen-timeout',
] as const;

/**
 * The floor a brightness request must clear to count as RECOVERY on a screen
 * that has never reported its capabilities.
 *
 * We cannot know a screen's current brightness from the server, so "is this
 * an increase?" is unanswerable. What IS answerable is "does this request
 * provably leave the panel clearly legible?" — and at or above this value it
 * does, whichever direction it moved. That is the whole safety property the
 * unknown-verdict gate needs: an operator can always drag the slider up and
 * see the screen again, and can never darken hardware we have not observed.
 */
export const DISPLAY_RECOVERY_MIN_BRIGHTNESS_PERCENT = 50;

export type DisplayActionSupport =
  | { supported: true; mechanism: string; note?: string }
  | { supported: false; code: string; message: string };

/**
 * The HARD blank/power mechanism the probe resolved for this panel.
 *
 * Used by POWER_OFF / POWER_ON only. BLANK and WAKE no longer call it — they
 * are soft (see DISPLAY_SOFT_BLANK_MECHANISM).
 */
function blankMechanism(
  verdict: DisplayCapabilityVerdict | null | undefined,
): string {
  const m = verdict?.screenBlank;
  return m && m !== 'none' ? m : 'software-dim';
}

const POWER_PROVEN: readonly string[] = DISPLAY_POWER_PROVEN_MECHANISMS;
const POWER_UNPROVEN: readonly string[] = DISPLAY_POWER_UNPROVEN_MECHANISMS;

/**
 * THE capability gate. Pure, so the API, the dashboard and the tests all
 * reach the same verdict from the same input.
 *
 * ── THE TWO RULES (lead decision, 2026-08-13) ────────────────────────────
 *
 * C3. BLANK and WAKE ARE ALWAYS AVAILABLE, on every box, because the
 *     software floor (window brightness + a full-screen overlay) can never
 *     fail. `screenBlank: 'none'` means "no PRIVILEGED blank" — no device
 *     admin, no device owner — not "cannot blank". Refusing WAKE on that
 *     verdict was the bug: a schedule blanks the panel through the software
 *     floor at 22:00 and the operator can then never light it again from
 *     the dashboard. The verdict names the MECHANISM, never the
 *     availability.
 *
 *     ── C3 EXTENDED (2026-08-25 split): BLANK is now ALWAYS AVAILABLE on an
 *     UNKNOWN verdict too. Under the old rule BLANK was risk-direction and
 *     needed an observed verdict, because it could reach real hardware. It
 *     cannot any more — a soft blank is a black `<div>` in the player's own
 *     page, identical on a probed panel, an unprobed panel and a browser
 *     tab, and WAKE removes it. There is no hardware left to fail-close
 *     against, so gating it only produced a dead button. The RISK actions
 *     that still need an observed verdict are SET_VOLUME, REBOOT, any
 *     allowBlack request — and POWER_OFF, which is where the hardware went.
 *
 * C4. FAIL-OPEN FOR RECOVERY, FAIL-CLOSED FOR RISK. A screen that has never
 *     reported still receives and executes schedule blanks (the manifest
 *     does not consult the verdict), so "unknown ⇒ nothing works" produced a
 *     dark screen with no way to light it — a truck roll on a wall mount,
 *     the worst outcome in this feature. So on a null verdict:
 *       • WAKE and POWER_ON are ACCEPTED (they can only ever make a dark
 *         screen visible);
 *       • BLANK is ACCEPTED — it is soft, so there is no hardware to be
 *         careful about (see the C3-extended note above);
 *       • SET_BRIGHTNESS is ACCEPTED at or above
 *         DISPLAY_RECOVERY_MIN_BRIGHTNESS_PERCENT, for the same reason;
 *       • POWER_OFF, SET_VOLUME, REBOOT and any allowBlack request are
 *         REFUSED until the screen reports — we do not fire risk at hardware
 *         whose surface we have not observed.
 *
 * NO DEVICE OWNER (product decision, 2026-08-13). We do not provision this
 * app as Android device owner, so on today's fleet `reboot` is 'none' and
 * REBOOT is genuinely unavailable — refused with its OWN code and a reason
 * an operator can act on, never a generic "unsupported". It lights up
 * unchanged the day a manufacturer preinstalls us as a platform-signed app.
 */
export function displayActionSupport(
  action: DisplayActionType,
  verdict: DisplayCapabilityVerdict | null | undefined,
  opts?: { percent?: number; allowBlack?: boolean },
): DisplayActionSupport {
  const known = !!verdict;
  const allowBlack = opts?.allowBlack === true;

  // allowBlack is the one flag that can deliberately black an unreachable
  // panel. It is never accepted against unobserved hardware.
  if (allowBlack && !known) {
    return {
      supported: false,
      code: DISPLAY_REFUSAL_CODES.UNKNOWN,
      message:
        'This screen has not reported its display capabilities yet, so it cannot be blacked out. Wake it or raise its brightness first.',
    };
  }

  switch (action) {
    // ── NOT A DISPLAY ACTION AT ALL — never gated (2026-08-25, v1.1.6) ──
    // Raises the setup checklist on the panel. There is no mechanism to
    // verify and no hardware to be careful about, so gating it on a verdict
    // would only make it useless on the ONE population that needs it: a
    // freshly-paired panel that has not reported yet.
    //
    // (The `allowBlack && !known` guard above still runs, and that is
    // correct: `allowBlack` on OPEN_SETUP is a nonsense request, and a
    // nonsense request being refused on an unreported screen costs nothing.
    // No caller sends it — the dashboard's button posts the action alone.)
    case 'OPEN_SETUP':
      return { supported: true, mechanism: DISPLAY_SETUP_MECHANISM };

    // ── the SOFT pair: unbrickable by construction, so ungated ─────────
    // Neither of these consults `verdict.screenBlank` any more. The player's
    // web page draws (BLANK) or removes (WAKE) a black full-viewport overlay
    // and never calls the native bridge, so the outcome is identical on every
    // model — including a screen that has never reported and a browser player
    // with no APK at all.
    case 'BLANK':
    case 'WAKE':
      return {
        supported: true,
        mechanism: DISPLAY_SOFT_BLANK_MECHANISM,
        note:
          action === 'BLANK'
            ? 'Covers the screen with black in the player itself. The panel stays powered, an emergency alert still punches through, and Wake always reverses it.'
            : undefined,
      };

    // ── the HARD pair: real panel power, allowlisted ───────────────────
    // POWER_ON is the RECOVERY direction and is never refused on the
    // unproven code — exactly the C3/C4 asymmetry WAKE has always had. A
    // panel that is genuinely dark (vendor timer, someone's remote, an
    // earlier hard blank) must always have a dashboard path back.
    case 'POWER_ON':
      return {
        supported: true,
        mechanism: blankMechanism(verdict),
        note: known
          ? undefined
          : 'This screen has not reported its capabilities yet — turning it on uses whatever wake path the player finds.',
      };

    case 'POWER_OFF': {
      if (!known) {
        return {
          supported: false,
          code: DISPLAY_REFUSAL_CODES.UNKNOWN,
          message:
            'This screen has not reported its display capabilities yet, so its panel cannot be powered off. Blank covers the screen with black in the meantime, and Wake always brings it back.',
        };
      }
      const mech = verdict!.screenBlank;
      if (POWER_PROVEN.includes(mech)) {
        return { supported: true, mechanism: mech };
      }
      if (POWER_UNPROVEN.includes(mech)) {
        return {
          supported: false,
          code: DISPLAY_REFUSAL_CODES.BLANK_MECHANISM_UNPROVEN,
          message:
            'Turning this panel off is disabled: the only power path this model exposes is an Android device-admin lock, and on this hardware that lock is unreliable in both directions — on 2026-08-25 two panels (a Goodview G43 and a Mobile A-Frame) latched into a vendor standby that ignored Wake and needed a mains power-cycle, and the A-Frame then woke itself back up minutes later with nothing sent to it. It comes back for this model after a supervised on-site off/on test. Blank still darkens the screen safely, and Wake always reverses it.',
        };
      }
      return {
        supported: false,
        code: DISPLAY_REFUSAL_CODES.UNSUPPORTED,
        message:
          verdict!.hardPowerOff === 'serial-candidate'
            ? 'This panel exposes no remote power control the player can drive. It has a serial port that might accept a vendor power command, but nothing has been proven on this model yet. Use Blank to darken the screen.'
            : 'This panel exposes no remote power control — the only thing the player can do here is cover the screen with black. Use Blank instead.',
      };
    }

    case 'SET_BRIGHTNESS': {
      // The brightness type has no 'none' member: the software floor always
      // exists, so brightness always resolves once we have a verdict.
      if (known) return { supported: true, mechanism: verdict!.brightness };
      const percent = opts?.percent;
      if (
        typeof percent === 'number' &&
        percent >= DISPLAY_RECOVERY_MIN_BRIGHTNESS_PERCENT
      ) {
        return {
          supported: true,
          mechanism: 'software-dim',
          note: 'This screen has not reported its capabilities yet — only brightness increases are accepted.',
        };
      }
      return {
        supported: false,
        code: DISPLAY_REFUSAL_CODES.UNKNOWN,
        message: `This screen has not reported its display capabilities yet. Until it does, brightness can only be raised (${DISPLAY_RECOVERY_MIN_BRIGHTNESS_PERCENT}% or more).`,
      };
    }

    case 'SET_VOLUME':
      if (!known) {
        return {
          supported: false,
          code: DISPLAY_REFUSAL_CODES.UNKNOWN,
          message:
            'This screen has not reported its display capabilities yet. Volume stays disabled until it does.',
        };
      }
      if (verdict!.volume === 'none') {
        return {
          supported: false,
          code: DISPLAY_REFUSAL_CODES.UNSUPPORTED,
          message: 'This screen exposes no volume control.',
        };
      }
      return { supported: true, mechanism: verdict!.volume };

    case 'REBOOT':
      if (!known) {
        return {
          supported: false,
          code: DISPLAY_REFUSAL_CODES.UNKNOWN,
          message:
            'This screen has not reported its display capabilities yet. Reboot stays disabled until it does.',
        };
      }
      if (verdict!.reboot === 'none') {
        return {
          supported: false,
          code: DISPLAY_REFUSAL_CODES.REBOOT_UNAVAILABLE,
          message:
            'Remote reboot is not available on this screen. Android exposes it only to a device-owner or platform-signed app, and this fleet is neither. Power-cycle it at the panel.',
        };
      }
      return { supported: true, mechanism: verdict!.reboot };

    default: {
      // Exhaustiveness guard: a new action added to DISPLAY_ACTIONS without
      // a case here refuses rather than falling through to permissive.
      const unreachable: never = action;
      return {
        supported: false,
        code: DISPLAY_REFUSAL_CODES.UNSUPPORTED,
        message: `Unknown display action (${String(unreachable)}).`,
      };
    }
  }
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

/** UTC is a legal zone everywhere but is absent from supportedValuesOf. */
const DISPLAY_EXTRA_TIMEZONES = new Set(['UTC']);

let supportedZoneCache: Set<string> | null | undefined;

/** `Intl.supportedValuesOf` is Node 18+/Safari 15.4+; treat absence as "unknown". */
function supportedZones(): Set<string> | null {
  if (supportedZoneCache !== undefined) return supportedZoneCache;
  try {
    const fn = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] })
      .supportedValuesOf;
    supportedZoneCache = typeof fn === 'function'
      ? new Set(fn.call(Intl, 'timeZone'))
      : null;
  } catch {
    supportedZoneCache = null;
  }
  return supportedZoneCache;
}

/**
 * IANA timezone check — must be resolvable by BOTH runtimes that read it.
 *
 * THE BUG THIS CLOSES (2026-08-13 review, P2). `new Intl.DateTimeFormat(…,
 * {timeZone})` alone ACCEPTS the non-region legacy ids — 'EST', 'MST',
 * 'HST', 'PST8PDT', 'EST5EDT' — none of which appear in
 * `Intl.supportedValuesOf('timeZone')`. The row would store and the manifest
 * would ship, but on the device java.time's single-argument
 * `ZoneId.of("EST")` THROWS (those ids are reachable only through the
 * two-argument `ZoneId.of(id, ZoneId.SHORT_IDS)` overload), so the alarm for
 * that window is never armed and the screen silently never blanks — or never
 * wakes — on a box nobody can reach. This contract is shared, so the
 * validation belongs here rather than in a defensive try/catch on the player.
 *
 * Primary check is membership in `Intl.supportedValuesOf('timeZone')` (the
 * canonical IANA set both runtimes agree on) plus an explicit 'UTC'. On a
 * runtime without that API we fall back to the old ICU parse PLUS a
 * `Region/City` shape requirement, which rejects every legacy id above
 * because none of them contains a '/'.
 */
export function isValidIanaTimezone(tz: unknown): boolean {
  if (typeof tz !== 'string' || tz.length === 0 || tz.length > 64) return false;
  if (DISPLAY_EXTRA_TIMEZONES.has(tz)) return true;

  const zones = supportedZones();
  if (zones) return zones.has(tz);

  // Fallback path: ICU must resolve it AND it must be Region/City shaped.
  if (!/^[A-Za-z][A-Za-z0-9_+-]*\/[A-Za-z0-9_/+-]+$/.test(tz)) return false;
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

/**
 * The manifest's per-schedule shape. Stable, DB-sourced, no clock values.
 *
 * `scope` records WHY this row is in the block after precedence was applied
 * server-side: a screen-level window SUPPRESSES its group's windows entirely
 * (see resolveSchedulePrecedence in apps/api/src/display/display-manifest.ts).
 * Without that rule the builder concatenated both and the player armed both,
 * so a per-screen "late event until 23:30" row silently lost to the group's
 * 22:00 blank — the board went dark 90 minutes into the event with the
 * operator believing the override had taken. The player does not have to act
 * on `scope`; it exists so the resolved precedence is visible rather than
 * implied. (org.json ignores unknown keys, so this is additive on-device.)
 */
export interface DisplayScheduleManifestEntry {
  id: string;
  daysOfWeek: number[];
  onTime: string;
  offTime: string;
  timezone: string;
  scope: 'screen' | 'group';
}

// ─────────────────────────────────────────────────────────────────────
// Vendor recipes
// ─────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────
// Recipe allowlist — MIRRORS apps/player/.../display/VendorRecipe.kt
// (`RecipeAllowlist`). Keep the two in sync; the device stays the security
// boundary, this end is defence in depth.
//
// The 2026-08-13 review proved the gap by execution: the schema accepted
// `{brightness:{kind:'sysfs', path:'/sys/class/backlight/../../../proc/
// sysrq-trigger'}, blank:{kind:'broadcast', action:
// 'android.intent.action.MASTER_CLEAR'}}` unchanged, and one PUT shipped
// that catalog verbatim to every screen in every tenant — while this file's
// own header claimed "defence in depth means both ends refuse". It does now.
// ─────────────────────────────────────────────────────────────────────

/** The ONLY filesystem roots a recipe may write to. Trailing slash is load-bearing. */
export const DISPLAY_RECIPE_SYSFS_ROOTS = [
  '/sys/class/backlight/',
  '/sys/class/leds/',
] as const;

/**
 * Vendor namespaces a broadcast action may live in. `android.` and
 * `com.android.` are deliberately ABSENT, and every entry ends in a dot so
 * `com.tcl.` cannot be satisfied by `com.tclEVIL.doSomething`.
 */
export const DISPLAY_RECIPE_BROADCAST_PREFIXES = [
  'com.gv.',
  'com.goodview.',
  'com.good_view.',
  'com.novastar.',
  'com.nova.',
  'com.xixun.',
  'com.tcl.',
  'com.tclking.',
  'com.rockchip.',
  'com.amlogic.',
  'com.allwinner.',
  'com.mstar.',
  'com.hisense.',
  'com.philips.',
  'com.samsung.signage.',
  'com.lg.signage.',
  'com.educms.display.',
] as const;

/**
 * Settings.System keys a display recipe may write.
 *
 * This is the ONE place the API is deliberately STRICTER than the device
 * (which validates the key's shape but not its name). A display recipe has
 * no business writing anything outside the panel's own brightness surface,
 * and a typo'd key shipped fleet-wide is a silent no-op nobody notices. To
 * support a genuinely new vendor key: add it here, and say why in the commit.
 */
export const DISPLAY_RECIPE_SETTINGS_KEYS = [
  'screen_brightness',
  'screen_brightness_float',
  'screen_brightness_mode',
  'screen_off_timeout',
  'dim_screen',
] as const;

/** ASCII space, tab, NUL, CR, LF, DEL, every other C0 byte, and Unicode whitespace. */
function hasUnsafeChar(s: string): boolean {
  for (const ch of s) {
    const code = ch.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) return true;
    if (/\s/u.test(ch)) return true;
  }
  return false;
}

/**
 * A single sysfs path segment — MIRRORS `RecipeAllowlist.SYSFS_SEGMENT_RE`
 * (`^[A-Za-z0-9_.:+-]{1,64}$`) in VendorRecipe.kt.
 */
const RECIPE_SYSFS_SEGMENT_RE = /^[A-Za-z0-9_.:+-]{1,64}$/;

/**
 * True when `path` is provably a node strictly beneath an allowlisted sysfs
 * root, with no traversal, no encoded traversal, no backslash and no control
 * bytes. Purely textual — the server cannot canonicalize a device's
 * filesystem, so it refuses anything that would REQUIRE canonicalization to
 * be safe. The device still canonicalizes on top of this.
 *
 * SHAPE (2026-08-13 verify wave, P1): the device requires EXACTLY
 * `<root><device>/<attribute>` — two segments, each matching
 * [RECIPE_SYSFS_SEGMENT_RE]. That is `RecipeAllowlist.canonicalSysfsPath`
 * steps 4–5, and it is what makes traversal unrepresentable rather than
 * merely filtered. This end used to accept any depth and any characters
 * inside the segments, so `/sys/class/backlight/panel0/device/../../x` and
 * `/sys/class/backlight/panel,0/brightness` both saved with a 200 and were
 * then REJECTED WHOLE on the device — killing the recipe's blank AND wake
 * steps with no operator-visible signal anywhere.
 */
export function isAllowedRecipeSysfsPath(path: unknown): boolean {
  if (typeof path !== 'string') return false;
  const p = path.trim();
  if (!p || p.length > 256) return false;
  if (hasUnsafeChar(p)) return false;
  if (p.includes('\\')) return false;
  // Encoded traversal / encoded separators, in any case.
  if (/%2e|%2f|%5c|%00/i.test(p)) return false;
  if (!p.startsWith('/')) return false;
  const segments = p.split('/');
  if (segments.some((seg) => seg === '..')) return false;
  // Device: lexical normalization drops '.' and empty segments first.
  const normalized = '/' + segments.filter((s) => s && s !== '.').join('/');
  const root = DISPLAY_RECIPE_SYSFS_ROOTS.find((r) => normalized.startsWith(r));
  if (!root) return false;
  const tail = normalized.slice(root.length).split('/');
  // Exactly <device>/<attribute>. Not one (that is the class directory
  // itself), not three (which is how you walk out through a `device/`
  // back-link).
  if (tail.length !== 2) return false;
  return tail.every((seg) => RECIPE_SYSFS_SEGMENT_RE.test(seg));
}

export function isAllowedRecipeBroadcastAction(action: unknown): boolean {
  if (typeof action !== 'string') return false;
  if (!/^[A-Za-z0-9_.]{1,128}$/.test(action)) return false;
  if (action.includes('..')) return false;
  return DISPLAY_RECIPE_BROADCAST_PREFIXES.some((p) => action.startsWith(p));
}

export function isAllowedRecipeSettingsKey(key: unknown): boolean {
  return (
    typeof key === 'string' &&
    (DISPLAY_RECIPE_SETTINGS_KEYS as readonly string[]).includes(key)
  );
}

/**
 * Recipe shape. The SECURITY boundary is still the player's native allowlist
 * (sysfs canonicalized under /sys/class/backlight or /sys/class/leds;
 * allowlisted broadcast action prefixes, no explicit component/package
 * targeting; Settings.System only, never Secure or Global; no shell
 * execution, ever) — a recipe that fails it is REJECTED WHOLE and logged,
 * never partially applied. Nothing here can widen that allowlist, and the
 * checks below now REFUSE the same things at this end.
 */
/**
 * Longest literal a step or extra may carry. Device: MAX_LITERAL_LEN = 128.
 * Kept identical rather than "a bit stricter" — a server that refuses a
 * recipe the DEVICE would run is its own operator-visible bug.
 */
export const DISPLAY_RECIPE_MAX_LITERAL_LEN = 128;

/**
 * Smallest span a BRIGHTNESS scale may have. MIRRORS
 * `RecipeAllowlist.MIN_BRIGHTNESS_SCALE_SPAN`.
 *
 * `DisplayLimits.scale` rounds to nearest, so on a span S the
 * MIN_SAFE_BRIGHTNESS_PERCENT floor maps to `min + round(S * 0.05)`. For the
 * floor to survive that mapping at all, S must be ≥ 20 * floor%. A recipe
 * declaring `scale: [0, 9]` turned "5%, the lowest we allow" into 0 — which
 * on a real backlight is OFF, on a screen nobody can reach.
 */
export const DISPLAY_RECIPE_MIN_BRIGHTNESS_SCALE_SPAN = 10;

/**
 * Device: min ≥ 0, max > min, max ≤ 1_000_000 (overflow guard).
 * INTEGERS: the device's `parseScale` does `.toInt()`, so `[0, 255.9]` would
 * silently become `[0, 255]` — a value the operator never wrote.
 */
const RecipeScale = z
  .tuple([z.number().int(), z.number().int()])
  .refine(
    ([min, max]) => min >= 0 && max > min && max <= 1_000_000,
    'scale must be [min, max] with 0 ≤ min < max ≤ 1000000',
  );

/** Text a device would refuse to carry through a broadcast or a sysfs write. */
const isSafeLiteral = (v: string | number | boolean): boolean => {
  const s = String(v);
  return s.length > 0 && s.length <= DISPLAY_RECIPE_MAX_LITERAL_LEN && !hasUnsafeChar(s);
};

/** Device: EXTRA_KEY_RE = ^[A-Za-z0-9_.]{1,64}$ */
const RecipeExtra = z
  .object({
    key: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[A-Za-z0-9_.]+$/, 'extra key is not a safe identifier'),
    type: z.enum(['int', 'string', 'bool']),
    from: z.enum(['percent', 'literal']),
    value: z
      .union([z.string().max(DISPLAY_RECIPE_MAX_LITERAL_LEN), z.number(), z.boolean()])
      .optional(),
    scale: RecipeScale.optional(),
  })
  .strict()
  // Device: a percent handed to a bool extra is always a config error, and
  // coercing it silently is how "set 0% brightness" becomes "power off".
  .refine(
    (e) => !(e.from === 'percent' && e.type === 'bool'),
    'an extra cannot take a percent as a boolean',
  )
  // Device (`validateBroadcast`): a literal extra with no value is refused,
  // and so is a value the declared type cannot hold. Both used to save with a
  // 200 here and then reject the WHOLE recipe on the box.
  .superRefine((e, ctx) => {
    if (e.from !== 'literal') return;
    if (e.value === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['value'],
        message: `extra '${e.key}' is literal but carries no value`,
      });
      return;
    }
    if (!isSafeLiteral(e.value)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['value'],
        message: `extra '${e.key}' literal is empty, over-long, or contains control bytes`,
      });
      return;
    }
    const lit = String(e.value).trim();
    if (e.type === 'int' && !/^[+-]?\d+$/.test(lit)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['value'],
        message: `extra '${e.key}' is int but literal is not an integer`,
      });
    }
    if (e.type === 'bool' && !['true', 'false'].includes(lit.toLowerCase())) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['value'],
        message: `extra '${e.key}' is bool but literal is not true/false`,
      });
    }
  });

const RecipeBroadcast = z
  .object({
    kind: z.literal('broadcast'),
    action: z
      .string()
      .min(1)
      .max(128)
      .refine(
        isAllowedRecipeBroadcastAction,
        'broadcast action is not in an allowlisted vendor namespace',
      ),
    // MAX_EXTRAS on the device is 8; a 12-extra recipe would be rejected
    // whole there, so refusing it here keeps both ends agreeing.
    extras: z.array(RecipeExtra).max(8).optional(),
  })
  .strict()
  // Device (`validateBroadcast`): duplicate extra keys reject the recipe —
  // the second write would silently clobber the first anyway.
  .refine((s) => {
    const keys = (s.extras ?? []).map((e) => e.key);
    return new Set(keys).size === keys.length;
  }, 'duplicate extra key');

const RecipeSysfs = z
  .object({
    kind: z.literal('sysfs'),
    path: z
      .string()
      .min(1)
      .max(256)
      .refine(
        isAllowedRecipeSysfsPath,
        'sysfs path must be exactly <device>/<attribute> under /sys/class/backlight/ or /sys/class/leds/, with no traversal',
      ),
    value: z
      .union([z.string().max(DISPLAY_RECIPE_MAX_LITERAL_LEN), z.number()])
      .optional(),
    valueFrom: z.literal('percent').optional(),
    scale: RecipeScale.optional(),
  })
  .strict()
  // Device (`validateSysfs`): "sysfs step has neither a literal value nor
  // valueFrom:percent" — a step with nothing to write is refused whole.
  .refine(
    (s) => s.valueFrom === 'percent' || s.value !== undefined,
    'a sysfs step needs either valueFrom:"percent" or a literal value',
  )
  .refine(
    (s) => s.valueFrom === 'percent' || s.value === undefined || isSafeLiteral(s.value),
    'sysfs literal is empty, over-long, or contains control bytes',
  );

const RecipeSettings = z
  .object({
    kind: z.literal('settings'),
    key: z
      .string()
      .min(1)
      .max(64)
      .refine(
        isAllowedRecipeSettingsKey,
        `settings key must be one of: ${DISPLAY_RECIPE_SETTINGS_KEYS.join(', ')}`,
      ),
    valueFrom: z.literal('percent').optional(),
    value: z
      .union([z.string().max(DISPLAY_RECIPE_MAX_LITERAL_LEN), z.number()])
      .optional(),
    scale: RecipeScale.optional(),
  })
  .strict()
  // The device's `parseStep` builds `SettingsWrite(key, scale)` and DROPS
  // any `value` — a settings write is percent-derived by construction. A
  // recipe carrying one is not rejected there, it is silently ignored, which
  // is worse: the operator believes they pinned a literal and the panel does
  // something else. Refused here, where we can say why.
  .refine(
    (s) => s.value === undefined,
    'a settings step is always percent-derived — the device ignores `value`; remove it (use kind:"sysfs" for a literal write)',
  );

const RecipeStep = z.discriminatedUnion('kind', [RecipeBroadcast, RecipeSysfs, RecipeSettings]);
type RecipeStepDoc = z.infer<typeof RecipeStep>;

/**
 * The MIN_SAFE-floor rules that only apply to the BRIGHTNESS slot.
 * MIRRORS `RecipeValidator.validateBrightnessStep`. Returns null when the
 * step is acceptable, else the operator-facing reason.
 *
 * WHY A BRIGHTNESS STEP MUST BE PERCENT-DERIVED: a literal discards the
 * clamped percent entirely, so `DisplayLimits` is bypassed. The real-world
 * shape is `{kind:"sysfs", path:".../bl_power", value:"4"}`
 * (FB_BLANK_POWERDOWN — a genuine vendor pattern): every SetBrightness,
 * INCLUDING SetBrightness(100), then powers the backlight OFF, and the
 * dead-man revert re-applies the same literal, so the guard actively
 * re-creates the failure. Literals belong to blank/wake, where a constant is
 * exactly what is wanted.
 */
export function displayRecipeBrightnessIssue(step: RecipeStepDoc): string | null {
  const spanOk = (scale?: [number, number]): boolean =>
    !scale || scale[1] - scale[0] >= DISPLAY_RECIPE_MIN_BRIGHTNESS_SCALE_SPAN;
  const narrow =
    `brightness scale span is too narrow — ${MIN_SAFE_BRIGHTNESS_PERCENT}% would round to the ` +
    `scale minimum (need a span of at least ${DISPLAY_RECIPE_MIN_BRIGHTNESS_SCALE_SPAN})`;

  switch (step.kind) {
    case 'sysfs':
      if (step.valueFrom !== 'percent') {
        return (
          'a brightness step must be percent-derived (valueFrom:"percent") — a literal value ' +
          'bypasses the MIN_SAFE brightness floor and the dead-man revert re-applies it'
        );
      }
      return spanOk(step.scale) ? null : narrow;
    case 'broadcast': {
      const extras = step.extras ?? [];
      if (!extras.some((e) => e.from === 'percent')) {
        return (
          'a brightness broadcast must carry at least one percent-derived extra — an ' +
          'all-literal broadcast is a constant and bypasses the MIN_SAFE brightness floor'
        );
      }
      return extras.every((e) => e.from !== 'percent' || spanOk(e.scale)) ? null : narrow;
    }
    case 'settings':
      return spanOk(step.scale) ? null : narrow;
  }
}

/** Device: MATCH_RE = ^[A-Za-z0-9 ._+()\-/]{1,128}$ — a token the device would reject is refused here. */
const RecipeMatchToken = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9 ._+()\-/]+$/, 'match token has illegal characters');

export const DisplayVendorRecipeSchema = z
  .object({
    vendorId: z
      .string()
      .min(1)
      .max(60)
      .regex(/^[a-z0-9][a-z0-9-]*$/, 'kebab-case slug'),
    match: z
      .object({
        manufacturer: RecipeMatchToken.optional(),
        model: RecipeMatchToken.optional(),
        board: RecipeMatchToken.optional(),
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
  )
  /**
   * THE SLOT-AWARE HALF (2026-08-13 verify wave, P1). The step schemas above
   * are capability-agnostic; the device's `RecipeValidator.validateStep`
   * takes the CAPABILITY and applies extra rules to BRIGHTNESS only. Without
   * this, `{brightness:{kind:'sysfs', path:'…/bl_power', value:'4'}}` saved
   * with a 200, shipped to every screen, and was then REJECTED WHOLE on the
   * device — so the vendor's blank AND wake steps died too, silently, with
   * the dashboard showing a saved recipe.
   */
  .superRefine((r, ctx) => {
    if (!r.brightness) return;
    const why = displayRecipeBrightnessIssue(r.brightness);
    if (why) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['brightness'],
        message: why,
      });
    }
  });
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
   * ── THE VENDOR-RECIPE WIRE FIELD — `display.vendorRecipes` ─────────────
   *
   * THE P0 THIS CLOSES (2026-08-13 verify wave, P0-3). The server emitted
   * `display.vendorRecipes` (an ARRAY catalog) and the device's
   * `DisplayConfigParser` read `display.recipe` (a SINGLE object). Neither
   * end was wrong on its own; nobody had agreed a name, so every recipe
   * SUPER_ADMIN saved reached the glass as `null` and BRIGHTNESS fell to
   * software dim fleet-wide with no error anywhere.
   *
   * THE NAME IS `vendorRecipes`, AND THE SHAPE IS THE CATALOG. This is not a
   * coin flip — it is forced by the manifest cache contract:
   *   • Serving ONE pre-selected recipe means MATCHING server-side, which
   *     needs the screen's Build.* identity, which lives ONLY in
   *     `Screen.displayCapabilities`.
   *   • That column is in SCREEN_TELEMETRY_ONLY_FIELDS precisely so a boot
   *     -time capability report cannot invalidate the manifest cache. The
   *     moment the manifest derives from it, that registration flips from an
   *     optimisation into a correctness bug (stale manifests fleet-wide) and
   *     taking it OFF the list re-creates the 25 GB/mo Supabase egress the
   *     cache was built to kill.
   * So the server ships the catalog and the DEVICE picks the row whose
   * `match` block fits its own `Build.MANUFACTURER/MODEL/BOARD`
   * (`RecipeMatch.matches`, case-insensitive exact on each field that is
   * PRESENT). That keeps this block byte-identical for every screen in the
   * fleet, which is also what keeps its ETag stable.
   *
   * DEVICE CONTRACT (what `DisplayConfigParser` must implement):
   *   `display.vendorRecipes` is an array, already ordered by the server
   *   MOST-SPECIFIC-FIRST (priority desc, then vendorId asc). The device
   *   takes the FIRST entry whose `recipe.match` fits, and rejects that one
   *   recipe WHOLE if `RecipeValidator` refuses it — it must NOT fall
   *   through to the next entry, because "the recipe I configured was
   *   refused" and "a different vendor's recipe is now driving this panel"
   *   are very different outcomes on a screen nobody can reach. An absent,
   *   empty or all-rejected array means "no vendor recipe", which is the
   *   safe reading: the provider chain falls back to sysfs/settings/software
   *   -dim exactly as it does on a box with no recipe at all.
   *   Entry shape: `{ vendorId, priority, recipe }` where `recipe` is a
   *   [DisplayVendorRecipeDoc] — the same document `RecipeParser.parseObject`
   *   already consumes, so only the ARRAY WRAPPER is new work on-device.
   */
  vendorRecipes: DisplayVendorRecipeManifestEntry[];
}

/** One row of the `display.vendorRecipes` catalog. */
export interface DisplayVendorRecipeManifestEntry {
  vendorId: string;
  /** Server-assigned sort key. Higher wins; the array is already sorted. */
  priority: number;
  /**
   * Typed as `unknown` on purpose: rows are read straight out of a `Json`
   * column, so an OLDER row written before a schema tightening is not
   * guaranteed to satisfy today's [DisplayVendorRecipeDoc]. The device
   * re-validates every recipe on load (`RecipeParser` → `RecipeValidator`),
   * which is where a stale row is caught — the same "re-validate on read"
   * discipline as `HostAllowlist.sanitizePersistedApiRoot`.
   */
  recipe: unknown;
}

/**
 * The manifest key the vendor-recipe catalog rides on. Exported so the API
 * builder, the tests and any future consumer name it once — the P0 above was
 * a literal string typed differently at each end.
 */
export const DISPLAY_MANIFEST_VENDOR_RECIPES_KEY = 'vendorRecipes' as const;
