package com.educms.player.boot

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The boot + registration watchdog's decision logic (2026-09-02, P0-2).
 *
 * Everything here is what the Android-9 Goodview failure needed and did
 * not have: a per-fact deadline, a latch so a broken screen does not
 * re-report forever, and an escalation whose arithmetic is provable rather
 * than asserted (CLAUDE.md player rule 8 — escalation math must be
 * provably reachable).
 */
class BootProgressTest {

    private fun tracker(loadAt: Long = 0L): BootProgressTracker =
        BootProgressTracker().apply { onLoadStarted(loadAt) }

    @Test
    fun `offline content stops boot card without fabricating registration success`() {
        val t = tracker(100L)
        t.onClientBooted(200L)
        t.onRegisterAttempt(300L)
        t.onRegisterResult(400L, 0L, false, RegisterFailureClass.NETWORK, null, "offline")
        assertFalse(t.onContentPresented("pl:last-good", 100L))
        assertTrue(t.onContentPresented("pl:last-good", 150L))
        assertTrue(t.facts().contentStarted)
        assertFalse(t.facts().satisfied)
        assertEquals(0L, t.lastRegisterOkWallMs)
        assertNull(t.evaluate(180_000L))
    }

    @Test
    fun `idle missing stalled and regressed counters do not certify content`() {
        val t = tracker(100L)
        t.onClientBooted(200L)
        assertFalse(t.onContentPresented("idle:connecting", 100L))
        assertFalse(t.onContentPresented("stall|pl:video", 100L))
        assertFalse(t.onContentPresented("pl:video", null))
        assertFalse(t.onContentPresented("pl:video", 0L))
        assertFalse(t.onContentPresented("pl:video", 100L))
        assertFalse(t.onContentPresented("pl:video", 99L))
        assertFalse(t.onContentPresented("pl:video", 100L))
        assertFalse(t.facts().contentStarted)
        t.onLoadStarted(1000L)
        assertFalse(t.onContentPresented("pl:video", 200L))
        t.onClientBooted(1100L)
        assertFalse(t.onContentPresented("pl:video", 200L))
        assertTrue(t.onContentPresented("pl:video", 201L))
        t.onRendererReplaced()
        assertFalse(t.facts().contentStarted)
        assertFalse(t.onContentPresented("pl:video", 202L))
    }

    // ─── the deadlines themselves ────────────────────────────────────

    @Test
    fun `deadlines are the documented 30, 60 and 120 seconds`() {
        assertEquals(30_000L, BootDeadlines.CLIENT_BOOT_MS)
        assertEquals(60_000L, BootDeadlines.REGISTER_ATTEMPT_MS)
        assertEquals(120_000L, BootDeadlines.REGISTER_RESULT_MS)
        assertEquals(2, BootDeadlines.CONSECUTIVE_TRANSPORT_FAILURES)
    }

    @Test
    fun `deadlines are strictly increasing — a later fact never judged first`() {
        assertTrue(BootDeadlines.CLIENT_BOOT_MS < BootDeadlines.REGISTER_ATTEMPT_MS)
        assertTrue(BootDeadlines.REGISTER_ATTEMPT_MS < BootDeadlines.REGISTER_RESULT_MS)
    }

    // ─── fact 1: client boot ─────────────────────────────────────────

    @Test
    fun `no client boot inside the window raises nothing`() {
        val t = tracker()
        assertNull(t.evaluate(29_999L))
    }

    @Test
    fun `no client boot at the deadline raises NO_CLIENT_BOOT`() {
        val t = tracker()
        assertEquals(BootFailureReason.NO_CLIENT_BOOT, t.evaluate(30_000L))
    }

    @Test
    fun `THE SHIPPED BUG — a shell that loads but never runs JS is caught`() {
        // HTTP 200 + onPageFinished happened; nothing else ever did. This is
        // the exact Goodview shape and it must be visible in 30 seconds.
        val t = tracker()
        assertEquals(BootFailureReason.NO_CLIENT_BOOT, t.evaluate(31_000L))
    }

    @Test
    fun `a booted client is never accused of not booting`() {
        val t = tracker()
        t.onClientBooted(5_000L)
        assertNull(t.evaluate(31_000L))
    }

    // ─── fact 2: register attempt ────────────────────────────────────

    @Test
    fun `booted but never registering raises NO_REGISTER_ATTEMPT at 60s`() {
        val t = tracker()
        t.onClientBooted(5_000L)
        assertNull(t.evaluate(59_999L))
        assertEquals(BootFailureReason.NO_REGISTER_ATTEMPT, t.evaluate(60_000L))
    }

    @Test
    fun `a register attempt implies a client boot even if bootProof was dropped`() {
        // The legacy bridge, or a dropped post: fact 1 can go missing while
        // fact 2 arrives. Accusing the page of never booting would be a
        // false diagnostic in front of an installer.
        val t = tracker()
        t.onRegisterAttempt(40_000L)
        assertTrue(t.facts().clientBooted)
        assertNull(t.evaluate(70_000L))
    }

    // ─── fact 3: register result ─────────────────────────────────────

    @Test
    fun `an attempt with no answer raises NO_REGISTER_RESULT at 120s`() {
        val t = tracker()
        t.onClientBooted(3_000L)
        t.onRegisterAttempt(10_000L)
        assertNull(t.evaluate(119_999L))
        assertEquals(BootFailureReason.NO_REGISTER_RESULT, t.evaluate(120_000L))
    }

    @Test
    fun `success satisfies the watchdog forever until the next load`() {
        val t = tracker()
        t.onClientBooted(3_000L)
        t.onRegisterAttempt(10_000L)
        t.onRegisterResult(11_000L, 1_700_000_000_000L, true, null, null, null)
        assertTrue(t.facts().satisfied)
        assertNull(t.evaluate(10L * 60L * 1000L))
    }

    @Test
    fun `success records a wall-clock last-registered stamp`() {
        val t = tracker()
        t.onRegisterResult(11_000L, 1_700_000_000_000L, true, null, null, null)
        assertEquals(1_700_000_000_000L, t.lastRegisterOkWallMs)
    }

    // ─── escalation: two consecutive transport failures ──────────────

    @Test
    fun `ONE transport failure does not raise — a fresh association misses DNS once`() {
        val t = tracker()
        t.onClientBooted(2_000L)
        t.onRegisterAttempt(3_000L)
        t.onRegisterResult(4_000L, 0L, false, RegisterFailureClass.DNS, null, "dns")
        assertNull(t.evaluate(5_000L))
    }

    @Test
    fun `TWO consecutive transport failures raise well before the 120s deadline`() {
        val t = tracker()
        t.onClientBooted(2_000L)
        t.onRegisterAttempt(3_000L)
        t.onRegisterResult(4_000L, 0L, false, RegisterFailureClass.DNS, null, "dns")
        t.onRegisterResult(11_000L, 0L, false, RegisterFailureClass.TIMEOUT, null, "timeout")
        assertEquals(
            BootFailureReason.REPEATED_TRANSPORT_FAILURE,
            t.evaluate(12_000L),
        )
        // The point of the escalation: it fires inside the register-result
        // window, not after it. Two attempts at the web side's 6 s backoff
        // floor land ~13 s in, so this is reachable in practice.
        assertTrue(12_000L < BootDeadlines.REGISTER_RESULT_MS)
    }

    @Test
    fun `an HTTP failure is NOT a transport failure — the server answered`() {
        val t = tracker()
        t.onClientBooted(2_000L)
        t.onRegisterAttempt(3_000L)
        t.onRegisterResult(4_000L, 0L, false, RegisterFailureClass.HTTP, 429, "rate limited")
        t.onRegisterResult(11_000L, 0L, false, RegisterFailureClass.HTTP, 429, "rate limited")
        assertNull(t.evaluate(12_000L))
    }

    @Test
    fun `a non-transport failure BREAKS the consecutive run`() {
        val t = tracker()
        t.onClientBooted(2_000L)
        t.onRegisterAttempt(3_000L)
        t.onRegisterResult(4_000L, 0L, false, RegisterFailureClass.DNS, null, null)
        t.onRegisterResult(5_000L, 0L, false, RegisterFailureClass.HTTP, 503, null)
        t.onRegisterResult(6_000L, 0L, false, RegisterFailureClass.DNS, null, null)
        assertEquals(1, t.facts().consecutiveTransportFailures)
        assertNull(t.evaluate(7_000L))
    }

    @Test
    fun `a success clears the transport run`() {
        val t = tracker()
        t.onRegisterResult(1_000L, 0L, false, RegisterFailureClass.DNS, null, null)
        t.onRegisterResult(2_000L, 1L, true, null, null, null)
        assertEquals(0, t.facts().consecutiveTransportFailures)
    }

    @Test
    fun `a RELOAD does not clear the transport run — otherwise escalation is unreachable`() {
        // The reload is usually OUR OWN recovery. Resetting the counter on it
        // would let a screen with no uplink alternate reload/reset forever and
        // never reach the 2-strike escalation (player rule 8).
        val t = tracker()
        t.onRegisterResult(1_000L, 0L, false, RegisterFailureClass.NETWORK, null, null)
        t.onLoadStarted(2_000L)
        t.onRegisterResult(3_000L, 0L, false, RegisterFailureClass.NETWORK, null, null)
        assertEquals(
            BootFailureReason.REPEATED_TRANSPORT_FAILURE,
            t.evaluate(4_000L),
        )
    }

    // ─── the latch ───────────────────────────────────────────────────

    @Test
    fun `a raised verdict latches — one raise and one report per navigation`() {
        val t = tracker()
        assertEquals(BootFailureReason.NO_CLIENT_BOOT, t.evaluate(30_000L))
        assertNull(t.evaluate(40_000L))
        assertNull(t.evaluate(600_000L))
    }

    @Test
    fun `a new navigation re-arms the latch`() {
        val t = tracker()
        assertEquals(BootFailureReason.NO_CLIENT_BOOT, t.evaluate(30_000L))
        t.onLoadStarted(40_000L)
        assertNull(t.evaluate(50_000L))
        assertEquals(BootFailureReason.NO_CLIENT_BOOT, t.evaluate(70_000L))
    }

    @Test
    fun `nothing is judged before a navigation has ever started`() {
        assertNull(BootProgressTracker().evaluate(999_999L))
    }

    // ─── failure-class parsing ───────────────────────────────────────

    @Test
    fun `every wire class round-trips and garbage degrades to UNKNOWN`() {
        assertEquals(RegisterFailureClass.DNS, RegisterFailureClass.parse("dns"))
        assertEquals(RegisterFailureClass.TLS, RegisterFailureClass.parse("TLS"))
        assertEquals(RegisterFailureClass.HTTP, RegisterFailureClass.parse(" http "))
        assertEquals(RegisterFailureClass.TIMEOUT, RegisterFailureClass.parse("timeout"))
        assertEquals(RegisterFailureClass.NETWORK, RegisterFailureClass.parse("network"))
        assertEquals(RegisterFailureClass.STORAGE, RegisterFailureClass.parse("storage"))
        assertEquals(RegisterFailureClass.UNKNOWN, RegisterFailureClass.parse(null))
        assertEquals(RegisterFailureClass.UNKNOWN, RegisterFailureClass.parse("<script>"))
    }

    @Test
    fun `the transport subset is exactly dns tls timeout network`() {
        assertTrue(RegisterFailureClass.DNS.isTransport)
        assertTrue(RegisterFailureClass.TLS.isTransport)
        assertTrue(RegisterFailureClass.TIMEOUT.isTransport)
        assertTrue(RegisterFailureClass.NETWORK.isTransport)
        assertFalse(RegisterFailureClass.HTTP.isTransport)
        assertFalse(RegisterFailureClass.STORAGE.isTransport)
        assertFalse(RegisterFailureClass.UNKNOWN.isTransport)
    }

    // ─── suppression ─────────────────────────────────────────────────

    @Test
    fun `an emergency hold outranks every other suppression reason`() {
        val why = bootDiagnosticSuppression(
            emergencyHeld = true,
            installPromptOutstanding = true,
            managerGateShown = true,
            setupCeremonyShowing = true,
            lockTaskActive = true,
        )
        assertEquals("an emergency hold is active", why)
    }

    @Test
    fun `each suppression input alone refuses the raise`() {
        assertTrue(bootDiagnosticSuppression(true, false, false, false, false) != null)
        assertTrue(bootDiagnosticSuppression(false, true, false, false, false) != null)
        assertTrue(bootDiagnosticSuppression(false, false, true, false, false) != null)
        assertTrue(bootDiagnosticSuppression(false, false, false, true, false) != null)
        assertTrue(bootDiagnosticSuppression(false, false, false, false, true) != null)
    }

    @Test
    fun `an ordinary broken boot is not suppressed`() {
        assertNull(bootDiagnosticSuppression(false, false, false, false, false))
    }

    // ─── P2-5 (2026-10-03 review): a renderer replacement clears the page's facts ──

    @Test
    fun `P2-5 a replaced renderer stops claiming a booted, satisfied page`() {
        // A healthy page: booted, registered, satisfied — then its renderer dies.
        val t = tracker(loadAt = 1_000L)
        t.onClientBooted(2_000L)
        t.onRegisterAttempt(3_000L)
        t.onRegisterResult(4_000L, 1L, ok = true, failureClass = null, httpStatus = null, message = null)
        assertTrue(t.facts().clientBooted && t.facts().satisfied)

        t.onRendererReplaced()

        // The Back handler reads exactly these two: with them false it raises
        // the native escape instead of dispatching into an empty WebView.
        assertFalse(t.facts().clientBooted)
        assertFalse(t.facts().satisfied)
        assertFalse(t.facts().registerAttempted)
    }

    @Test
    fun `P2-5 no deadline fires during the renderer wait — the reload re-arms them`() {
        val t = tracker(loadAt = 1_000L)
        t.onClientBooted(2_000L)
        t.onRendererReplaced()
        // Minutes later, still waiting on the renderer backoff: no verdict.
        assertNull(t.evaluate(10L * 60_000L))
        // The reload starts a navigation; the 30 s deadline judges it again.
        t.onLoadStarted(20L * 60_000L)
        assertNull(t.evaluate(20L * 60_000L + 29_999L))
        assertEquals(BootFailureReason.NO_CLIENT_BOOT, t.evaluate(20L * 60_000L + 30_000L))
    }

    @Test
    fun `P2-5 the primary's renderer path clears the facts`() {
        var dir: java.io.File? = java.io.File("").absoluteFile
        var main: java.io.File? = null
        while (dir != null && main == null) {
            listOf("src/main/java/com/educms/player/MainActivity.kt", "app/src/main/java/com/educms/player/MainActivity.kt")
                .map { java.io.File(dir, it) }.firstOrNull { it.isFile }?.let { main = it }
            dir = dir.parentFile
        }
        org.junit.Assume.assumeTrue("MainActivity.kt not on disk", main != null)
        val src = main!!.readText()
        val at = src.indexOf("onRendererGone = { failed, didCrash ->")
        val lambda = src.substring(at, src.indexOf("onMainFrameError =", at))
        assertTrue(lambda.contains("BootDiagnostics.onRendererReplaced()"))
    }
}
