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
 * tested without mounting the 9.9k-line player page.
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
 * Actions the API can send, in the SCREAMING_CASE spelling that is
 * authoritative (contract C1). `DisplayControlApi.normalizeActionName`
 * upper-cases and strips non-alphanumerics, so this spelling reaches
 * `SETBRIGHTNESS` / `SETVOLUME` / `BLANK` / `WAKE` / `REBOOT` on the device.
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

export interface DisplayControlCommand {
  action: DisplayAction;
  percent?: number;
  revertAfterMs?: number;
  allowBlack?: boolean;
  /** Server-minted id — echoed into logs so one action greps end-to-end. */
  actionId?: string;
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
 *  3. SIGNATURE + FRESHNESS — for RISK-direction actions only (BLANK, dim,
 *     REBOOT). A captured BLANK replayed hours later is precisely the attack
 *     this closes. Contract C4 keeps WAKE out of this lane: dropping a real
 *     recovery command on a clock-skewed Android box that never got AUTH_OK
 *     would leave a dark screen with no way back, which is the worst outcome
 *     this feature has. (Same trade `pushGate.ts` already makes for
 *     `ALL_CLEAR`, and the APK still refuses anything risk-direction that
 *     arrives on an untrusted transport.)
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

  // 3. Signature + freshness — risk direction only.
  if (!recovery) {
    if (typeof envelope.signature !== 'string' || envelope.signature.length === 0) {
      return { accepted: false, reason: 'unsigned' };
    }
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
  | 'threw';

export type DisplayDispatchResult =
  | { status: 'sent'; action: DisplayAction }
  | { status: 'no-bridge'; action: DisplayAction }
  | { status: 'dropped'; reason: DisplayDropReason };

/**
 * Gate one signed `DISPLAY_CONTROL` frame and hand it to the APK.
 *
 * A no-op without a native bridge, on purpose: `/player` also runs in a
 * desktop browser (previews, the ops console, Playwright), where there is
 * no panel to blank and nothing to call.
 *
 * Never throws — the same socket carries the lockdown OVERRIDE, and a
 * malformed display push must not take down the realtime consumer.
 */
export function dispatchDisplayControl(
  envelope: unknown,
  screenId: string | null | undefined,
  ctx: PushGateContext,
  via: 'WS' | 'SSE' = 'WS',
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
      console.warn(
        `[display ${corrId}] ${via} dropped ${verdict.reason} — action=${String(pl.action)} ` +
          `target=${String(pl.screenId)} self=${screenId}`,
      );
      return { status: 'dropped', reason: verdict.reason };
    }

    // The gate already parsed and allow-listed it; re-parse to get the
    // normalised command rather than trusting the raw payload's shape.
    const cmd = parseDisplayControlCommand(pl);
    if (!cmd) return { status: 'dropped', reason: 'bad-action' };

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
