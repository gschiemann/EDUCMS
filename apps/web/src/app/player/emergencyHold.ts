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
// Rendering follows the requested hold immediately, even if the native
// transport refuses it. Only an accepted live clear may reopen content.
let renderHold = false;
// A known text banner protects wake/brightness without interrupting playback.
// Volatile only: a reload under an unattributed persisted hold stays protective.
let bannerOnly = false;
let bannerInset = 0;
let bannerRotation: 0 | 90 = 0;
// PAGE-LOCAL playback suppression while the APK reports its native video
// stopped `emergency-held` (2026-11-02, the double-sided echo loop). It is
// NEVER sent over the bridge and never becomes a hold membership:
//   • a double-sided unit has ONE native hold with per-face membership, and
//     the APK stops EITHER face's native video `emergency-held` while ANY
//     face holds. Turning that stop into `displayEmergencyHold(true)` made
//     each face re-raise itself while the other face was still releasing
//     after an all-clear, and the never-painted episodes drove the APK's
//     paint ladder to reload/relaunch the page for minutes.
//   • only a manifest / signed push may raise the native hold (rule 1 above).
//     A real alert the native watch raised first still holds natively; this
//     page draws the black hold surface instead of regular web media until
//     its own manifest / push raises (and paints) the alert.
// Cleared by a LIVE no-alert manifest (any `signalDisplayEmergencyHold(false)`,
// which only the server-driven manifest handler sends) or by the APK
// reporting a non-held state.
let nativeHeldSuppression = false;
// 2026-11-02: the APK could not PROVE its live native video correct under a
// banner (a display Android rotated from its natural orientation; natively
// oriented panels keep the banner), so its hold is a full takeover.
// Sticky until the hold releases: no later banner signal may re-open banner
// posture over a video the app has stopped.
let bannerRefused = false;
const holdListeners = new Set<() => void>();
function notifyHoldListeners(): void {
  holdListeners.forEach(listener => { try { listener(); } catch { /* one observer cannot block an alert */ } });
}
function publishRenderHold(active: boolean): void {
  if (renderHold === active) return;
  renderHold = active;
  notifyHoldListeners();
}

/**
 * The APK reported (true) or no longer reports (false) that its native video
 * on THIS face is stopped `emergency-held`. Page-local only: no bridge call,
 * no native hold membership, no paint episode. Never throws.
 */
export function noteNativeEmergencyHeld(held: boolean): void {
  try {
    if (nativeHeldSuppression === held) return;
    nativeHeldSuppression = held;
    notifyHoldListeners();
  } catch { /* emergency-path code does not get to throw */ }
}

/** READ-ONLY, for tests and diagnostics: is the page-local native-held suppression on? */
export function nativeEmergencyHeldSuppressed(): boolean {
  return nativeHeldSuppression;
}
export function subscribeDisplayEmergencyHold(listener: () => void): () => void {
  holdListeners.add(listener);
  return () => { holdListeners.delete(listener); };
}

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
export function signalDisplayEmergencyHold(active: boolean, force = false, requestedBanner = false): HoldOutcome {
  const isBanner = requestedBanner && !bannerRefused;
  // A live no-alert manifest ends any page-local native-held suppression,
  // whatever the device does with the release below.
  if (!active) noteNativeEmergencyHeld(false);
  if (active && bannerOnly !== isBanner) {
    // Reserve space before the first measured banner frame can reach native.
    if (isBanner && bannerInset === 0) bannerInset = 0.1;
    bannerOnly = isBanner;
    // Uses the existing origin/nonce-gated media channel. Older APKs ignore
    // the additive op and retain their protective takeover behaviour.
    sendBannerGeometry(isBanner);
    holdListeners.forEach(listener => { try { listener(); } catch { /* observers cannot block alerting */ } });
  }
  if (active) publishRenderHold(true);
  try {
    if (!force && lastSent === active) { publishRenderHold(active); return 'skipped'; }

    const outcome = active && isBanner
      ? nativeFireChecked(DISPLAY_EMERGENCY_HOLD_METHOD, true, true)
      : nativeFireChecked(DISPLAY_EMERGENCY_HOLD_METHOD, active);

    if (!outcome.delivered) {
      // No transport, or the method does not exist on this APK. There is no
      // native display layer to hold, so record the state and stay quiet.
      lastSent = active;
      publishRenderHold(active);
      if (!active) clearBannerMode();
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
    publishRenderHold(active);
    if (!active) clearBannerMode();
    if (active) refusedReleases = 0;
    return 'applied';
  } catch {
    // Unreachable in practice (nativeFireChecked is total), but this is
    // emergency-path code — it does not get to throw.
    return 'no-native';
  }
}

/**
 * READ-ONLY: is regular playback held (an alert surface is
 * up, or a pushed OVERRIDE is still being confirmed)? Native-first never
 * asks the app for a picture while this is true (design §7 E1/E2). It
 * raises before transport dispatch and survives a refused release.
 */
export function displayEmergencyHoldRaised(): boolean {
  return renderHold || nativeHeldSuppression;
}

/** Playback suppression is separate from the unchanged display interlock. */
export function displayEmergencyPlaybackHeld(): boolean {
  return (renderHold && !bannerOnly) || nativeHeldSuppression;
}

/**
 * READ-ONLY: did the APK refuse banner posture for this alert? The page then
 * shows the FULL broadcast presentation (a takeover), never a banner over a
 * native video the app has stopped or could not place.
 */
export function displayEmergencyBannerRefused(): boolean {
  return bannerRefused;
}

/**
 * The APK reported `broadcastBannerPosture: {posture: 'refused'}` on
 * `sharedVideoState`. Turn the banner into a takeover: playback is held and the
 * surface decision renders the full presentation. Never throws; never releases.
 */
export function noteNativeBannerRefused(reason?: string): void {
  if (bannerRefused || !renderHold) return;
  bannerRefused = true;
  console.warn(`[emergencyHold] the app refused banner posture (${reason ?? 'unknown'}) — showing the full broadcast presentation`);
  if (bannerOnly) {
    bannerOnly = false;
    sendBannerGeometry(false);
  }
  holdListeners.forEach(listener => { try { listener(); } catch { /* observers cannot block alerting */ } });
  // Re-assert the hold as a takeover so the APK's posture matches the page's.
  try { signalDisplayEmergencyHold(true, true, false); } catch { /* emergency path never throws */ }
}

/** One `sharedVideoState` reply → the refusal reason, or null. Bounded and total. */
export function bannerRefusalFromState(state: unknown): string | null {
  const posture = (state as { broadcastBannerPosture?: { posture?: unknown; reason?: unknown } } | null)?.broadcastBannerPosture;
  if (!posture || typeof posture !== 'object' || posture.posture !== 'refused') return null;
  return typeof posture.reason === 'string' && posture.reason.length <= 64 ? posture.reason : 'refused';
}

/** Paint validation reinforces the existing alert's posture; it must not
 * silently turn a known banner into a playback takeover. */
export function reassertDisplayEmergencyHold(): HoldOutcome {
  // Reads `renderHold` itself (not the getter), so a page-local native-held
  // suppression alone can never be turned into a bridge raise here.
  return signalDisplayEmergencyHold(true, true, renderHold && bannerOnly);
}

function sendBannerGeometry(active: boolean): void {
  // Native wire geometry uses a reserved fraction, rather than a CSS style.
  const inset = bannerInset;
  try { nativeFireChecked('sharedVideoPrepare', JSON.stringify({ version: 4, op: 'banner', active, inset, rotation: bannerRotation })); }
  catch { /* the display hold below still raises on any media-channel failure */ }
}

function clearBannerMode(): void {
  if (bannerRefused) { bannerRefused = false; holdListeners.forEach(listener => { try { listener(); } catch { /* observers cannot block alerting */ } }); }
  if (!bannerOnly) return;
  bannerOnly = false;
  sendBannerGeometry(false);
}

export function updateBroadcastBannerInset(fraction: number, rotation: 0 | 90 = 0): void {
  const next = Number.isFinite(fraction) ? Math.max(0, Math.min(0.4, fraction)) : 0;
  if (next === bannerInset && rotation === bannerRotation) return;
  bannerInset = next;
  bannerRotation = rotation;
  if (bannerOnly) sendBannerGeometry(true);
}

/** Test seam: forget what we last sent. Not used by production code. */
export function __resetDisplayEmergencyHoldForTests(): void {
  lastSent = null;
  refusedReleases = 0;
  bannerOnly = false;
  bannerInset = 0;
  bannerRotation = 0;
  nativeHeldSuppression = false;
  bannerRefused = false;
  publishRenderHold(false);
}
