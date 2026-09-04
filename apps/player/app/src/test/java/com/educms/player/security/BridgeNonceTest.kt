package com.educms.player.security

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * SEC-002 — the nonce holder's own contract.
 *
 * ⛔ THE BEHAVIOUR THAT MATTERS IS **DEFAULT-DENY** (re-audit, 2026-09-04).
 * This gate used to answer `true` to everything until the value had been
 * proven delivered ([BridgeNonce.arm]) — and "not yet delivered" is exactly
 * the state in which the player cannot tell its own frame from a hostile
 * one, on the only device class that has no other boundary. The tests below
 * assert the closed direction in every state; the fleet-safety half (which
 * methods are outside the gate entirely, so a device that never arms keeps
 * playing content and keeps taking an emergency hold) lives in
 * [HostileFrameBridgeTest].
 */
class BridgeNonceTest {

    @Test
    fun `a fresh nonce is 64 hex characters`() {
        val n = BridgeNonce()
        assertEquals(64, n.value().length)
        assertTrue("not hex: ${n.value()}", Regex("^[0-9a-f]{64}$").matches(n.value()))
    }

    @Test
    fun `rotate produces a different value every time`() {
        val n = BridgeNonce()
        val seen = mutableSetOf(n.value())
        repeat(50) { seen.add(n.rotate()) }
        assertEquals("rotate() repeated a value", 51, seen.size)
    }

    /**
     * ⛔ THE REGRESSION GUARD FOR THE SEC-002 RE-AUDIT FINDING. If any of
     * these flip back to `true`, the pre-arm fail-open window is back: on a
     * Chromium-83/87 panel the value is delivered by `evaluateJavascript`
     * from the document callbacks, an injection issued before the document
     * commits can be dropped, and the retry lands at `onPageFinished` — AFTER
     * sub-frames have loaded and run script.
     */
    @Test
    fun `an UNARMED gate REFUSES everything that is not the current value`() {
        val n = BridgeNonce()
        assertFalse(n.armed())
        assertFalse("unarmed gate accepted a missing nonce", n.accepts(null))
        assertFalse("unarmed gate accepted an empty nonce", n.accepts(""))
        assertFalse("unarmed gate accepted a guess", n.accepts("nonsense"))
        assertFalse("unarmed gate accepted a 64-char guess", n.accepts("0".repeat(64)))
        assertFalse("unarmed gate allowed an un-nonced unpair()", n.allow("unpair", null))
        for (m in BridgeNonce.GATED_METHODS) {
            assertFalse("unarmed gate allowed an un-nonced \"$m\"", n.allow(m, null))
            assertFalse("unarmed gate allowed a guessed \"$m\"", n.allow(m, "0".repeat(64)))
        }
    }

    /**
     * …and the other half of default-deny: the value itself works from the
     * first millisecond, armed or not. This is what keeps PATH A (the
     * origin-scoped channel, which presents `channelNonce()` after clearing
     * strictly stronger gates and never arms anything) working unchanged,
     * and it is why an early main-frame call is not lost the moment
     * delivery lands.
     */
    @Test
    fun `the CURRENT value is accepted even before the gate arms`() {
        val n = BridgeNonce()
        assertFalse(n.armed())
        assertTrue("the real value was refused before arming", n.accepts(n.value()))
        assertTrue(n.allow("unpair", n.value()))
        assertFalse("allow() must not arm the gate as a side effect", n.armed())
    }

    /** Observability, not a permission — see [BridgeNonce.refusedWhileUnarmed]. */
    @Test
    fun `a refusal before delivery is recorded for the dashboard`() {
        val n = BridgeNonce()
        assertFalse(n.refusedWhileUnarmed())
        assertFalse(n.allow("unpair", null))
        assertTrue("an unarmed refusal was not recorded", n.refusedWhileUnarmed())

        val clean = BridgeNonce()
        clean.arm()
        assertFalse(clean.allow("unpair", null))
        assertFalse(
            "an ARMED refusal was mislabelled as a delivery failure",
            clean.refusedWhileUnarmed(),
        )
    }

    @Test
    fun `an ARMED gate accepts ONLY the exact current value`() {
        val n = BridgeNonce()
        n.arm()
        assertTrue(n.armed())
        assertTrue(n.accepts(n.value()))
        assertFalse(n.accepts(null))
        assertFalse(n.accepts(""))
        assertFalse(n.accepts("0".repeat(64)))
        // A prefix of the real value must not pass — the comparison is on
        // the whole byte array, not a startsWith.
        assertFalse(n.accepts(n.value().dropLast(1)))
        assertFalse(n.accepts(n.value() + "0"))
    }

    /**
     * Rotation replaces the secret and resets [BridgeNonce.armed] so that
     * flag keeps telling the truth about whether THIS value was delivered.
     * Under default-deny that reset no longer opens anything: the old value
     * dies immediately and the new one works the moment a caller can present
     * it.
     */
    @Test
    fun `rotating retires the old value immediately and never opens the gate`() {
        val n = BridgeNonce()
        n.arm()
        val old = n.value()
        val fresh = n.rotate()
        assertNotEquals(old, fresh)
        assertFalse("rotate() left the gate armed on an undelivered value", n.armed())
        assertFalse("rotate() re-opened the gate to un-nonced callers", n.accepts(null))
        assertFalse("the OLD value survived a rotation", n.accepts(old))
        assertTrue("the FRESH value was refused before arming", n.accepts(fresh))
        n.arm()
        assertFalse("the OLD value still worked after a rotation", n.accepts(old))
        assertTrue(n.accepts(fresh))
    }

    @Test
    fun `the gated method list is the one the WebAppBridge overloads implement`() {
        // Guards against an entry being added here and nowhere else. The
        // cross-file half (Kotlin <-> nativeBridge.ts) lives in
        // LegacyBridgeExposureTest.
        assertEquals(
            listOf(
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
            ),
            BridgeNonce.GATED_METHODS,
        )
    }
}
