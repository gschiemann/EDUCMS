package com.educms.player.security

import com.educms.player.WebAppBridge
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * SEC-002 — THE HOSTILE FRAME.
 *
 * ============================================================
 * WHAT THIS TEST IS, AND WHAT IT IS NOT
 * ============================================================
 *
 * On a WebView that still takes `addJavascriptInterface`, every frame —
 * a sandboxed EXTERNAL_HTML board, a third-party page a WEBPAGE widget
 * iframed through `/api/v1/proxy/web`, a compromised embedded script —
 * holds the SAME `window.EduCmsNative` object the player chrome does, and
 * Android gives the callee no way to ask who called. The only thing that
 * separates the two callers is that the player's main frame was handed a
 * per-boot secret and the other frames were not.
 *
 * This test models exactly that asymmetry against the REAL [WebAppBridge]:
 * two "frames" call the same object, one knowing the nonce and one not,
 * and every destructive method must fire for the first and no method must
 * fire for the second.
 *
 * ⚠️ IT IS A JVM UNIT TEST, SO IT PROVES THE GATE, NOT THE FLEET. It does
 * not exercise Android's `@JavascriptInterface` reflection dispatch (which
 * is what actually resolves the 0-arg vs 1-arg overloads at runtime), nor
 * the WebView's origin rules, nor the OEM WebView builds this ships to.
 * Those are hardware-qualification items — see
 * `apps/player/HARDWARE-QUALIFICATION.md` and the SEC-002 report.
 */
class HostileFrameBridgeTest {

    /** Every effect the bridge can have, recorded rather than performed. */
    private class Effects {
        val fired = mutableListOf<String>()
        fun record(name: String) = fired.add(name)
        fun clear() = fired.clear()
    }

    private fun bridge(effects: Effects, nonce: BridgeNonce): WebAppBridge = WebAppBridge(
        onUnpair = { effects.record("unpair") },
        onReload = { effects.record("reload") },
        getDeviceInfo = { """{"model":"test"}""" },
        onCheckForUpdates = { user -> effects.record("checkForUpdates(user=$user)") },
        getRecentLogsImpl = { effects.record("getRecentLogs"); "LOG TAIL" },
        uploadDiagnosticsImpl = { effects.record("uploadDiagnostics"); "queued" },
        onExitToDeviceHome = { effects.record("exitToDeviceHome") },
        onSetBootstrap = { _, _ -> effects.record("setBootstrap") },
        onSetDeviceToken = { effects.record("setDeviceToken") },
        onShowUrlOverlay = { effects.record("showUrlOverlay") },
        onHideUrlOverlay = { effects.record("hideUrlOverlay") },
        onOpenSettingsForManager = { effects.record("openSettingsForManager") },
        onSetOrientation = { effects.record("setOrientation") },
        onWebHeartbeat = { effects.record("heartbeat") },
        // ⚠️ LIFE SAFETY — wired so the non-brick test below can assert that
        // an emergency hold still reaches the native display layer on a
        // device whose nonce delivery never lands.
        displayEmergencyHoldImpl = { active, _ ->
            effects.record("displayEmergencyHold($active)")
            """{"ok":true}"""
        },
        bridgeNonce = nonce,
    )

    /**
     * Every destructive call a frame can make, in both shapes a frame could
     * try: the historic 0-argument form, and the nonce-bearing form with a
     * value the frame guessed.
     */
    private fun callEverythingDestructive(b: WebAppBridge, guess: String) {
        // 1. the historic arity — what an un-nonced frame reaches for
        b.unpair()
        b.exitToDeviceHome()
        b.setBootstrap("https://evil.example", "fp")
        b.setDeviceToken("stolen.jwt.value")
        b.showUrlOverlay("https://evil.example/fake-lockdown")
        b.setOrientation("PORTRAIT")
        b.checkForUpdates()
        b.checkForUpdatesUserInitiated()
        b.getRecentLogs()
        b.uploadDiagnostics()
        b.openSettingsForManager()
        // 2. the nonce-bearing arity with a value it does not have
        b.unpair(guess)
        b.exitToDeviceHome(guess)
        b.setBootstrap(guess, "https://evil.example", "fp")
        b.setDeviceToken(guess, "stolen.jwt.value")
        b.showUrlOverlay(guess, "https://evil.example/fake-lockdown")
        b.setOrientation(guess, "PORTRAIT")
        b.checkForUpdates(guess)
        b.checkForUpdatesUserInitiated(guess)
        b.getRecentLogs(guess)
        b.uploadDiagnostics(guess)
        b.openSettingsForManager(guess)
    }

    @Test
    fun `a hostile frame reaches NO destructive method once the gate is armed`() {
        val effects = Effects()
        val nonce = BridgeNonce()
        val b = bridge(effects, nonce)
        nonce.arm()

        callEverythingDestructive(b, guess = "0".repeat(64))
        // …and a few shapes a real attacker would try before giving up.
        callEverythingDestructive(b, guess = "")
        callEverythingDestructive(b, guess = nonce.value().dropLast(1))
        callEverythingDestructive(b, guess = nonce.value().uppercase())

        assertEquals(
            "a hostile frame drove native code: ${effects.fired}",
            emptyList<String>(),
            effects.fired,
        )
    }

    @Test
    fun `a hostile frame gets a refusal VALUE, never real data`() {
        val effects = Effects()
        val nonce = BridgeNonce()
        val b = bridge(effects, nonce)
        nonce.arm()

        // The exfiltration pair: no log tail, no upload receipt.
        assertFalse("device logs leaked to a hostile frame", b.getRecentLogs().contains("LOG TAIL"))
        assertFalse(b.getRecentLogs("wrong").contains("LOG TAIL"))
        assertEquals(BridgeNonce.REFUSAL_JSON, b.uploadDiagnostics())
        assertEquals(BridgeNonce.REFUSAL_JSON, b.uploadDiagnostics("wrong"))
        // A refused update check must not answer with the build version
        // either — that is the string the OTA path logs as "who asked".
        assertEquals(BridgeNonce.REFUSAL_JSON, b.checkForUpdates())
        assertEquals(BridgeNonce.REFUSAL_JSON, b.checkForUpdatesUserInitiated())
        assertTrue(effects.fired.isEmpty())
    }

    @Test
    fun `the MAIN FRAME — the one holding the nonce — still drives everything`() {
        val effects = Effects()
        val nonce = BridgeNonce()
        val b = bridge(effects, nonce)
        nonce.arm()
        val n = nonce.value()

        b.unpair(n)
        b.exitToDeviceHome(n)
        b.setBootstrap(n, "https://api.venue-os.app", "fp")
        b.setDeviceToken(n, "jwt")
        b.showUrlOverlay(n, "https://example.com/")
        b.setOrientation(n, "PORTRAIT")
        b.checkForUpdates(n)
        b.checkForUpdatesUserInitiated(n)
        b.getRecentLogs(n)
        b.uploadDiagnostics(n)
        b.openSettingsForManager(n)

        assertEquals(
            listOf(
                "unpair",
                "exitToDeviceHome",
                "setBootstrap",
                "setDeviceToken",
                "showUrlOverlay",
                "setOrientation",
                "checkForUpdates(user=false)",
                "checkForUpdates(user=true)",
                "getRecentLogs",
                "uploadDiagnostics",
                "openSettingsForManager",
            ),
            effects.fired,
        )
        assertEquals("LOG TAIL", b.getRecentLogs(n))
    }

    /**
     * ⚠️ THE FLEET-SAFETY HALF. Gating a method whose refusal strands a
     * screen is worse than the threat it models. These must keep working
     * from ANY frame, including one with no nonce, on a nonce-armed device:
     *
     *  - `reload` carries the REFRESH_WEB recovery command, and the web's
     *    `nativeFire` reports a refusal as a delivery, so a gated reload
     *    silently kills recovery on any pre-nonce bundle;
     *  - `hideUrlOverlay` is recovery-direction — it only removes content;
     *  - `heartbeat` starvation is how the native watchdog reload-loops a
     *    healthy fleet.
     */
    @Test
    fun `the recovery-direction methods are NOT gated`() {
        val effects = Effects()
        val nonce = BridgeNonce()
        val b = bridge(effects, nonce)
        nonce.arm()

        b.reload()
        b.hideUrlOverlay()
        b.heartbeat()

        assertEquals(listOf("reload", "hideUrlOverlay", "heartbeat"), effects.fired)
    }

    /**
     * ⛔ THE RE-AUDIT FINDING, AS A TEST (2026-09-04).
     *
     * This case used to assert the OPPOSITE — that the historic 0-argument
     * calls still fired before delivery — and that assertion was the
     * fail-open window written down as a requirement. On a device with no
     * document-start injection the value arrives by `evaluateJavascript`
     * from the page callbacks; Chromium can drop one issued before the
     * document commits, so delivery can slip to `onPageFinished`, which
     * fires AFTER sub-frames have loaded and run script. A hostile frame
     * that ran in that interval held an ungated `window.EduCmsNative`.
     *
     * Default-deny closes it: an un-nonced destructive call is refused in
     * EVERY state, including the pre-delivery one.
     */
    @Test
    fun `before the nonce is delivered, destructive calls are REFUSED`() {
        val effects = Effects()
        val nonce = BridgeNonce()
        val b = bridge(effects, nonce)
        // deliberately NOT armed — this is the window the audit found.
        assertFalse(nonce.armed())

        callEverythingDestructive(b, guess = "0".repeat(64))

        assertEquals(
            "a frame drove native code inside the pre-arm window: ${effects.fired}",
            emptyList<String>(),
            effects.fired,
        )
        // The value-returning pair must not leak either.
        assertFalse("device logs leaked before the gate armed", b.getRecentLogs().contains("LOG TAIL"))
        assertEquals(BridgeNonce.REFUSAL_JSON, b.uploadDiagnostics())

        // …and the player's OWN main frame is not locked out: presenting the
        // value works from the first millisecond, armed or not. This is why
        // a late delivery costs nothing that has to be replayed.
        b.unpair(nonce.value())
        b.setBootstrap(nonce.value(), "https://api.venue-os.app", "fp")
        assertEquals(listOf("unpair", "setBootstrap"), effects.fired)
    }

    /**
     * ⚠️ THE NON-BRICK GUARANTEE, ON THE WORST DEVICE THERE IS.
     *
     * A panel whose WebView never runs our injected script never arms. Two
     * units were bricked at install in 2026-08, so "fails safe" here has to
     * mean "keeps showing content", not "refuses to run". Everything a
     * screen needs to boot, prove itself, recover and receive a LIFE-SAFETY
     * alert must keep working from any frame on such a device — that is the
     * entire reason class 2 of [BridgeNonce.GATED_METHODS]'s classification
     * exists.
     */
    @Test
    fun `a device that can NEVER arm still boots, plays, recovers and heartbeats`() {
        val effects = Effects()
        val nonce = BridgeNonce()
        val b = bridge(effects, nonce)
        // Never armed, and never will be: injection does not land here.
        assertFalse(nonce.armed())

        b.heartbeat()
        b.reload()
        b.hideUrlOverlay()
        // ⚠️ THE ONE THAT MUST NEVER BE GATED. A lockdown reaching this
        // panel, and the all-clear releasing it, on a screen whose nonce
        // never arrived.
        assertEquals("""{"ok":true}""", b.displayEmergencyHold(true))
        assertEquals("""{"ok":true}""", b.displayEmergencyHold(false))

        assertEquals(
            "the lifeline set was caught by the gate — this bricks a screen",
            listOf(
                "heartbeat",
                "reload",
                "hideUrlOverlay",
                "displayEmergencyHold(true)",
                "displayEmergencyHold(false)",
            ),
            effects.fired,
        )
        // …and the read-only diagnostic that the dashboard reads per screen.
        assertEquals("""{"model":"test"}""", b.deviceInfo())
    }

    /**
     * A bridge built WITHOUT a nonce is the PATH A / preview shape: no
     * `addJavascriptInterface` was ever called, so there is nothing to gate
     * and the channel's own origin + main-frame checks are the whole
     * control. Everything must work unchanged.
     */
    @Test
    fun `a bridge with no nonce at all behaves exactly as it did before SEC-002`() {
        val effects = Effects()
        val b = WebAppBridge(
            onUnpair = { effects.record("unpair") },
            onReload = { effects.record("reload") },
            getDeviceInfo = { "{}" },
            onCheckForUpdates = { effects.record("checkForUpdates") },
            getRecentLogsImpl = { "LOG TAIL" },
            uploadDiagnosticsImpl = { "queued" },
            onExitToDeviceHome = { effects.record("exitToDeviceHome") },
            onSetBootstrap = { _, _ -> effects.record("setBootstrap") },
            onShowUrlOverlay = { effects.record("showUrlOverlay") },
            onHideUrlOverlay = { effects.record("hideUrlOverlay") },
            onOpenSettingsForManager = { effects.record("openSettingsForManager") },
        )
        b.unpair()
        b.exitToDeviceHome()
        assertEquals(listOf("unpair", "exitToDeviceHome"), effects.fired)
        assertEquals("LOG TAIL", b.getRecentLogs())
        assertEquals("", b.channelNonce())
    }

    /**
     * The channel's own entry point. A message that reaches
     * `NativeBridgeChannel.dispatch` has already passed the exact-origin
     * AND main-frame gates, so it is handed [WebAppBridge.channelNonce] and
     * must never be refused — otherwise turning on the nonce would break
     * the SECURE transport, which is the opposite of the point.
     */
    @Test
    fun `the channel's own nonce always satisfies the gate`() {
        val effects = Effects()
        val nonce = BridgeNonce()
        val b = bridge(effects, nonce)
        nonce.arm()

        b.unpair(b.channelNonce())
        b.exitToDeviceHome(b.channelNonce())
        assertEquals(listOf("unpair", "exitToDeviceHome"), effects.fired)
    }
}
