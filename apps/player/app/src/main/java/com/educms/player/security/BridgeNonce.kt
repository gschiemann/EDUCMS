package com.educms.player.security

import com.educms.player.logging.PlayerLogger
import java.security.MessageDigest
import java.security.SecureRandom

/**
 * SEC-002 — the per-boot secret that separates the player's own main frame
 * from every other frame in the same WebView.
 *
 * ============================================================
 * WHY THIS EXISTS AT ALL
 * ============================================================
 *
 * `WebView.addJavascriptInterface` has NO origin scoping. The object is
 * materialised in EVERY frame the WebView loads — sandbox flags and opaque
 * origins included — so a WEBPAGE widget's proxied third-party page or an
 * operator-authored EXTERNAL_HTML board holds the same `window.EduCmsNative`
 * the player chrome does, and can call `unpair()`, `exitToDeviceHome()`,
 * `setBootstrap()` or `getRecentLogs()` with it.
 *
 * The structural fix is to never inject that object, which is what
 * [NativeBridgeChannel.attachLegacyCompatShim] does on every WebView that
 * can support it. This class is the fallback for the WebViews that CANNOT
 * (Chromium 83/87 NovaStar Taurus posters and anything else without
 * `WEB_MESSAGE_LISTENER` + `DOCUMENT_START_SCRIPT`), where the legacy
 * object must keep existing or the panel loses its bridge entirely.
 *
 * ⚠️ A NONCE IS A MITIGATION, NOT A TRUST BOUNDARY. It raises the bar from
 * "any frame the operator can schedule" to "a frame that can read the top
 * frame's JS globals". Today no frame the player mounts can do that — every
 * board/WEBPAGE iframe is `allow-scripts`-only (opaque origin) and the two
 * streaming frames that carry `allow-same-origin` point at foreign hosts, so
 * all of them are cross-origin to the player document. But that is a
 * property of the CURRENT frame inventory, not of this mechanism: add one
 * same-origin `allow-same-origin` iframe on the player origin and the nonce
 * is defeated completely. Treat it as a stopgap for the pre-channel device
 * class, and keep the removal criteria in [NativeBridgeChannel] as the plan.
 *
 * ============================================================
 * DEFAULT-DENY (2026-09-04 — SEC-002 re-audit)
 * ============================================================
 *
 * ⛔ THIS GATE USED TO START **OPEN**, AND THAT WAS THE FINDING.
 *
 * The original design allowed every call until the nonce had been proven
 * delivered ([arm]), reasoning that a stale service-worker web bundle
 * predating the nonce would otherwise silently lose `unpair`,
 * `setBootstrap` and the diagnostics overlay. That is a real cost — but it
 * bought a **fail-OPEN window on exactly the device class that has no other
 * boundary**:
 *
 *   - on a WebView with no `DOCUMENT_START_SCRIPT` the value is delivered by
 *     `evaluateJavascript` from the main-frame document callbacks;
 *   - Chromium can drop an `evaluateJavascript` issued before the new
 *     document commits, so delivery can slip to `onPageFinished`;
 *   - `onPageFinished` fires AFTER sub-frames have loaded and run script.
 *
 * A hostile frame that ran in that interval held an ungated
 * `window.EduCmsNative`. And "not yet armed" is precisely the state in which
 * the player cannot tell its own frame from anyone else's — the worst
 * possible moment to answer yes.
 *
 * **[accepts] now refuses unless the caller presents the current value.**
 * `isArmed` is no longer a permission. It is an OBSERVABILITY flag that
 * separates "a hostile frame called" (armed, wrong value) from "we never
 * established the boundary on this device" (never armed) in the log and in
 * `deviceInfo()`. There is no window, because there is no state in which an
 * un-nonced caller is allowed.
 *
 * ============================================================
 * WHY THIS CANNOT BRICK A SCREEN — READ BEFORE ADDING AN ENTRY
 * ============================================================
 *
 * Two units were bricked at install in 2026-08, so "fails safe" here means
 * "keeps showing content", never "refuses to run". A device that can never
 * arm still boots, still plays its playlist, still reconciles its manifest,
 * still heartbeats, still takes a REFRESH_WEB recovery, and ⚠️ still takes
 * an emergency hold — because **none of those pass through this gate.** See
 * [GATED_METHODS] for the classification and, just as importantly, the
 * omissions.
 *
 * What such a device loses is the CONTROL-PLANE + EXFILTRATION set: unpair,
 * exit-to-home, re-bootstrap, orientation, URL overlay, the settings jump,
 * the update check and the two log paths. Every one is an operator-initiated
 * action that now fails LOUDLY (a refusal log line, and [REFUSAL_JSON] for
 * the value-returning ones) instead of costing content. That is the trade
 * the re-audit asked for, stated plainly.
 *
 * The delivery path is hardened to match: `MainActivity` retries the
 * top-frame injection on a bounded schedule until it arms, so the MAIN
 * frame's own exposure to this refusal is a few hundred milliseconds after
 * page start — comfortably ahead of every gated call, each of which is
 * downstream of a network round trip. The web side reads
 * `window.__eduCmsBridgeNonce` LAZILY, at call time (`nativeBridge.ts` →
 * `legacyArgs`), so a late delivery is fully effective with nothing to
 * replay.
 */
class BridgeNonce(
    private val random: SecureRandom = SecureRandom(),
) {

    @Volatile
    private var current: String = generate()

    @Volatile
    private var isArmed: Boolean = false

    /**
     * Observability only (SEC-002 re-audit). True once SOMETHING called a
     * gated method before delivery armed the gate. On a healthy device that
     * is normally zero; a screen that reports it persistently is either a
     * device where injection never lands (operator-visible degradation) or
     * a frame probing the surface early. Surfaced through `deviceInfo()`.
     */
    @Volatile
    private var sawRefusalWhileUnarmed: Boolean = false

    /**
     * Fresh value for a new WebView session. Disarms so that
     * [armed] keeps telling the truth about whether THIS value has been
     * delivered.
     *
     * ⚠️ Disarming no longer opens the gate (default-deny since 2026-09-04)
     * — the OLD value stops working the instant it is replaced, which is the
     * point of rotating, and the new one works as soon as a caller can
     * present it.
     */
    @Synchronized
    fun rotate(): String {
        current = generate()
        isArmed = false
        return current
    }

    /** The value to inject into the main frame. Never persisted anywhere. */
    fun value(): String = current

    /**
     * Called ONLY from the callback that proves the current value reached
     * the main frame of the player document. Enforcement begins here.
     */
    fun arm() {
        if (!isArmed) {
            isArmed = true
            PlayerLogger.i(TAG, "bridge nonce delivered to the main frame — legacy gate ARMED")
        }
    }

    fun armed(): Boolean = isArmed

    /** See [sawRefusalWhileUnarmed]. Reported, never acted on. */
    fun refusedWhileUnarmed(): Boolean = sawRefusalWhileUnarmed

    /**
     * True when [candidate] may drive a gated method — i.e. it presented the
     * CURRENT value. **DEFAULT-DENY: there is no state in which an absent or
     * wrong nonce is accepted**, armed or not. See the class KDoc for why the
     * unarmed-allow was the SEC-002 re-audit finding, and why closing it
     * cannot cost a screen its content.
     *
     * Constant-time comparison (`MessageDigest.isEqual`) so a frame cannot
     * recover the value one character at a time by timing the refusal.
     */
    fun accepts(candidate: String?): Boolean {
        if (candidate.isNullOrEmpty()) return false
        val expected = current.toByteArray(Charsets.US_ASCII)
        val actual = candidate.toByteArray(Charsets.US_ASCII)
        return MessageDigest.isEqual(expected, actual)
    }

    /**
     * The one place a gated `@JavascriptInterface` method decides. Logs the
     * method name on refusal — never the nonce, and never the caller's
     * arguments (they are attacker-controlled).
     *
     * The two refusal messages are deliberately DIFFERENT, because they mean
     * different things to whoever reads the log:
     *
     *  - **armed** ⇒ the boundary is up and something on the wrong side of it
     *    called. In the field that line means a frame tried.
     *  - **not armed** ⇒ we never got the value into the main frame on this
     *    device. It is the honest signal that this screen is running in the
     *    degraded, no-control-plane mode — and it is also what the player's
     *    own main frame would hit inside the first few hundred ms of a load,
     *    before delivery lands.
     */
    fun allow(method: String, candidate: String?): Boolean {
        if (accepts(candidate)) return true
        if (isArmed) {
            PlayerLogger.w(
                TAG,
                "REFUSED \"$method\" — no valid bridge nonce (a frame that is not the player called it)",
            )
        } else {
            sawRefusalWhileUnarmed = true
            PlayerLogger.w(
                TAG,
                "REFUSED \"$method\" — bridge nonce NOT YET DELIVERED to the main frame. " +
                    "Content, heartbeat, recovery and the emergency hold are unaffected; the " +
                    "control-plane surface stays closed until delivery arms it.",
            )
        }
        return false
    }

    private fun generate(): String {
        val bytes = ByteArray(NONCE_BYTES)
        random.nextBytes(bytes)
        // Hex, not android.util.Base64: this class must be exercisable in a
        // JVM unit test, where every android.* call is stubbed out, and
        // java.util.Base64 is API 26 while minSdk here is 24.
        val sb = StringBuilder(NONCE_BYTES * 2)
        for (b in bytes) {
            val v = b.toInt() and 0xFF
            sb.append(HEX[v ushr 4])
            sb.append(HEX[v and 0x0F])
        }
        return sb.toString()
    }

    companion object {
        private const val TAG = "BridgeNonce"
        private const val NONCE_BYTES = 32
        private val HEX = "0123456789abcdef".toCharArray()

        /** The global the main frame reads it from. Must match `nativeBridge.ts`. */
        const val JS_GLOBAL = "__eduCmsBridgeNonce"

        /**
         * The methods on the legacy every-frame surface that REQUIRE the
         * nonce, and the single source of truth for that list.
         *
         * ============================================================
         * THE CLASSIFICATION (SEC-002 re-audit, 2026-09-04)
         * ============================================================
         *
         * Every `@JavascriptInterface` method on [com.educms.player.WebAppBridge]
         * falls in exactly one of three classes. The gate covers class 1 and
         * NOTHING else, and that split is the whole reason default-deny is
         * safe to ship to a wall-mounted panel:
         *
         *  **1. CONTROL-PLANE + EXFILTRATION — gated (this list).**
         *  Changes what the screen IS, where it trusts, or what leaves it:
         *  unpair, exit-to-home, setBootstrap (the OTA trust anchor),
         *  setDeviceToken, setOrientation, showUrlOverlay (puts arbitrary
         *  content on the glass), openSettingsForManager, the two update
         *  checks, getRecentLogs and uploadDiagnostics (both ship device log
         *  material off-box). A refusal here costs an OPERATOR ACTION, never
         *  content, and it is loud.
         *
         *  **2. LIFELINE — never gated, and never add one here.**
         *  reload, hideUrlOverlay, heartbeat, heartbeatV2, bootProof,
         *  registerAttempt, registerResult, openSetupChecklist, and the
         *  display-control family (displayApply / displaySetSchedule /
         *  displayEnrollAdmin / ⚠️ displayEmergencyHold). These are how a
         *  screen boots, proves itself, recovers, and receives a life-safety
         *  alert. This class is the answer to "can this brick a screen?" —
         *  a device that never arms keeps every one of them.
         *
         *  **3. READ-ONLY DIAGNOSTIC — ungated, an accepted trade.**
         *  deviceInfo, probeDisplay, displayCapabilities, ctsSerial*. These
         *  return device fingerprinting material and NO secrets (no api root,
         *  no device JWT, no pairing code, no log tail — see the KDoc on
         *  `WebAppBridge.probeDisplay`). A hostile frame learns roughly what
         *  the UA string already tells it. ⚠️ RESIDUAL, NOT CLOSED: the
         *  `ctsSerial*` trio can open/close a physical serial port, which is
         *  an availability lever on a CTS scoreboard. It stays ungated here
         *  ONLY because moving a method into class 1 changes its ARITY, and
         *  a cached web bundle that predates the move would then be refused
         *  permanently rather than for a few hundred ms — a fleet
         *  regression, not a window. Move it in a deliberate wave with the
         *  three-file contract, not on a security patch.
         *
         * ⚠️ THE OMISSIONS ARE AS DELIBERATE AS THE ENTRIES. Gating a
         * method whose refusal strands a screen is worse than the threat it
         * models — that lesson is already written into
         * `WebAppBridge.displayEmergencyHold`. So the gate covers the
         * control-plane and exfiltration set, and deliberately leaves:
         *
         *  - `reload` — a REFRESH_WEB recovery command rides it (CLAUDE.md
         *    player rule 6), and the web's `nativeFire` reports a refusal as
         *    a delivery, so a gated `reload` would silently kill that
         *    recovery path on any bundle that predates the nonce. A hostile
         *    frame calling it is a nuisance, not an escape: it restores the
         *    assigned content rather than changing anything.
         *  - `hideUrlOverlay` — recovery direction. It can only ever REMOVE
         *    content from the glass; `showUrlOverlay` (which puts content
         *    there) is gated.
         *  - `heartbeat` / `heartbeatV2` / `bootProof` / `registerAttempt` /
         *    `registerResult` — starving these is how you reload-loop a
         *    healthy fleet.
         *  - `deviceInfo` / `probeDisplay` / `displayCapabilities` — read-only
         *    fingerprinting material, already judged an accepted trade.
         *  - `displayApply` / `displaySetSchedule` / `displayEmergencyHold` /
         *    `displayEnrollAdmin` — these already mark a legacy caller
         *    untrusted unconditionally, or gate on physical presence, which
         *    is a STRONGER control than a nonce. A second gate here would be
         *    a second way to break the ⚠️ life-safety emergency interlock.
         *  - `ctsSerial*` — device-scoped serial access; a separate story.
         */
        val GATED_METHODS: List<String> = listOf(
            "checkForUpdates",
            "checkForUpdatesUserInitiated",
            "exitToDeviceHome",
            "getRecentLogs",
            "openSettingsForManager",
            "setBootstrap",
            "setDeviceToken",
            "setOrientation",
            "showUrlOverlay",
            "unpair",
            "uploadDiagnostics",
        )

        /** The refusal a value-returning gated method hands back. */
        const val REFUSAL_JSON = """{"ok":false,"code":"bridge-nonce"}"""
    }
}
