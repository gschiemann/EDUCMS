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
 */

import { nativeFire } from './nativeBridge';

/** Method name on the APK's native bridge. Must match the Kotlin side. */
export const DISPLAY_EMERGENCY_HOLD_METHOD = 'displayEmergencyHold';

let lastSent: boolean | null = null;

/**
 * Tell the native shell whether an emergency hold is in force.
 *
 * @param active  true while ANY emergency surface is displayed (tenant/
 *                per-screen override OR a pushed SOS / broadcast / media
 *                alert), false only once the server-of-record says clear.
 * @param force   re-send even when the value hasn't changed. Used by the
 *                eager WS/SSE raise so a native process that restarted
 *                mid-alert is re-armed without waiting for a state flip.
 * @returns       whether a native transport accepted the call. `false` is a
 *                normal, expected outcome in a browser player.
 */
export function signalDisplayEmergencyHold(active: boolean, force = false): boolean {
  try {
    if (!force && lastSent === active) return false;
    lastSent = active;
    return nativeFire(DISPLAY_EMERGENCY_HOLD_METHOD, active);
  } catch {
    // Unreachable in practice (nativeFire is total), but this is
    // emergency-path code — it does not get to throw.
    return false;
  }
}

/** Test seam: forget what we last sent. Not used by production code. */
export function __resetDisplayEmergencyHoldForTests(): void {
  lastSent = null;
}
