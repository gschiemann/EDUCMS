/**
 * displayControl.ts — the web player's half of vendor-neutral display
 * control (2026-08-13).
 *
 * ============================================================
 * WHY THIS EXISTS
 * ============================================================
 *
 * The API signs and publishes `DISPLAY_CONTROL`, audits it as `dispatched`
 * and answers the dashboard `delivered:true`. The APK implements the whole
 * control stack behind `displayApply` / `displaySetSchedule`. Between those
 * two halves there was NOTHING: the player page had no `DISPLAY_CONTROL`
 * arm, never called either native method, and never read the manifest's
 * `display` block. Every operator action and every on/off schedule died at
 * the WebView while the dashboard showed success — the "real-button
 * costume" this repo explicitly bans. This module is the missing wire.
 *
 * Pure by design (no React, no DOM, no network), like `pushGate.ts` and
 * `emergencyReconcile.ts`, so the translation and the diff can be unit
 * tested without mounting the 9.9k-line player page. (`dispatchDisplayControl`
 * reaches the outside world through two injected seams only: the native
 * bridge, and — since 2026-08-25 — a `SoftBlankSink` the page provides.)
 *
 * ============================================================
 * THE BLANK/POWER SPLIT (live field incident, 2026-08-25)
 * ============================================================
 *
 * Operator contract, verbatim: *"wake and blank should just do that and turn
 * on and off should do that, keep them separate and make them work perfectly
 * on all our models."*
 *
 * A remote BLANK forwarded to `displayApply` takes an Android device-admin
 * lock. On two panels that night (a Goodview G43 and a Mobile A-Frame) the
 * lock latched the VENDOR firmware into panel standby: glass dark, IR remote
 * and the physical power button both dead, WAKE delivered and useless, mains
 * power-cycle required — and the A-Frame then woke ITSELF back up minutes
 * later with nothing sent to it. An L55VEC with a byte-identical verdict
 * recovered normally. So that standby is a vendor timer: unreliable in BOTH
 * directions and unpredictable from anything the probe reports.
 *
 * The split, and what this file owns of it:
 *
 *   BLANK / WAKE  → SOFT. `soft: true` on the wire. This module draws or
 *                   removes a black full-viewport overlay through the page's
 *                   `SoftBlankSink` and NEVER calls the bridge. Identical on
 *                   every model, including a browser player with no APK.
 *                   Unbrickable by construction: nothing but the compositor
 *                   is involved, so WAKE always reverses it.
 *   POWER_OFF/ON  → HARD. Already translated by the server onto the legacy
 *                   'BLANK'/'WAKE' verbs plus `hard: true`, because shipped
 *                   APKs parse only five verbs. Forwarded to the bridge
 *                   untouched; old APKs ignore the extra key (org.json opt*).
 *
 * ── AND THEN BRIGHTNESS, THE SAME SHAPE AGAIN (2026-08-25, later) ──────
 *
 * The operator's brightness slider worked on two panels and was dead on the
 * other two. Each panel's own probe explains it exactly: M43 and L55VEC
 * resolve `sysfs-backlight` over a WRITABLE `/sys/class/backlight/aml-bl`;
 * G43 and the Mobile A-Frame have a NON-writable node, fall through to
 * `settings`, and their vendor firmware ignores the value that write stores
 * (G43's `screen_brightness` reads 102, not 255). A mechanism that reports
 * success and does nothing to the glass — the blank incident's signature.
 *
 *   SET_BRIGHTNESS → HARD when the panel's mechanism is in
 *                    DISPLAY_BRIGHTNESS_PROVEN_MECHANISMS: unchanged, the
 *                    APK writes the backlight exactly as it does today.
 *                  → SOFT otherwise, and then `percent` is a DIM LEVEL for
 *                    the overlay, never a backlight value. A soft dim can
 *                    never reach black (SOFT_DIM_MAX_ALPHA) — a slider is
 *                    not a blank, and a wall-mounted panel must not go dark
 *                    because someone nudged one.
 *
 * ── WHAT THE FIRST PASS GOT WRONG (same night, hours later) ───────────
 *
 * The split shipped and the operator's Blank button still did nothing on two
 * of his panels: *"no wake or blank working"*. Two defects, both of them the
 * same shape — a layer that reported success while nothing happened:
 *
 *   1. THE OVERLAY WAS IN ONE RENDER BRANCH. `page.tsx` has five render
 *      exits; the black div went into the non-template one. G43 and M43 were
 *      both playing a single-zone EXTERNAL_HTML template playlist, so both
 *      took the `isTemplate` early return, and the div was never mounted.
 *      This module logged "soft BLANK → overlay ON", the server audited
 *      `dispatched / delivered:true`, and the glass did not change. Fixed by
 *      hoisting the overlay to a const rendered by EVERY exit, guarded by
 *      `__tests__/softBlankRenderExits.test.ts`, and backstopped at runtime
 *      by a paint check that screams if the node is not in the DOM.
 *   2. THE FRESHNESS WINDOW STILL TREATED A BLACK DIV LIKE A DEVICE-ADMIN
 *      LOCK. See {@link displayFrameNeedsFreshness}.
 *
 * The lesson worth carrying: on this surface, "the state flipped" and "the
 * handler logged success" are not evidence. The DOM is.
 *
 * The soft overlay is SESSION-ONLY and deliberately so: it holds until WAKE,
 * an emergency, or a page reload — and a REFRESH_WEB, a service-worker
 * update or a WebView OOM-kill therefore un-blanks the screen. That is the
 * safe direction to fail (a screen that comes back on by itself is a
 * nuisance; a screen that cannot come back is a truck roll), and it is the
 * whole reason this beats the vendor standby, which fails the other way.
 * Persisting it across reloads is a deliberate follow-up — it needs a
 * server-held flag, and the manifest's no-volatile-fields rule constrains
 * where that flag can live.
 *
 * ============================================================
 * THE WIRE SHAPE IS THE DEVICE'S, NOT OURS
 * ============================================================
 *
 * `DisplayConfigParser.parse` (apps/player/.../display/DisplayConfig.kt) is
 * the contract, and it does NOT read what the API emits:
 *
 *   API `DisplayManifestBlock`      device `DisplayConfigParser`
 *   ────────────────────────────    ─────────────────────────────
 *   schedules[]                     schedules[]              ✅ same
 *   brightness.minSafePercent       brightness.defaultPercent ✳️ different field
 *   brightness.allowBlack           (not read)
 *   vendorRecipes[{vendorId,        recipe {vendorId, match,  ❌ array vs object
 *     priority, recipe}]              brightness, blank, wake}
 *
 * So the player translates. Two rules govern the translation:
 *
 * 1. NEVER MAP `minSafePercent` ONTO `defaultPercent`. They are not the
 *    same quantity — one is the floor below which a panel is unreadable
 *    (5%), the other is "what brightness should this screen sit at". Wiring
 *    the floor into the default would drive every screen in the fleet to 5%
 *    the moment schedules install. `defaultPercent` is emitted ONLY when the
 *    server actually sends one under that name.
 *
 * 2. THE VENDOR-RECIPE PICK IS A HINT, NOT AN AUTHORITY. The manifest ships
 *    the whole catalog on purpose (see display-manifest.ts: the block must
 *    not vary with `Screen.displayCapabilities`, so matching happens on the
 *    device against its own `Build.*`). The current parser holds ONE recipe,
 *    so we pick the highest-priority candidate whose `match` fits this
 *    device's identity — and `VendorRecipeProvider.activeRecipe()` re-checks
 *    `recipe.match.matches(Build.MANUFACTURER, Build.MODEL, Build.BOARD)`
 *    natively before using it. A wrong pick here therefore degrades to "no
 *    vendor recipe" (the software floor), never to "the wrong vendor's
 *    broadcast fired at this panel". `vendorRecipes` is ALSO passed through
 *    untouched, so a future parser that reads the array itself needs no
 *    change on this side.
 */

import { nativeCall, nativeHas } from './nativeBridge';
import {
  PUSH_FRESHNESS_WINDOW_MS,
  rememberEventId,
  type PushGateContext,
} from './pushGate';

/** WS/SSE message type the API signs for a one-off display action. */
export const DISPLAY_CONTROL_TYPE = 'DISPLAY_CONTROL';

/**
 * Actions that can arrive ON THE WIRE, in the SCREAMING_CASE spelling that is
 * authoritative (contract C1). `DisplayControlApi.normalizeActionName`
 * upper-cases and strips non-alphanumerics, so this spelling reaches
 * `SETBRIGHTNESS` / `SETVOLUME` / `BLANK` / `WAKE` / `REBOOT` on the device.
 *
 * ⚠️ THIS IS THE **DEVICE** VOCABULARY AND IT IS DELIBERATELY SHORTER THAN
 * `DISPLAY_ACTIONS` IN `@cms/api-types` (2026-08-25 blank/power split). The
 * operator now has seven verbs; every APK in the field parses exactly these
 * five. So the server TRANSLATES on the way out — POWER_OFF ships as 'BLANK'
 * + `hard:true`, POWER_ON as 'WAKE' + `hard:true` — and this list stays at
 * five on purpose. Adding POWER_OFF here would let a literal 'POWER_OFF'
 * frame through to `displayApply`, where every shipped APK silently ignores
 * it: a control with a 100% failure rate and no error anywhere. If a frame
 * ever does arrive with a verb this list does not know, dropping it as
 * `bad-action` is the correct, loud outcome.
 */
export const DISPLAY_ACTIONS = [
  'SET_VOLUME',
  'SET_BRIGHTNESS',
  'BLANK',
  'WAKE',
  'REBOOT',
] as const;
export type DisplayAction = (typeof DISPLAY_ACTIONS)[number];

const ACTION_SET: ReadonlySet<string> = new Set<string>(DISPLAY_ACTIONS);

/** Same clamp the API and the APK both apply: 1 s … 1 h. */
export const REVERT_MIN_MS = 1_000;
export const REVERT_MAX_MS = 60 * 60 * 1_000;

// ─────────────────────────────────────────────────────────────────────
// THE SOFT DIM (brightness half of the split, 2026-08-25)
//
// Two of the four field panels resolve a brightness mechanism whose write
// succeeds and moves nothing — their `/sys/class/backlight/*` node is not
// writable, so they fall through to `settings`, and the vendor firmware
// ignores the value it stores. The server now routes those onto a SOFT
// frame, and this is what a soft frame paints: the same black overlay the
// soft blank uses, at partial opacity.
// ─────────────────────────────────────────────────────────────────────

/**
 * Hardest a soft dim may ever get.
 *
 * A soft dim MUST NOT be able to reach black. A blank is a deliberate,
 * clearly-labelled action with a Wake button next to it; a brightness slider
 * dragged to its floor is not, and a wall-mounted panel that goes black
 * because someone nudged a slider is the truck roll this whole feature
 * exists to avoid. At 0.85 the content is dim but still legible, which is
 * what a real backlight at its 5% floor looks like — and it stays visibly
 * DIFFERENT from a blank, so the operator can always tell which state a
 * screen is in.
 *
 * This clamp is unconditional. `allowBlack` deliberately does NOT lift it:
 * that flag is an opt-out of the HARDWARE backlight floor, and on the soft
 * path there is no backlight involved — a fully opaque overlay would just be
 * a blank wearing a slider's clothes, with none of a blank's affordances.
 */
export const SOFT_DIM_MAX_ALPHA = 0.85;

/**
 * The brightness floor the alpha ramp is anchored to.
 *
 * ⚠️ MIRRORS `MIN_SAFE_BRIGHTNESS_PERCENT` in `@cms/api-types`, and is
 * declared here rather than imported ON PURPOSE. This module is deliberately
 * dependency-free (only `./nativeBridge` and `./pushGate`) because it ships
 * inside the player bundle to Chromium-83 kiosks, and `@cms/api-types` pulls
 * zod in with it. `__tests__/displayControl.test.ts` imports the real
 * constant and asserts the two are equal, so the drift this would otherwise
 * invite is a failing test rather than a silent divergence.
 */
export const SOFT_DIM_FLOOR_PERCENT = 5;

/**
 * Brightness percent → overlay alpha.
 *
 * Linear across the usable range: 100% → no overlay at all, the safety floor
 * → SOFT_DIM_MAX_ALPHA. Anything below the floor (only reachable via
 * `allowBlack`, which skips the server clamp) is treated AS the floor — see
 * SOFT_DIM_MAX_ALPHA for why the soft path never honours a request to go
 * fully dark.
 *
 * A missing / non-finite percent returns 0 (no dim). That is the recovery
 * direction, and a malformed frame must never be able to darken a screen.
 */
export function softDimAlpha(percent: number | null | undefined): number {
  if (typeof percent !== 'number' || !Number.isFinite(percent)) return 0;
  if (percent >= 100) return 0;
  const floored = Math.max(SOFT_DIM_FLOOR_PERCENT, percent);
  const span = 100 - SOFT_DIM_FLOOR_PERCENT;
  const alpha = ((100 - floored) / span) * SOFT_DIM_MAX_ALPHA;
  // 3 dp keeps the style attribute stable across re-renders (and therefore
  // out of the diff) without being visibly quantised.
  return Math.round(Math.min(SOFT_DIM_MAX_ALPHA, Math.max(0, alpha)) * 1000) / 1000;
}

export interface DisplayControlCommand {
  action: DisplayAction;
  percent?: number;
  revertAfterMs?: number;
  allowBlack?: boolean;
  /** Server-minted id — echoed into logs so one action greps end-to-end. */
  actionId?: string;
  /**
   * SOFT frame — the operator pressed Blank or Wake. Handled ENTIRELY in this
   * page by showing/removing a black overlay. MUST NOT reach the bridge.
   */
  soft?: true;
  /**
   * HARD frame — the operator pressed "Turn panel off/on"; the server has
   * already translated it onto the legacy verb. Forwarded to the bridge.
   */
  hard?: true;
}

/**
 * Normalise a signed `DISPLAY_CONTROL` payload into something safe to hand
 * the bridge, or `null` if it is not a display command at all.
 *
 * Deliberately strict about the ACTION and lenient about the rest: the APK
 * validates every value natively (`DisplayLimits` owns the brightness floor,
 * `RecipeAllowlist` owns the recipe surface) precisely because this input is
 * attacker-reachable, so re-implementing those rules here would only create
 * a second, drifting copy. What we DO enforce is that we never forward a
 * verb the device does not know, and never a NaN/±Infinity that would
 * serialise to `null` and be read as 0.
 */
export function parseDisplayControlCommand(payload: unknown): DisplayControlCommand | null {
  if (!payload || typeof payload !== 'object') return null;
  const p = payload as Record<string, unknown>;

  const raw = typeof p.action === 'string' ? p.action.trim().toUpperCase() : '';
  if (!ACTION_SET.has(raw)) return null;
  const action = raw as DisplayAction;

  const out: DisplayControlCommand = { action };

  if (typeof p.percent === 'number' && Number.isFinite(p.percent)) {
    out.percent = Math.round(p.percent);
  }
  if (typeof p.revertAfterMs === 'number' && Number.isFinite(p.revertAfterMs) && p.revertAfterMs > 0) {
    out.revertAfterMs = Math.min(REVERT_MAX_MS, Math.max(REVERT_MIN_MS, Math.round(p.revertAfterMs)));
  }
  if (p.allowBlack === true) out.allowBlack = true;
  if (typeof p.actionId === 'string' && p.actionId) out.actionId = p.actionId.slice(0, 64);
  // Strict `=== true` on both. A frame from an API build older than the
  // 2026-08-25 split carries NEITHER flag, and that flag-less case must keep
  // behaving exactly as it does today (forwarded to the bridge) rather than
  // being reinterpreted — the web bundle and the API do not deploy in the
  // same instant, and a deploy window is not the place to invent semantics.
  if (p.soft === true) out.soft = true;
  if (p.hard === true) out.hard = true;

  return out;
}

/**
 * Is this the RECOVERY direction?
 *
 * Contract C4 — fail-open for recovery, fail-closed for risk. A dark screen
 * an operator cannot recover from the dashboard is the worst outcome this
 * feature has, so a WAKE is never dropped by a client-side freshness check
 * (the same reasoning `pushGate.ts` already applies to `ALL_CLEAR`).
 *
 * A brightness RAISE is recovery-direction too, but only the device knows
 * its current percent — `DisplayControlApi.isRecoveryAction` makes that call
 * natively against `DisplayPrefs.brightnessPercent`. The web side cannot,
 * so it keeps brightness in the fail-closed lane and lets WAKE be the
 * guaranteed recovery verb.
 */
export function isDisplayRecoveryAction(action: string | null | undefined): boolean {
  return typeof action === 'string' && action.trim().toUpperCase() === 'WAKE';
}

export type DisplayPushVerdict =
  | { accepted: true; recovery: boolean }
  | { accepted: false; reason: 'not-ours' | 'unsigned' | 'stale' | 'replay' | 'bad-action' };

/**
 * Does this frame need to be FRESH, or only AUTHENTIC?
 *
 * ── WHY SOFT FRAMES LEFT THE FRESHNESS LANE (2026-08-25, second pass) ──
 *
 * The freshness window was written when BLANK meant "take an Android
 * device-admin lock and turn a panel off". Replaying a captured one of those
 * hours later is a real attack: it darkens hardware, and on the incident
 * panels it darkened hardware in a way WAKE could not reverse. Thirty seconds
 * was the right budget for that.
 *
 * A `soft: true` frame is not that action. It draws or removes a black `<div>`
 * inside our own page. It cannot reach panel power, it cannot latch, and every
 * one of WAKE, a page reload, a service-worker update and any emergency alert
 * removes it. The worst a perfectly-replayed soft BLANK can do is make a
 * screen go black until the operator presses Wake — which is also the worst a
 * *legitimate* one does.
 *
 * Against that: the freshness check reads `Date.now() + serverClockOffsetMs`,
 * and that offset is captured ONCE per socket at AUTH_OK. Android signage
 * boxes boot without NTP and get stepped minutes later, so a box whose RTC
 * moves after AUTH_OK silently drops every risk-direction frame until it
 * reconnects. On that box the operator's Blank button does nothing, forever,
 * with no signal anywhere. Trading a reversible black div for a dead button on
 * the exact hardware this product ships to is the wrong side of the trade.
 *
 * So soft frames keep BOTH of the checks that carry real weight — the
 * SIGNATURE (proof the frame came through the server's signer, which is what
 * actually stops a forgery) and the per-eventId REPLAY dedup — and skip only
 * the wall-clock window. Identical reasoning, and identical shape, to the
 * recovery-lane exemption WAKE already had, and to `ALL_CLEAR` in
 * `pushGate.ts`.
 *
 * HARD frames (a translated POWER_OFF/POWER_ON) stay fully gated: those DO
 * reach hardware, so they keep the window they were designed for.
 */
export function displayFrameNeedsFreshness(cmd: DisplayControlCommand): boolean {
  if (isDisplayRecoveryAction(cmd.action)) return false;
  if (cmd.soft) return false;
  return true;
}

/**
 * Would executing this frame put anything over the content?
 *
 * The life-safety question, and only that: while an emergency alert is on
 * the glass, nothing this player draws may sit on top of it. Two cases
 * qualify:
 *
 *   • BLANK — soft or hard. Opaque black, by definition.
 *   • a SOFT SET_BRIGHTNESS that resolves to any dim at all. A 45% black
 *     film over a lockdown notice is not a blank, but it is still contrast
 *     taken away from the one thing on that screen that matters.
 *
 * ⚠️ SCOPED TO THE **SOFT** BRIGHTNESS LANE ON PURPOSE. A hard brightness
 * frame is a backlight write executed by the APK, which holds its own native
 * emergency interlock, and the server refuses the darkening direction before
 * it ever publishes. Extending this client-side drop to cover hard frames
 * would change behaviour on the panels that work today, for a case already
 * closed twice — the wrong trade during a live field test.
 */
export function displayFrameDarkensContent(cmd: DisplayControlCommand): boolean {
  if (cmd.action === 'BLANK') return true;
  if (cmd.soft && cmd.action === 'SET_BRIGHTNESS') return softDimAlpha(cmd.percent) > 0;
  return false;
}

/**
 * The transport gate a `DISPLAY_CONTROL` frame must clear, on WS and SSE
 * alike.
 *
 * Four checks, in the order that makes a rejected frame cheapest:
 *
 *  1. SCOPE — the payload names the screen it is for, and the API publishes
 *     it on `device:<screenId>`. Fail CLOSED on a mismatch or a missing id,
 *     the same posture `isTenantChangeForThisScreen` takes: a frame that
 *     leaks onto the wrong channel must not blank someone else's screen.
 *  2. ACTION — parsed and allow-listed before anything else looks at it.
 *  3. SIGNATURE — for RISK-direction actions (everything but WAKE). The HMAC
 *     is minted server-side; its absence proves the frame never passed the
 *     signer. Contract C4 keeps WAKE out of this lane: dropping a real
 *     recovery command on a clock-skewed Android box that never got AUTH_OK
 *     would leave a dark screen with no way back, which is the worst outcome
 *     this feature has. (Same trade `pushGate.ts` already makes for
 *     `ALL_CLEAR`, and the APK still refuses anything risk-direction that
 *     arrives on an untrusted transport.)
 *  3b. FRESHNESS — for HARD frames only, i.e. the ones that actually reach
 *     hardware. A captured POWER_OFF replayed hours later is precisely the
 *     attack this closes. SOFT frames (the black overlay) are exempt; see
 *     {@link displayFrameNeedsFreshness} for why, and for the clock-skew
 *     failure that exemption exists to kill.
 *  4. REPLAY — per-eventId, in the LRU shared with the life-safety gate, so
 *     a frame seen on one transport cannot be replayed on the other. Applied
 *     to recovery actions too: a duplicated WAKE is harmless, but deduping
 *     it keeps the bridge quiet and the logs honest.
 */
export function checkDisplayControlPush(
  msg: unknown,
  screenId: string | null | undefined,
  ctx: PushGateContext,
): DisplayPushVerdict {
  if (!msg || typeof msg !== 'object') return { accepted: false, reason: 'not-ours' };
  const envelope = msg as Record<string, unknown>;
  const payload =
    envelope.payload && typeof envelope.payload === 'object'
      ? (envelope.payload as Record<string, unknown>)
      : envelope;

  // 1. Scope — fail closed.
  if (!screenId) return { accepted: false, reason: 'not-ours' };
  const target = payload.screenId;
  if (typeof target !== 'string' || target !== screenId) {
    return { accepted: false, reason: 'not-ours' };
  }

  // 2. Action.
  const cmd = parseDisplayControlCommand(payload);
  if (!cmd) return { accepted: false, reason: 'bad-action' };
  const recovery = isDisplayRecoveryAction(cmd.action);

  const nowFn = ctx.now ?? Date.now;

  // 3. Signature — every risk-direction frame, soft or hard. The HMAC is what
  //    proves the frame came through the server's signer; nothing below
  //    relaxes it.
  if (!recovery) {
    if (typeof envelope.signature !== 'string' || envelope.signature.length === 0) {
      return { accepted: false, reason: 'unsigned' };
    }
  }

  // 3b. Freshness — HARD frames only. See `displayFrameNeedsFreshness`: a
  //     soft frame is a black div in our own page, and a clock-skewed Android
  //     box must not lose its Blank button over a window that only ever made
  //     sense for a device-admin lock.
  if (displayFrameNeedsFreshness(cmd)) {
    const adjustedNow = nowFn() + ctx.serverClockOffsetMs;
    const ts = envelope.timestamp;
    if (
      typeof ts !== 'number' ||
      !Number.isFinite(ts) ||
      Math.abs(adjustedNow - ts) > PUSH_FRESHNESS_WINDOW_MS
    ) {
      return { accepted: false, reason: 'stale' };
    }
  }

  // 4. Replay.
  if (!rememberEventId(ctx.seenEventIds, envelope.eventId, nowFn())) {
    return { accepted: false, reason: 'replay' };
  }

  return { accepted: true, recovery };
}

/** The exact JSON string `DisplayControlApi.applyJson` expects. */
export function toDeviceActionJson(cmd: DisplayControlCommand): string {
  const body: Record<string, unknown> = { action: cmd.action };
  if (cmd.percent !== undefined) body.percent = cmd.percent;
  if (cmd.revertAfterMs !== undefined) body.revertAfterMs = cmd.revertAfterMs;
  if (cmd.allowBlack) body.allowBlack = true;
  return JSON.stringify(body);
}

// ─────────────────────────────────────────────────────────────────────
// Manifest `display` block → device `DisplayConfig`
// ─────────────────────────────────────────────────────────────────────

/** Build identity the device reports; used to pick a vendor recipe. */
export interface DeviceIdentity {
  manufacturer?: string | null;
  model?: string | null;
  board?: string | null;
}

interface RecipeMatch {
  manufacturer?: unknown;
  model?: unknown;
  board?: unknown;
}

/**
 * Mirror of Kotlin `RecipeMatch.matches` — case-insensitive substring on
 * each declared token, and an all-null match matches every device (that is
 * how a universal recipe is expressed).
 *
 * A field the device did not report is treated as NON-matching whenever the
 * recipe constrains it: guessing would hand a Goodview broadcast to a TCL
 * panel. The native re-check would catch it, but not shipping it is better.
 */
export function recipeMatchesDevice(match: unknown, device: DeviceIdentity): boolean {
  if (!match || typeof match !== 'object') return true;
  const m = match as RecipeMatch;
  const pairs: Array<[unknown, string | null | undefined]> = [
    [m.manufacturer, device.manufacturer],
    [m.model, device.model],
    [m.board, device.board],
  ];
  for (const [want, have] of pairs) {
    if (typeof want !== 'string' || want.trim() === '') continue;
    if (typeof have !== 'string' || have.trim() === '') return false;
    // EXACT, case-insensitive — deliberately NOT a substring test.
    //
    // This must mirror Kotlin `RecipeMatch.matches`, which uses
    // `equals(ignoreCase = true)`. The device is the enforcement point: if we
    // select a recipe here that the device then refuses, the vendor step is
    // silently dropped and the box falls back to the software floor with no
    // signal anywhere the operator can see. A substring test also matches far
    // too much — a recipe for model "M43" would have claimed "M43GUQ-CS1382D-C"
    // (a real box in the pilot fleet), firing another SKU's broadcasts at it.
    if (have.trim().toLowerCase() !== want.trim().toLowerCase()) return false;
  }
  return true;
}

/**
 * Pick the highest-priority catalog entry whose `match` fits this device.
 * Ties break on `vendorId` so two equal-priority entries can never install
 * differently on two identical screens.
 */
export function pickVendorRecipe(
  vendorRecipes: unknown,
  device: DeviceIdentity,
): Record<string, unknown> | null {
  if (!Array.isArray(vendorRecipes) || vendorRecipes.length === 0) return null;

  interface Candidate {
    vendorId: string;
    priority: number;
    recipe: Record<string, unknown>;
  }
  const candidates: Candidate[] = [];

  for (const entry of vendorRecipes) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    if (!e.recipe || typeof e.recipe !== 'object' || Array.isArray(e.recipe)) continue;
    const recipe = e.recipe as Record<string, unknown>;
    // The catalog row carries the vendorId; the nested recipe usually
    // repeats it, but the device REJECTS a recipe with no vendorId, so
    // fill it from the row when the nested copy is missing.
    const vendorId =
      typeof recipe.vendorId === 'string' && recipe.vendorId
        ? recipe.vendorId
        : typeof e.vendorId === 'string'
          ? e.vendorId
          : '';
    if (!vendorId) continue;
    if (!recipeMatchesDevice(recipe.match, device)) continue;
    candidates.push({
      vendorId,
      priority: typeof e.priority === 'number' && Number.isFinite(e.priority) ? e.priority : 0,
      recipe: { ...recipe, vendorId },
    });
  }

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => (b.priority - a.priority) || a.vendorId.localeCompare(b.vendorId));
  return candidates[0].recipe;
}

export interface DeviceDisplayConfig {
  version: number;
  timezone?: string;
  schedules: Array<Record<string, unknown>>;
  brightness?: Record<string, unknown>;
  recipe?: Record<string, unknown>;
  /** Passed through untouched — see the header, rule 2. */
  vendorRecipes?: unknown;
}

/**
 * Translate the manifest `display` block into what the device parses.
 *
 * Returns `null` when the block is absent or unusable — the caller must then
 * do NOTHING rather than install an empty config, because an empty install
 * would wipe a screen's existing on/off schedule (the block is missing on
 * the emergency and cached-manifest branches, which is exactly when we least
 * want to disarm anything).
 */
export function toDeviceDisplayConfig(
  block: unknown,
  device: DeviceIdentity = {},
): DeviceDisplayConfig | null {
  if (!block || typeof block !== 'object' || Array.isArray(block)) return null;
  const b = block as Record<string, unknown>;

  const schedulesIn = Array.isArray(b.schedules) ? b.schedules : [];
  const schedules = schedulesIn
    .filter((s): s is Record<string, unknown> => !!s && typeof s === 'object' && !Array.isArray(s))
    .map((s) => {
      const row: Record<string, unknown> = {};
      if (typeof s.id === 'string') row.id = s.id;
      // Contract C2: daysOfWeek is Int[] 0=Sunday..6=Saturday, which
      // `DisplayConfigParser.parseDays` accepts directly. Forwarded as-is.
      if (Array.isArray(s.daysOfWeek)) row.daysOfWeek = s.daysOfWeek;
      if (typeof s.onTime === 'string') row.onTime = s.onTime;
      if (typeof s.offTime === 'string') row.offTime = s.offTime;
      if (typeof s.timezone === 'string') row.timezone = s.timezone;
      if (typeof s.isActive === 'boolean') row.isActive = s.isActive;
      return row;
    });

  const out: DeviceDisplayConfig = {
    version: typeof b.version === 'number' && Number.isFinite(b.version) ? b.version : 1,
    schedules,
  };

  if (typeof b.timezone === 'string' && b.timezone.trim()) out.timezone = b.timezone.trim();

  // Brightness is forwarded WHOLE (so `minSafePercent` / `allowBlack` remain
  // available to a future parser) but `defaultPercent` is never synthesised.
  // See the header, rule 1 — the floor is not the default.
  if (b.brightness && typeof b.brightness === 'object' && !Array.isArray(b.brightness)) {
    out.brightness = { ...(b.brightness as Record<string, unknown>) };
  }

  if (Array.isArray(b.vendorRecipes)) {
    out.vendorRecipes = b.vendorRecipes;
    const picked = pickVendorRecipe(b.vendorRecipes, device);
    if (picked) out.recipe = picked;
  }
  // An already-singular `recipe` (a server that emits the device shape
  // directly) wins over anything we picked from the catalog.
  if (b.recipe && typeof b.recipe === 'object' && !Array.isArray(b.recipe)) {
    out.recipe = b.recipe as Record<string, unknown>;
  }

  return out;
}

/**
 * A stable fingerprint of what we would install, used to skip a re-install
 * when nothing changed.
 *
 * ⚠️ It is computed over the TRANSLATED config, not the raw manifest block,
 * so it also moves when the recipe PICK changes (a catalog edit that
 * promotes a different vendor for this box) — and does NOT move for a
 * catalog edit that is irrelevant to this device.
 *
 * `JSON.stringify` on our own freshly-built object is deterministic here
 * because every key is inserted in a fixed order by the builder above; the
 * pass-through `vendorRecipes` / `recipe` sub-objects come from
 * `JSON.parse`, which preserves document order, and the manifest itself is
 * ETag-hashed server-side, so identical content arrives byte-identical.
 */
export function displayConfigFingerprint(config: DeviceDisplayConfig | null): string {
  if (!config) return '';
  try {
    return JSON.stringify(config);
  } catch {
    // Circular / unserialisable — treat as "always changed" rather than
    // silently pinning the device to a stale config.
    return `unserialisable:${Date.now()}`;
  }
}

// ─────────────────────────────────────────────────────────────────────
// THE WIRE ITSELF
//
// Everything above is pure. The two functions below are the only things
// in the player that touch the display half of the native bridge, and
// they are what `page.tsx` calls — deliberately NOT inlined there, so the
// path an operator's click actually takes is unit-testable without
// mounting a 9.9k-line page. `__tests__/displayControl.test.ts` drives
// exactly these, and a source-level guard in the same file asserts
// page.tsx still calls them (the "engine built but never plugged in"
// failure this whole module exists to fix must not silently recur).
// ─────────────────────────────────────────────────────────────────────

export type DisplayDropReason =
  | 'not-ours'
  | 'unsigned'
  | 'stale'
  | 'replay'
  | 'bad-action'
  | 'threw'
  /** A darkening frame arrived while emergency content is on the glass. */
  | 'emergency';

export type DisplayDispatchResult =
  | { status: 'sent'; action: DisplayAction }
  | { status: 'no-bridge'; action: DisplayAction }
  /**
   * Handled by the black overlay in this page; the bridge was NOT called.
   *
   * `overlay` is "is anything painted over the content" — true for a blank
   * AND for any non-zero dim, because it is what the page's paint proof
   * checks. `dim` carries the alpha for a soft SET_BRIGHTNESS (0 for
   * BLANK/WAKE, which own the opaque state instead).
   */
  | { status: 'soft'; action: DisplayAction; overlay: boolean; dim: number }
  /** A soft frame arrived but this caller wired no overlay. Never forwarded. */
  | { status: 'no-overlay'; action: DisplayAction }
  | { status: 'dropped'; reason: DisplayDropReason };

/**
 * The page's black overlay, as this module needs to see it.
 *
 * Kept to two tiny methods so the whole soft-blank decision stays inside this
 * unit-tested module rather than leaking into the 10k-line page: the page
 * owns the React state and the emergency state, this owns the RULES.
 */
export interface SoftBlankSink {
  /** true → cover the viewport in black; false → uncover. */
  set(on: boolean): void;
  /**
   * Set the SOFT DIM level: overlay alpha, 0 (none) … SOFT_DIM_MAX_ALPHA.
   *
   * Separate from `set` because the two states are independent and compose:
   * a blank is opaque and swallows touches, a dim is translucent and does
   * not. The page renders them through one node (see `softBlankOverlay` in
   * page.tsx), but the RULES for each live here.
   *
   * REQUIRED, not optional, deliberately: a soft dim frame handed to a sink
   * that cannot paint one is precisely the "reported success, nothing on the
   * glass" failure this module was written after. A compile error is a
   * cheaper way to find that than a field visit.
   */
  setDim(alpha: number): void;
  /**
   * Is emergency content (a tenant-wide override or a pushed SOS / broadcast
   * / media alert) DISPLAYED on this screen right now?
   *
   * Read live at dispatch time, never captured: a lockdown that landed one
   * frame ago must already be visible to this check.
   */
  emergencyDisplayed(): boolean;
}

/**
 * Gate one signed `DISPLAY_CONTROL` frame, then either draw the soft blank
 * here or hand the frame to the APK.
 *
 * ── THE SPLIT THIS FUNCTION ENFORCES (2026-08-25 field incident) ───────
 *
 * A remote BLANK latched two panels into a vendor standby that ignored WAKE
 * and needed a mains power-cycle (and, on the Mobile A-Frame, then un-latched
 * itself minutes later — so the vendor's timer owns that state, not us). The
 * command that did it was a plain BLANK forwarded to `displayApply`, which
 * takes an Android device-admin lock.
 *
 * So the rule here is absolute and it is the reason this module exists:
 *
 *   • `soft: true` → the overlay, and the bridge is NEVER called. Forwarding
 *     a soft frame re-fires device-admin, i.e. re-creates the exact bug.
 *   • `hard: true` (a translated POWER_OFF/POWER_ON) → forwarded untouched.
 *   • NEITHER flag (an API older than the split) → forwarded, exactly as
 *     before. Behaviour during a deploy window must not be invented here.
 *
 * Plus one life-safety rule that outranks all three: while emergency content
 * is displayed, a darkening frame is DROPPED and the overlay is force-cleared
 * — an alert must always punch through. (The server refuses these too, and
 * the APK holds its own native hold; this is the third independent layer.)
 *
 * A no-op without a native bridge for HARD frames, on purpose: `/player` also
 * runs in a desktop browser (previews, the ops console, Playwright). The SOFT
 * path needs no bridge at all, which is why blank/wake now work identically
 * on a browser player and on every Android model.
 *
 * Never throws — the same socket carries the lockdown OVERRIDE, and a
 * malformed display push must not take down the realtime consumer.
 */
export function dispatchDisplayControl(
  envelope: unknown,
  screenId: string | null | undefined,
  ctx: PushGateContext,
  via: 'WS' | 'SSE' = 'WS',
  softBlank?: SoftBlankSink,
): DisplayDispatchResult {
  const pl =
    envelope && typeof envelope === 'object' && (envelope as any).payload &&
    typeof (envelope as any).payload === 'object'
      ? ((envelope as any).payload as Record<string, unknown>)
      : ((envelope ?? {}) as Record<string, unknown>);
  const corrId =
    (typeof pl.actionId === 'string' && pl.actionId) ||
    (envelope && typeof envelope === 'object' && typeof (envelope as any).eventId === 'string'
      ? (envelope as any).eventId
      : '(no-actionid)');

  try {
    const verdict = checkDisplayControlPush(envelope, screenId, ctx);
    if (!verdict.accepted) {
      // A DROPPED FRAME MUST EXPLAIN ITSELF. The operator sees "sent" in the
      // dashboard for every one of these — the server's `delivered:true` only
      // means the fan-out was up, never that this screen acted — so the panel's
      // own console is the only place the truth can appear. Carry the numbers
      // that identify WHICH verdict fired without a second debugging session:
      // `stale` is meaningless without the timestamp, the learned clock offset
      // and the resulting skew.
      const env = (envelope ?? {}) as Record<string, unknown>;
      const ts = typeof env.timestamp === 'number' ? env.timestamp : null;
      const skewMs =
        ts === null ? null : Math.round((ctx.now ?? Date.now)() + ctx.serverClockOffsetMs - ts);
      console.warn(
        `[display ${corrId}] ${via} dropped ${verdict.reason} — action=${String(pl.action)} ` +
          `soft=${pl.soft === true} hard=${pl.hard === true} ` +
          `target=${String(pl.screenId)} self=${screenId} ` +
          `signed=${typeof env.signature === 'string' && env.signature.length > 0} ` +
          `ts=${ts} offset=${ctx.serverClockOffsetMs}ms skew=${skewMs}ms ` +
          `(window ±${PUSH_FRESHNESS_WINDOW_MS}ms)`,
      );
      return { status: 'dropped', reason: verdict.reason };
    }

    // The gate already parsed and allow-listed it; re-parse to get the
    // normalised command rather than trusting the raw payload's shape.
    const cmd = parseDisplayControlCommand(pl);
    if (!cmd) return { status: 'dropped', reason: 'bad-action' };

    // ── LIFE SAFETY, FIRST AND UNCONDITIONALLY ────────────────────────
    // An emergency alert must always be on the glass. Any darkening frame
    // that arrives while one is displayed is dropped — and if a soft blank
    // is already up, it comes down here rather than waiting for the page's
    // own effect, so the alert is never painted behind black even for a
    // frame. Applies to hard frames too: the server refuses those and the
    // APK holds a native interlock, but a life-safety invariant is worth
    // asserting at every layer that can assert it.
    if (displayFrameDarkensContent(cmd) && softBlank?.emergencyDisplayed()) {
      softBlank.set(false);
      softBlank.setDim(0);
      console.warn(
        `[display ${corrId}] ${via} ${cmd.action} dropped — emergency content is ` +
          'on this screen; alerts always punch through',
      );
      return { status: 'dropped', reason: 'emergency' };
    }

    // ── THE SOFT LANE — handled here, never handed to the APK ──────────
    if (cmd.soft) {
      if (!softBlank) {
        // No overlay wired by this caller. Do NOT fall through to the
        // bridge: forwarding is the bug. Say so instead of failing silently.
        console.warn(
          `[display ${corrId}] ${via} soft ${cmd.action} had nowhere to go — ` +
            'no overlay wired on this player (not forwarded to the bridge)',
        );
        return { status: 'no-overlay', action: cmd.action };
      }

      // A soft SET_BRIGHTNESS is a DIM LEVEL, not a backlight value. It
      // arrives only for panels whose brightness mechanism the field proved
      // is a silent no-op, so forwarding it would be handing the operator's
      // slider back to the thing that ignores it.
      if (cmd.action === 'SET_BRIGHTNESS') {
        const alpha = softDimAlpha(cmd.percent);
        softBlank.setDim(alpha);
        console.log(
          `[display ${corrId}] ${via} soft SET_BRIGHTNESS ${cmd.percent}% → dim ` +
            `alpha ${alpha} (web-overlay; backlight untouched)`,
        );
        return { status: 'soft', action: cmd.action, overlay: alpha > 0, dim: alpha };
      }

      const on = cmd.action === 'BLANK';
      softBlank.set(on);
      // WAKE means "be visible" — it clears the DIM as well as the blank.
      // Leaving a dim behind a Wake would be a screen that came back wrong,
      // and the operator would have no way to tell a stuck dim from a
      // panel fault.
      if (!on) softBlank.setDim(0);
      console.log(
        `[display ${corrId}] ${via} soft ${cmd.action} → overlay ${on ? 'ON' : 'OFF'} ` +
          '(web-overlay; panel power untouched)',
      );
      return { status: 'soft', action: cmd.action, overlay: on, dim: 0 };
    }

    // ── HARD (or pre-split legacy) — the APK owns it from here ─────────
    // A WAKE in this lane also clears any soft overlay — blank AND dim.
    // Whatever put the screen dark, "wake" means "be visible", and leaving a
    // black div (opaque or translucent) on top of a freshly-powered panel
    // would be its own stuck-dark bug.
    if (cmd.action === 'WAKE') {
      softBlank?.set(false);
      softBlank?.setDim(0);
    }

    if (!nativeHas('displayApply')) {
      console.log(
        `[display ${corrId}] ${via} ${cmd.action} ignored — no native bridge ` +
          '(browser player or pre-wave APK)',
      );
      return { status: 'no-bridge', action: cmd.action };
    }

    // Fire-and-log. The APK answers a JSON verdict rather than throwing for a
    // refusal ("unsupported", "insecure-transport"), so the RESULT is where
    // the truth is — log it verbatim, it is the only field-visible evidence
    // of what the device did with an operator's click.
    nativeCall<string>('displayApply', toDeviceActionJson(cmd))
      .then((res) => {
        console.log(`[display ${corrId}] ${via} ${cmd.action} →`, res);
      })
      .catch((e) => {
        console.warn(
          `[display ${corrId}] ${via} ${cmd.action} bridge call failed:`,
          (e as Error)?.message,
        );
      });
    return { status: 'sent', action: cmd.action };
  } catch (e) {
    console.warn(`[display ${corrId}] ${via} handler threw:`, (e as Error)?.message);
    return { status: 'dropped', reason: 'threw' };
  }
}

export type DisplayInstallResult =
  /** Handed to the device (the native promise settles asynchronously). */
  | { status: 'installed'; schedules: number; recipe: string | null }
  /** Byte-identical to what we already installed — deliberately skipped. */
  | { status: 'unchanged' }
  /** No `display` block on this manifest branch — must NOT disarm anything. */
  | { status: 'absent' }
  /** Browser player / pre-wave APK / legacy-only transport. */
  | { status: 'no-bridge' };

/**
 * Install the manifest's `display` block on the device, if it changed.
 *
 * THE ONLY DELIVERY PATH for the feature's headline capability. Without
 * this call `DisplayConfigStore.load` returns EMPTY on every screen in the
 * fleet and `DisplayScheduler` logs "no active schedules" forever.
 *
 * Three rules, all load-bearing:
 *  1. DIFF FIRST. The block arrives on every poll (5–10 s), and
 *     `setScheduleJson` re-persists, re-resolves the provider chain and
 *     re-arms an AlarmManager on every call. Fingerprint and skip.
 *  2. NEVER INSTALL AN ABSENT BLOCK. The emergency manifest branch and
 *     older cached payloads omit `display` entirely; treating that as "no
 *     schedules" would DISARM a screen's overnight windows during a
 *     lockdown. Absent means do nothing.
 *  3. TRANSLATE, DON'T FORWARD — see the module header.
 *
 * @param fpRef mutable holder of the last-installed fingerprint (a React
 *   ref in production). Latched BEFORE the async call so two overlapping
 *   polls cannot both install; rolled back on rejection so the next poll
 *   retries.
 */
export function installDisplayConfig(
  block: unknown,
  device: DeviceIdentity,
  fpRef: { current: string },
): DisplayInstallResult {
  try {
    if (block === undefined || block === null) return { status: 'absent' };
    const cfg = toDeviceDisplayConfig(block, device);
    const fp = displayConfigFingerprint(cfg);
    if (!cfg || !fp) return { status: 'absent' };
    if (fp === fpRef.current) return { status: 'unchanged' };

    if (!nativeHas('displaySetSchedule')) {
      // ⚠️ DO NOT LATCH. Latching here would mean "if the bridge was not
      // ready the first time we saw this block, never install it" — a
      // silently dead schedule, which is the exact class of bug this whole
      // module exists to kill. Leaving the fingerprint alone costs one
      // `nativeHas` lookup plus a small `JSON.stringify` per 5–10 s poll and
      // installs the instant a bridge appears. (On a legacy-only box this
      // stays false forever by design — `displaySetSchedule` has no
      // `@JavascriptInterface` twin, because a standing nightly blank is
      // strictly worse than a one-off blank that carries a dead-man.)
      return { status: 'no-bridge' };
    }

    const prevFp = fpRef.current;
    fpRef.current = fp;
    const recipeId = typeof cfg.recipe?.vendorId === 'string' ? cfg.recipe.vendorId : null;
    nativeCall<string>('displaySetSchedule', JSON.stringify(cfg))
      .then((res) => {
        // ⚠️ A REFUSAL IS NOT A THROW. The APK answers a refused call with a
        // JSON *string* — `{"ok":false,"code":"insecure-transport"}` — and
        // resolves normally. Latching the fingerprint on that would mean the
        // schedule is never retried: a screen that refused once (legacy
        // transport, emergency hold active, a malformed block) would never
        // blank at night, and nothing would ever say why. That is precisely
        // the latch-on-refusal defect fixed for the emergency hold in
        // emergencyHold.ts — same shape, one function over.
        //
        // So: keep the latch ONLY on an answer that is not an explicit
        // refusal. An unparseable or empty answer is treated as success,
        // because older APKs returned nothing meaningful here and re-arming
        // the AlarmManager every 5–10 s poll is worse than trusting them.
        let refused: string | null = null;
        try {
          const parsed = res ? (JSON.parse(res) as { ok?: unknown; code?: unknown }) : null;
          if (parsed && parsed.ok === false) {
            refused = typeof parsed.code === 'string' ? parsed.code : 'refused';
          }
        } catch {
          /* not JSON — treat as success, see above */
        }
        if (refused) {
          fpRef.current = prevFp;
          console.warn(
            `[display] displaySetSchedule REFUSED (${refused}) — not latching, ` +
              'will retry on the next manifest poll',
          );
          return;
        }
        console.log(
          `[display] schedule installed — ${cfg.schedules.length} window(s), ` +
            `recipe=${recipeId ?? 'none'} →`,
          res,
        );
      })
      .catch((e) => {
        fpRef.current = prevFp;
        console.warn('[display] displaySetSchedule failed:', (e as Error)?.message);
      });
    return { status: 'installed', schedules: cfg.schedules.length, recipe: recipeId };
  } catch (e) {
    console.warn('[display] could not apply manifest display block:', (e as Error)?.message);
    return { status: 'absent' };
  }
}
