package com.educms.player.security

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * SEC-002 — the nonce holder's own contract.
 *
 * The behaviour that matters here is the ARMING DIRECTION. A gate that
 * refuses before the value has reached the page would take `unpair`,
 * `setBootstrap` and the diagnostics overlay away from every stale
 * service-worker bundle in the field, on a wall-mounted panel, with no
 * symptom but silence. So: open until delivered, closed after.
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

    @Test
    fun `an UNARMED gate allows everything — including no nonce at all`() {
        val n = BridgeNonce()
        assertFalse(n.armed())
        assertTrue(n.accepts(null))
        assertTrue(n.accepts(""))
        assertTrue(n.accepts("nonsense"))
        assertTrue(n.allow("unpair", null))
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

    @Test
    fun `rotating DISARMS — a value nobody has been given must not lock the page out`() {
        val n = BridgeNonce()
        n.arm()
        val old = n.value()
        val fresh = n.rotate()
        assertNotEquals(old, fresh)
        assertFalse("rotate() left the gate armed on an undelivered value", n.armed())
        assertTrue(n.accepts(null))
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
