/**
 * emergencyHold.ts — the web half of the display-control EMERGENCY
 * INTERLOCK (2026-08-13).
 *
 * ============================================================
 * WHY THIS EXISTS — read before touching anything in here
 * ============================================================
 *
 * The display-control wave added a native blackout overlay that is added to
 * the player Activity's root FrameLayout, ABOVE the WebView, plus remote
 * brightness control and an on-device blank schedule. VenueOS is a
 * life-safety product: these same screens carry lockdown, evacuation and
 * severe-weather alerts. A blanked or dimmed screen that hides an ACTIVE
 * emergency alert can get somebody hurt. Nothing in
 * `com.educms.player.display` consulted emergency state at all.
 *
 * The interlock: while an emergency is displayed, the player holds the
 * display awake and REFUSES every blank and every brightness-lowering
 * action — from the bridge, from the scheduler, and from the dead-man
 * revert path alike. The native side owns the enforcement (and persists the
 * hold across a process restart). THIS module owns the signal.
 *
 * ============================================================
 * THE TWO RULES THAT MAKE THIS SAFE
 * ============================================================
 *
 * 1. RAISE EAGERLY, RELEASE ONLY FROM THE MANIFEST.
 *    A WS/SSE `OVERRIDE`, a pushed SOS/broadcast, or any React state that
 *    puts an alert on the glass raises the hold in the same tick — before
 *    the manifest round-trip that confirms it — because the cost of a
 *    spurious hold is "this screen won't blank for a minute" and the cost
 *    of a late hold is a lockdown alert behind a black overlay.
 *
 *    A hold is RELEASED from exactly one call site: the manifest handler in
 *    `page.tsx`. Two independent reasons, both load-bearing:
 *      - the manifest is the server of record for emergency state, and
 *        `ALL_CLEAR` deliberately does NOT optimistically drop an alert —
 *        otherwise a forged/replayed ALL_CLEAR could unlock blanking on a
 *        screen that is still in a real lockdown;
 *      - the native hold PERSISTS across a process restart, while this web
 *        bundle can reload on its own (REFRESH_WEB, service-worker update,
 *        WebView OOM-kill). A release driven by React state would fire on
 *        every such reload during the frames before the cached emergency
 *        rehydrates — dropping a live hold at the worst possible moment.
 *
 * 2. NEVER THROW, EVER.
 *    This runs inside emergency-path code. `nativeFire` already swallows
 *    its own failures and returns false on an older APK that has no
 *    `displayEmergencyHold` method (browser player, pre-wave APK, sandboxed
 *    frame) — but the whole call is wrapped anyway. A signal that can crash
 *    the render is worse than no signal.
 *
 * Idempotent by design: the same value is only re-sent when forced (a
 * raise), so a 5 s emergency poll does not spam the bridge.
 *
 * ============================================================
 * 3. LATCH ONLY WHAT THE DEVICE ACTUALLY ACCEPTED (2026-08-13 review)
 * ============================================================
 *
 * The release used to set `lastSent = false` BEFORE firing, and ignore the
 * outcome. On a Chromium 83/87 NovaStar Taurus — a production target —
 * `WebViewFeature.WEB_MESSAGE_LISTENER` is unavailable, the origin-scoped
 * channel never attaches, and every bridge call rides the legacy
 * `@JavascriptInterface` object, which passes `trusted = false`
 * unconditionally. `DisplayControlApi.emergencyHoldJson` accepts a RAISE
 * from any transport but REFUSES a release from an untrusted one, returning
 * `{ok:false,code:'insecure-transport'}` as a STRING rather than throwing.
 * So the raise stuck, the release was refused, the dedup latch swallowed it,
 * and the hold became permanent — persisted across reboots, every blank and
 * every brightness lowering refused forever, the panel pinned at 100% 24/7,
 * with no operator-reachable recovery short of wiping app data (which also
 * unpairs the screen).
 *
 * The fix is transport-aware and costs no async on the emergency path:
 *   - `channel`: trusted, so a delivered call is an applied call.
 *   - `legacy`:  the return value is SYNCHRONOUS, so read it. `ok !== true`
 *                means refused — do NOT latch, and the very next manifest
 *                poll retries the release for free (the manifest handler
 *                calls this every poll). The retry is unbounded on purpose:
 *                one cheap JS→Java hop per poll is nothing next to a screen
 *                that is permanently pinned lit, and it means the release
 *                lands the instant the device gets an APK that accepts it.
 *   - method absent / no bridge: there is no native display layer on this
 *                box, so there is no hold to release — latch and stay quiet.
 */

import { nativeFireChecked } from './nativeBridge';

/** Method name on the APK's native bridge. Must match the Kotlin side. */
export const DISPLAY_EMERGENCY_HOLD_METHOD = 'displayEmergencyHold';

/** What the device did with the last signal we sent it. */
export type HoldOutcome =
  /** The device applied it (or is trusted enough that it must have). */
  | 'applied'
  /** Delivered, and the device answered with a refusal. Retry. */
  | 'refused'
  /** No native display layer here (browser player / pre-wave APK). */
  | 'no-native'
  /** Deduped — same value already applied, and no force flag. */
  | 'skipped';

let lastSent: boolean | null = null;
let refusedReleases = 0;

/**
 * Did the device answer with an explicit refusal?
 *
 * Only the legacy transport can answer at all (see the header). Anything we
 * cannot parse as `{"ok":false,...}` is treated as ACCEPTED — this must not
 * become a source of phantom retries on an APK whose return shape changes.
 */
function isRefusal(result: unknown): boolean {
  if (typeof result !== 'string' || result.length === 0) return false;
  try {
    const parsed = JSON.parse(result) as { ok?: unknown };
    return parsed && typeof parsed === 'object' && parsed.ok === false;
  } catch {
    return false;
  }
}

/**
 * Tell the native shell whether an emergency hold is in force.
 *
 * @param active  true while ANY emergency surface is displayed (tenant/
 *                per-screen override OR a pushed SOS / broadcast / media
 *                alert), false only once the server-of-record says clear.
 * @param force   re-send even when the value hasn't changed. Used by the
 *                eager WS/SSE raise so a native process that restarted
 *                mid-alert is re-armed without waiting for a state flip.
 * @returns       what the device did with it. `'no-native'` is a normal,
 *                expected outcome in a browser player.
 */
export function signalDisplayEmergencyHold(
  active: boolean,
  force = false,
  faceIndex = 0,
): HoldOutcome {
  try {
    if (!force && lastSent === active) return 'skipped';

    // ⚠️⚠️ THE FACE ARGUMENT IS OMITTED FOR FACE 0, AND THAT IS LOAD-BEARING.
    //
    // Android's LEGACY `addJavascriptInterface` bridge dispatches by ARITY
    // (see `legacyArgs` in nativeBridge.ts). Passing a second argument to an
    // APK that has no two-arg overload — i.e. EVERY APK up to and including
    // 1.1.17, which is the entire deployed fleet — throws inside the WebView
    // and the call is LOST. `nativeFireChecked` would report it as
    // `delivered: false`, this function would grade that `'no-native'` and
    // LATCH, and the emergency hold would then silently never be applied on
    // any pre-1.1.18 screen. That is a fleet-wide life-safety regression,
    // not a degraded feature.
    //
    // Face 0 is every single-sided screen in existence, so it keeps TODAY'S
    // EXACT CALL SHAPE, byte for byte. A face >= 1 can only exist on a box
    // whose APK hosts faces, which by construction has the overload.
    //
    // (The channel transport is arity-tolerant either way — args ride as a
    // JSON array and an older APK simply reads index 0 — so this rule costs
    // nothing there.)
    const outcome =
      faceIndex > 0
        ? nativeFireChecked(DISPLAY_EMERGENCY_HOLD_METHOD, active, faceIndex)
        : nativeFireChecked(DISPLAY_EMERGENCY_HOLD_METHOD, active);

    if (!outcome.delivered) {
      // No transport, or the method does not exist on this APK. There is no
      // native display layer to hold, so record the state and stay quiet.
      lastSent = active;
      return 'no-native';
    }

    if (isRefusal(outcome.result)) {
      // ⚠️ DO NOT LATCH. Leaving `lastSent` alone is what makes the next
      // manifest poll re-attempt this instead of deduping it away forever.
      refusedReleases += 1;
      // Log the first few, then every 20th, so a Taurus stuck in this state
      // is obvious in the device log without drowning it.
      if (refusedReleases <= 3 || refusedReleases % 20 === 0) {
        console.warn(
          `[emergencyHold] device REFUSED displayEmergencyHold(${active}) on the ` +
            `${outcome.transport} transport (attempt ${refusedReleases}) — ` +
            'will retry on the next manifest poll',
        );
      }
      return 'refused';
    }

    lastSent = active;
    if (active) refusedReleases = 0;
    return 'applied';
  } catch {
    // Unreachable in practice (nativeFireChecked is total), but this is
    // emergency-path code — it does not get to throw.
    return 'no-native';
  }
}

/** Test seam: forget what we last sent. Not used by production code. */
export function __resetDisplayEmergencyHoldForTests(): void {
  lastSent = null;
  refusedReleases = 0;
}
