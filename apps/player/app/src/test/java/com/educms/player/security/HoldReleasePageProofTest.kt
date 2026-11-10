package com.educms.player.security

import com.educms.player.HOLD_RELEASE_REFUSED_JSON
import com.educms.player.WebAppBridge
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * ⚠️ LIFE SAFETY — the page-proof latch (2026-11-09, audit findings A and B).
 *
 * On a WebView that takes `addJavascriptInterface`, a content iframe holds
 * the same `window.EduCmsNative` object the player does. Before this change
 * it could call `displayEmergencyHold(false)` and take a live alert off a
 * panel that was dark before the alert, and it could feed `heartbeatV2` a
 * new paint-proof episode every second so the alert-paint escalation never
 * fired.
 *
 * The two failure directions these tests pin, and they pull opposite ways:
 *
 *  1. Once the player's page has proven it can authenticate, a frame that
 *     cannot must not be able to release the hold or steer the heartbeat.
 *  2. A page that can NEVER authenticate (an old web bundle, a device whose
 *     nonce never lands) must still release its own hold — refusing that is
 *     what pinned panels lit forever on 2026-08-14.
 *
 * ⚠️ A JVM UNIT TEST: it proves the bridge's decision, not Android's
 * reflection dispatch of the new method names and not any OEM WebView. The
 * on-glass drill is the fleet claim.
 */
class HoldReleasePageProofTest {

    private class Effects {
        val fired = mutableListOf<String>()
        fun record(name: String) = fired.add(name)
    }

    private fun bridge(effects: Effects, nonce: BridgeNonce?): WebAppBridge = WebAppBridge(
        onUnpair = {},
        onReload = {},
        getDeviceInfo = { "{}" },
        onCheckForUpdates = {},
        getRecentLogsImpl = { "" },
        uploadDiagnosticsImpl = { "" },
        onExitToDeviceHome = {},
        onSetBootstrap = { _, _ -> },
        onShowUrlOverlay = {},
        onHideUrlOverlay = {},
        onOpenSettingsForManager = {},
        onWebHeartbeat = { effects.record("heartbeat") },
        onWebHeartbeatV2 = { syncOk -> effects.record("heartbeatV2(syncOk=$syncOk)") },
        onWebEmergencyPaint = { effects.record("emergencyPaint") },
        displayEmergencyHoldImpl = { active, trusted, bannerOnly ->
            effects.record("hold(active=$active,trusted=$trusted,bannerOnly=$bannerOnly)")
            """{"ok":true}"""
        },
        bridgeNonce = nonce,
    )

    private val state = """{"syncOk":true,"emergencyPaint":{"painted":false,"identity":"forged"}}"""

    // ── The hold ────────────────────────────────────────────────────────

    @Test
    fun `a page that never authenticates keeps both directions — the pinned-lit failure cannot return`() {
        val effects = Effects()
        val nonce = BridgeNonce()
        val b = bridge(effects, nonce)
        nonce.arm()

        assertEquals("""{"ok":true}""", b.displayEmergencyHold(true))
        assertEquals("""{"ok":true}""", b.displayEmergencyHold(false))

        assertEquals(
            listOf(
                "hold(active=true,trusted=false,bannerOnly=false)",
                "hold(active=false,trusted=false,bannerOnly=false)",
            ),
            effects.fired,
        )
        assertFalse(b.isPageAuthProven())
    }

    @Test
    fun `a nonce on some OTHER gated method is not page proof — an old bundle sends those too`() {
        val effects = Effects()
        val nonce = BridgeNonce()
        val b = bridge(effects, nonce)
        nonce.arm()

        // What a pre-fix web bundle does: nonce on the gated control plane,
        // none on the hold.
        b.setOrientation(nonce.value(), "LANDSCAPE")
        b.getRecentLogs(nonce.value())

        assertFalse("a gated call latched the page proof", b.isPageAuthProven())
        assertEquals("""{"ok":true}""", b.displayEmergencyHold(false))
        assertEquals(listOf("hold(active=false,trusted=false,bannerOnly=false)"), effects.fired)
    }

    @Test
    fun `once the channel has proven the page, an un-authenticated release is refused and nothing runs`() {
        val effects = Effects()
        val nonce = BridgeNonce()
        val b = bridge(effects, nonce)
        nonce.arm()
        b.markPageAuthProven() // what NativeBridgeChannel.onMessage does

        assertEquals(HOLD_RELEASE_REFUSED_JSON, b.displayEmergencyHold(false))
        // …in a loop, the way a hostile frame would.
        repeat(50) { assertEquals(HOLD_RELEASE_REFUSED_JSON, b.displayEmergencyHold(false)) }

        assertEquals("a refused release reached the display layer", emptyList<String>(), effects.fired)
    }

    @Test
    fun `a RAISE is never refused, by anyone, in any state`() {
        val effects = Effects()
        val nonce = BridgeNonce()
        val b = bridge(effects, nonce)
        nonce.arm()
        b.markPageAuthProven()

        assertEquals("""{"ok":true}""", b.displayEmergencyHold(true))
        assertEquals("""{"ok":true}""", b.displayEmergencyHoldAuth("not-the-nonce", true))
        assertEquals("""{"ok":true}""", b.displayEmergencyHoldAuth("", true))
        assertEquals("""{"ok":true}""", b.displayEmergencyHoldAuth(nonce.value(), true))

        assertEquals(4, effects.fired.size)
        assertTrue(effects.fired.all { it == "hold(active=true,trusted=false,bannerOnly=false)" })
    }

    @Test
    fun `the page's own nonce releases the hold and is what proves the page on a legacy-only device`() {
        val effects = Effects()
        val nonce = BridgeNonce()
        val b = bridge(effects, nonce)
        nonce.arm()
        assertFalse(b.isPageAuthProven())

        assertEquals("""{"ok":true}""", b.displayEmergencyHoldAuth(nonce.value(), false))

        assertTrue("a valid nonce did not latch the page proof", b.isPageAuthProven())
        // The legacy transport stays untrusted to the display layer even
        // when the page authenticated — trust there means the channel.
        assertEquals(listOf("hold(active=false,trusted=false,bannerOnly=false)"), effects.fired)

        // From here a frame without the nonce is refused…
        assertEquals(HOLD_RELEASE_REFUSED_JSON, b.displayEmergencyHold(false))
        assertEquals(HOLD_RELEASE_REFUSED_JSON, b.displayEmergencyHoldAuth("0".repeat(64), false))
        assertEquals(HOLD_RELEASE_REFUSED_JSON, b.displayEmergencyHoldAuth("", false))
        assertEquals(HOLD_RELEASE_REFUSED_JSON, b.displayEmergencyHoldAuth(nonce.value().dropLast(1), false))
        // …and the page itself still is not.
        assertEquals("""{"ok":true}""", b.displayEmergencyHoldAuth(nonce.value(), false))
        assertEquals(2, effects.fired.size)
    }

    @Test
    fun `a guessed nonce proves nothing — it is treated exactly like the one-argument call`() {
        val effects = Effects()
        val nonce = BridgeNonce()
        val b = bridge(effects, nonce)
        nonce.arm()

        // Not proven yet: the wrong nonce follows the open rule, as the
        // one-argument form does, and does NOT latch.
        assertEquals("""{"ok":true}""", b.displayEmergencyHoldAuth("0".repeat(64), false))
        assertFalse(b.isPageAuthProven())
        b.heartbeatV2Auth("0".repeat(64), state)
        assertFalse(b.isPageAuthProven())
    }

    @Test
    fun `every main-frame document event re-opens the bridge until the new document proves itself`() {
        val effects = Effects()
        val nonce = BridgeNonce()
        val b = bridge(effects, nonce)
        nonce.arm()
        b.markPageAuthProven()
        assertEquals(HOLD_RELEASE_REFUSED_JSON, b.displayEmergencyHold(false))

        b.resetPageAuthProof() // navigation start / commit / finish

        assertFalse(b.isPageAuthProven())
        // An old cached bundle loaded into the new document can still
        // release its own hold.
        assertEquals("""{"ok":true}""", b.displayEmergencyHold(false))
        assertEquals(listOf("hold(active=false,trusted=false,bannerOnly=false)"), effects.fired)
    }

    @Test
    fun `a bridge with no nonce at all can only be proven by the channel, and then refuses the same way`() {
        // PATH A / preview: no every-frame object exists, so these methods
        // are unreachable from a page. The rule must still be coherent.
        val effects = Effects()
        val b = bridge(effects, nonce = null)

        assertEquals("""{"ok":true}""", b.displayEmergencyHoldAuth("anything", false))
        assertFalse(b.isPageAuthProven())
        b.markPageAuthProven()
        assertEquals(HOLD_RELEASE_REFUSED_JSON, b.displayEmergencyHold(false))
    }

    @Test
    fun `the channel's own hold is untouched — trusted, both directions, banner flag honoured`() {
        val effects = Effects()
        val nonce = BridgeNonce()
        val b = bridge(effects, nonce)
        nonce.arm()
        b.markPageAuthProven()

        b.displayEmergencyHoldViaSecureChannel(true, true)
        b.displayEmergencyHoldViaSecureChannel(false, false)

        assertEquals(
            listOf(
                "hold(active=true,trusted=true,bannerOnly=true)",
                "hold(active=false,trusted=true,bannerOnly=false)",
            ),
            effects.fired,
        )
    }

    // ── heartbeatV2 ─────────────────────────────────────────────────────

    @Test
    fun `before the page has proven itself heartbeatV2 reads its state exactly as before`() {
        val effects = Effects()
        val nonce = BridgeNonce()
        val b = bridge(effects, nonce)
        nonce.arm()

        b.heartbeatV2(state)

        assertEquals(listOf("heartbeat", "emergencyPaint", "heartbeatV2(syncOk=true)"), effects.fired)
    }

    @Test
    fun `after proof an un-authenticated heartbeatV2 is a bare liveness tick — no sync claim, no paint episode`() {
        val effects = Effects()
        val nonce = BridgeNonce()
        val b = bridge(effects, nonce)
        nonce.arm()
        b.markPageAuthProven()

        b.heartbeatV2(state)
        b.heartbeatV2Auth("0".repeat(64), state)

        // Liveness is never starved: that is how a healthy fleet gets
        // reload-looped. Everything else is dropped.
        assertEquals(listOf("heartbeat", "heartbeat"), effects.fired)
    }

    @Test
    fun `the page's authenticated heartbeat passes its state and proves the page`() {
        val effects = Effects()
        val nonce = BridgeNonce()
        val b = bridge(effects, nonce)
        nonce.arm()

        b.heartbeatV2Auth(nonce.value(), state)

        assertTrue(b.isPageAuthProven())
        assertEquals(listOf("heartbeat", "emergencyPaint", "heartbeatV2(syncOk=true)"), effects.fired)

        effects.fired.clear()
        b.heartbeatV2ViaSecureChannel(state)
        assertEquals(listOf("heartbeat", "emergencyPaint", "heartbeatV2(syncOk=true)"), effects.fired)
    }

    // ── Wiring that a unit test cannot execute ──────────────────────────

    private fun source(relative: String): String {
        val candidates = listOf(File("src/main/java/com/educms/player/$relative"), File("app/src/main/java/com/educms/player/$relative"))
        val f = candidates.firstOrNull { it.exists() } ?: error("source not found: $relative")
        return f.readText()
    }

    @Test
    fun `the channel proves the page before it runs the call, and sends heartbeatV2 down the trusted path`() {
        val channel = source("security/NativeBridgeChannel.kt")
        val mark = channel.indexOf("bridge.markPageAuthProven()")
        val run = channel.indexOf("dispatch(bridge, method, args)")
        assertTrue("the channel no longer proves the page", mark >= 0)
        assertTrue("dispatch call site not found", run >= 0)
        assertTrue("the page proof must be set before the call is dispatched", mark < run)
        assertTrue(
            "the channel's heartbeatV2 must use the trusted entry — the plain one drops state once the page is proven",
            channel.contains(""""heartbeatV2" -> { bridge.heartbeatV2ViaSecureChannel(strAt(args, 0)); null }"""),
        )
    }

    @Test
    fun `both WebView hosts reset the page proof on every main-frame document event`() {
        val activity = source("MainActivity.kt")
        val face = source("face/FacePlayerHost.kt")
        assertTrue(
            "MainActivity no longer resets the page proof — a new document would inherit the old one's",
            Regex("""onMainFrameDocument = \{[^}]*webAppBridge\.resetPageAuthProof\(\)""").containsMatchIn(activity),
        )
        assertTrue(
            "FacePlayerHost no longer resets the page proof",
            Regex("""onMainFrameDocument = \{[^}]*faceBridge\.resetPageAuthProof\(\)""").containsMatchIn(face),
        )
    }

    @Test
    fun `the release path has no other un-authenticated door on the every-frame object`() {
        val bridge = source("WebAppBridge.kt")
        // Exactly one call site reaches the display layer with trusted=false,
        // and both every-frame methods go through the helper that owns it.
        val untrusted = Regex("""displayEmergencyHoldImpl\((\w+), false, false\)""").findAll(bridge).count()
        assertEquals("a new un-authenticated hold path appeared", 1, untrusted)
        assertTrue(bridge.contains("holdFromEveryFrameObject(active, authenticated = false)"))
        assertTrue(bridge.contains("holdFromEveryFrameObject(active, authenticated = legacyCallAuthenticated(nonce))"))
    }
}
