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
 * ARMING — WHY THE GATE STARTS OPEN
 * ============================================================
 *
 * The APK and the web bundle deploy independently, and the player's service
 * worker can serve a cached bundle. A bundle that predates the nonce calls
 * the 0-argument methods; if the gate refused those from the first
 * millisecond, a stale bundle on a wall-mounted panel would silently lose
 * `unpair`, `setBootstrap` and the diagnostics overlay with no way to tell
 * why.
 *
 * So the gate ARMS only once the value has actually been delivered into the
 * main frame ([arm] is called from the delivery callback). Until then every
 * call is allowed and the un-nonced ones are logged. That direction is
 * deliberate: an injection failure degrades to exactly today's behaviour
 * (loudly), never to a bricked screen. Once armed, an un-nonced call to a
 * gated method is refused and logged — and that log line is the detector:
 * in the field it means some frame tried.
 */
class BridgeNonce(
    private val random: SecureRandom = SecureRandom(),
) {

    @Volatile
    private var current: String = generate()

    @Volatile
    private var isArmed: Boolean = false

    /**
     * Fresh value for a new WebView session. Disarms until the new value has
     * been delivered — a rotated-but-undelivered nonce must not lock the
     * page out of its own bridge.
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

    /**
     * True when [candidate] may drive a gated method.
     *
     * Constant-time comparison (`MessageDigest.isEqual`) so a frame cannot
     * recover the value one character at a time by timing the refusal.
     */
    fun accepts(candidate: String?): Boolean {
        if (!isArmed) return true
        if (candidate.isNullOrEmpty()) return false
        val expected = current.toByteArray(Charsets.US_ASCII)
        val actual = candidate.toByteArray(Charsets.US_ASCII)
        return MessageDigest.isEqual(expected, actual)
    }

    /**
     * The one place a gated `@JavascriptInterface` method decides. Logs the
     * method name on refusal — never the nonce, and never the caller's
     * arguments (they are attacker-controlled).
     */
    fun allow(method: String, candidate: String?): Boolean {
        if (accepts(candidate)) {
            if (!isArmed && candidate.isNullOrEmpty()) {
                PlayerLogger.w(
                    TAG,
                    "bridge nonce NOT YET ARMED — allowing un-nonced \"$method\" (pre-nonce web bundle?)",
                )
            }
            return true
        }
        PlayerLogger.w(TAG, "REFUSED \"$method\" — no valid bridge nonce (a frame that is not the player called it)")
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
