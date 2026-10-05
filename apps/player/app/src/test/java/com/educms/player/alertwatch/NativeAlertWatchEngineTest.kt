package com.educms.player.alertwatch

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Base64

/**
 * THE NATIVE ALERT WATCH, END TO END, ON A VIRTUAL CLOCK (2026-10-05, 1.1.22).
 *
 * The box this fix is for cannot be reached with adb, so the only place the
 * whole sequence can be watched running is here: a dark panel, a manifest
 * that starts reporting an alert, a page that wakes — or does not — and the
 * reloads that follow. Every port the machine touches is a recording fake.
 *
 * ⚠️ There is no "release" on the fake because there is none on the real
 * `Ports`: the machine CANNOT lower a hold. `held` only ever goes false here
 * when the test plays the page.
 */
class NativeAlertWatchEngineTest {

    private val screenId = "7d0c4a3e-1b2f-4c5d-8e9f-0a1b2c3d4e5f"

    private fun jwt(): String {
        val enc = Base64.getUrlEncoder().withoutPadding()
        return enc.encodeToString("""{"alg":"HS256","typ":"JWT"}""".toByteArray()) + "." +
            enc.encodeToString("""{"sub":"$screenId","kind":"device"}""".toByteArray()) + "." +
            enc.encodeToString(ByteArray(32) { 1 })
    }

    private val primary = NativeAlertWatchPolicy.targetOf(0, jwt())!!

    private inner class Sim : NativeAlertWatchEngine.Ports {
        var now = 0L
        var interactive = false
        var apiRoot: String? = "https://api.example.test"
        var apiRootAllowed = true
        var targets = listOf(primary)

        /** What the server would answer right now. */
        var serverAlert = false
        var serverFails: PollOutcome? = null
        private var etagSeq = 0
        private var currentEtag = "etag-0"
        private var etagAlert = false

        /** Runs inside a fetch, before it returns — for "the panel came on mid-request". */
        var duringFetch: (() -> Unit)? = null

        val fetchAt = ArrayList<Long>()
        val conditional = ArrayList<Boolean>()
        var held = false
        var pageRaisedAt: Long? = null
        var inForeground = false
        var pageLoadStartedAt: Long? = null
        var cpuHeld = false
        val cpuReleasedWhileDark = ArrayList<Long>()
        val events = ArrayList<String>()
        val raiseAt = ArrayList<Long>()
        val reloadAt = ArrayList<Long>()
        val launchAt = ArrayList<Long>()
        val logs = ArrayList<String>()
        var planReads = 0

        override fun nowMs() = now
        override fun panelInteractive() = interactive
        override fun plan(): NativeAlertWatchEngine.WatchPlan {
            planReads += 1
            return NativeAlertWatchEngine.WatchPlan(apiRoot, apiRootAllowed, targets)
        }

        override fun fetchManifest(target: WatchTarget, ifNoneMatch: String?): PollOutcome {
            fetchAt.add(now)
            conditional.add(ifNoneMatch != null)
            duringFetch?.invoke()
            serverFails?.let { return it.copy(sentEtag = ifNoneMatch) }
            if (serverAlert != etagAlert) {
                etagAlert = serverAlert
                currentEtag = "etag-${++etagSeq}"
            }
            // The emergency branch never 304s; a normal manifest does.
            if (!serverAlert && ifNoneMatch == currentEtag) return PollOutcome(304, sentEtag = ifNoneMatch)
            return PollOutcome(
                200,
                if (serverAlert) ManifestScan.ALERT else ManifestScan.NO_ALERT,
                etag = if (serverAlert) null else currentEtag,
                sentEtag = ifNoneMatch,
            )
        }

        override fun holdHeld() = held
        override fun pageRaisedAtMs(face: Int) = pageRaisedAt
        override fun raise(face: Int, firstForThisAlert: Boolean) {
            held = true
            raiseAt.add(now)
            events.add(if (firstForThisAlert) "raise" else "re-raise")
        }

        override fun playerInForeground() = inForeground
        override fun bringPlayerForward(attempt: Int) {
            launchAt.add(now)
            events.add("launch")
        }

        override fun reloadPage(face: Int, attempt: Int, why: String) {
            reloadAt.add(now)
            pageLoadStartedAt = now
            events.add("reload")
        }

        override fun pageLoadStartedAtMs(face: Int) = pageLoadStartedAt
        override fun cpuLock(hold: Boolean) {
            if (!hold && cpuHeld && !interactive) cpuReleasedWhileDark.add(now)
            cpuHeld = hold
        }

        override fun log(level: NativeAlertWatchEngine.Level, message: String) {
            logs.add(message)
        }

        /** The page, alive: it raises the hold itself. */
        fun pageRaises() {
            held = true
            pageRaisedAt = now
        }

        /** The page, on a live all-clear: the only thing that releases. */
        fun pageReleases() {
            held = false
            pageRaisedAt = null
        }
    }

    /**
     * Run the loop the way `NativeAlertWatch.runLoop` does until [untilMs]:
     * pass, sleep what it says, pass again. [each] runs before every pass.
     */
    private fun run(sim: Sim, engine: NativeAlertWatchEngine, untilMs: Long, each: (Long) -> Unit = {}) {
        while (sim.now < untilMs) {
            each(sim.now)
            val sleep = engine.pass()
            if (sleep == null) {
                // The loop would end here; the next kick (a minute later at
                // most) starts it again.
                sim.now = minOf(untilMs, sim.now + 60_000)
            } else {
                sim.now = minOf(untilMs, sim.now + sleep)
            }
        }
    }

    // ─── rule 1: panel off only ──────────────────────────────────────

    @Test
    fun `PANEL ON — not one request, not one read of the stores, no wake lock`() {
        val sim = Sim().apply { interactive = true; serverAlert = true }
        val engine = NativeAlertWatchEngine(sim)
        assertNull("nothing to watch: the loop ends", engine.pass())
        run(sim, engine, 10 * 60_000L)
        assertTrue(sim.fetchAt.isEmpty())
        assertEquals(0, sim.planReads)
        assertFalse(sim.cpuHeld)
        assertTrue(sim.raiseAt.isEmpty())
    }

    @Test
    fun `NOT PAIRED, or no usable API root — no request and no wake lock, and it says why once`() {
        for (breakIt in listOf<(Sim) -> Unit>(
            { it.targets = emptyList() },
            { it.apiRoot = null },
            { it.apiRootAllowed = false },
        )) {
            val sim = Sim().apply { serverAlert = true }
            breakIt(sim)
            val engine = NativeAlertWatchEngine(sim)
            run(sim, engine, 5 * 60_000L)
            assertTrue(sim.fetchAt.isEmpty())
            assertFalse(sim.cpuHeld)
            assertTrue(sim.raiseAt.isEmpty())
            assertEquals(1, sim.logs.count { it.contains("NOT being watched natively") })
        }
    }

    @Test
    fun `PANEL OFF — first poll within three seconds, then every fifteen, conditional after the first`() {
        val sim = Sim()
        val engine = NativeAlertWatchEngine(sim)
        run(sim, engine, 64_000L)
        assertEquals(listOf(3_000L, 18_000L, 33_000L, 48_000L, 63_000L), sim.fetchAt)
        assertEquals(listOf(false, true, true, true, true), sim.conditional)
        assertTrue("the CPU is held for the whole dark period", sim.cpuHeld)
        assertTrue(sim.cpuReleasedWhileDark.isEmpty())
        assertTrue("no alert: nothing is raised", sim.raiseAt.isEmpty())
    }

    @Test
    fun `the panel coming on stops the polling at once and lets the CPU go`() {
        val sim = Sim()
        val engine = NativeAlertWatchEngine(sim)
        run(sim, engine, 40_000L)
        val before = sim.fetchAt.size
        sim.interactive = true
        run(sim, engine, 10 * 60_000L)
        assertEquals(before, sim.fetchAt.size)
        assertFalse(sim.cpuHeld)
        // A new dark period starts with an unconditional read.
        sim.interactive = false
        val resumeAt = sim.now
        run(sim, engine, resumeAt + 5_000L)
        assertEquals(resumeAt + 3_000L, sim.fetchAt.last())
        assertFalse(sim.conditional.last())
    }

    // ─── the alert ───────────────────────────────────────────────────

    @Test
    fun `AN ALERT BEHIND A DARK PANEL is raised natively within one poll, then the player is brought forward`() {
        val sim = Sim()
        val engine = NativeAlertWatchEngine(sim)
        run(sim, engine, 100_000L)
        sim.serverAlert = true
        val triggeredAt = sim.now
        run(sim, engine, triggeredAt + 16_000L)

        assertEquals(1, sim.raiseAt.size)
        assertTrue("raised ${sim.raiseAt[0] - triggeredAt} ms after the trigger", sim.raiseAt[0] - triggeredAt <= 15_000)
        assertTrue(sim.held)
        // Raise FIRST (it ends a user standby and re-arms the wake flags), launch second.
        assertEquals(listOf("raise", "launch"), sim.events.take(2))
        assertTrue(sim.logs.none { it.contains("PLAYER_NATIVE_ALERT_RELOAD") })
    }

    @Test
    fun `the page confirming means no reload, ever`() {
        val sim = Sim()
        val engine = NativeAlertWatchEngine(sim)
        sim.serverAlert = true
        run(sim, engine, 4_000L)
        assertEquals(1, sim.raiseAt.size)
        // The raise woke the panel; the page resumes and raises 6 s later.
        sim.interactive = true
        sim.inForeground = true
        run(sim, engine, 9_000L)
        sim.pageRaises()
        run(sim, engine, 30 * 60_000L)
        assertTrue(sim.reloadAt.isEmpty())
        assertEquals(1, sim.logs.count { it.startsWith("PLAYER_NATIVE_ALERT_CONFIRMED") })
        assertEquals("the page owns it from here: no polling with the panel on", 1, sim.fetchAt.size)
    }

    @Test
    fun `THE PAGE NEVER CONFIRMS — reloads at 20 s, 80 s and 140 s after the raise, then it gives up and the hold stays`() {
        val sim = Sim()
        val engine = NativeAlertWatchEngine(sim)
        sim.serverAlert = true
        run(sim, engine, 4_000L)
        val raisedAt = sim.raiseAt.single()
        sim.interactive = true          // the panel woke
        sim.inForeground = true         // the Activity resumed — and the page stays silent
        run(sim, engine, 60 * 60_000L)

        assertEquals(listOf(20_000L, 80_000L, 140_000L), sim.reloadAt.map { it - raisedAt })
        assertEquals(1, sim.logs.count { it.startsWith("PLAYER_NATIVE_ALERT_UNCONFIRMED") })
        assertTrue("RAISE ONLY: giving up never lowers the hold", sim.held)
    }

    @Test
    fun `a page that confirms after the first reload stops the reloads`() {
        val sim = Sim()
        val engine = NativeAlertWatchEngine(sim)
        sim.serverAlert = true
        run(sim, engine, 4_000L)
        sim.interactive = true
        sim.inForeground = true
        run(sim, engine, 30_000L, each = { })
        assertEquals(1, sim.reloadAt.size)
        sim.pageRaises()                // the reloaded page boots and sees the alert
        run(sim, engine, 30 * 60_000L)
        assertEquals(1, sim.reloadAt.size)
    }

    @Test
    fun `A NEW ALERT gets a fresh budget — and never a reload less than a minute after the last`() {
        val sim = Sim()
        val engine = NativeAlertWatchEngine(sim)
        sim.serverAlert = true
        run(sim, engine, 4_000L)
        sim.interactive = true
        sim.inForeground = true
        run(sim, engine, 10 * 60_000L)
        assertEquals(3, sim.reloadAt.size)

        // All-clear: the page (reloaded, alive now) releases on a live manifest.
        sim.serverAlert = false
        sim.pageReleases()
        // Night again: somebody turns the panel off, and a second alert starts.
        sim.interactive = false
        sim.inForeground = false
        run(sim, engine, sim.now + 60_000L)
        sim.serverAlert = true
        val secondAt = sim.now
        sim.interactive = false
        run(sim, engine, secondAt + 16_000L)
        assertEquals("the second alert is raised", 2, sim.events.count { it == "raise" })
        sim.interactive = true
        sim.inForeground = true
        run(sim, engine, secondAt + 30 * 60_000L)
        assertEquals("three more reloads for the new alert, not zero", 6, sim.reloadAt.size)
        sim.reloadAt.zipWithNext().forEach { (a, b) -> assertTrue("reloads ${b - a} ms apart", b - a >= 60_000) }
    }

    @Test
    fun `an alert that ends before the page ever saw it still gets the page reloaded, so the page can release the hold`() {
        // The web page only reports a release it has not already latched, so
        // a hold the watch raised while the page slept would otherwise stay
        // up until something else reloaded the page.
        val sim = Sim()
        val engine = NativeAlertWatchEngine(sim)
        sim.serverAlert = true
        run(sim, engine, 4_000L)
        sim.serverAlert = false         // a ten-second drill; the wake did not take
        run(sim, engine, 30_000L)
        assertEquals(1, sim.reloadAt.size)
        assertTrue(sim.logs.any { it.contains("the alert has ended on the server") })
        assertTrue("…and the watch itself still lowers nothing", sim.held)
        sim.pageReleases()              // the fresh page reads the live manifest
        run(sim, engine, 10 * 60_000L)
        assertEquals(1, sim.reloadAt.size)
        assertEquals(1, sim.logs.count { it.startsWith("PLAYER_NATIVE_ALERT_PAGE_CLEARED") })
    }

    // ─── rule 3: unknown is not an answer ────────────────────────────

    @Test
    fun `failures raise nothing, back off to a minute, and are called out`() {
        for (failure in listOf(PollOutcome(null, error = "SocketTimeoutException"), PollOutcome(401), PollOutcome(503))) {
            val sim = Sim().apply { serverAlert = true; serverFails = failure }
            val engine = NativeAlertWatchEngine(sim)
            run(sim, engine, 10 * 60_000L)
            assertTrue(sim.raiseAt.isEmpty())
            assertFalse(sim.held)
            val gaps = sim.fetchAt.zipWithNext().map { (a, b) -> b - a }
            assertEquals(listOf(15_000L, 30_000L, 60_000L, 60_000L), gaps.take(4))
            assertTrue(gaps.all { it in 15_000L..60_000L })
            assertEquals(1, sim.logs.count { it.startsWith("PLAYER_NATIVE_ALERT_BLIND") })
            assertTrue("the CPU stays held: the watch is still trying", sim.cpuHeld)

            // The moment the manifest answers, the alert is raised.
            sim.serverFails = null
            run(sim, engine, sim.now + 61_000L)
            assertEquals(1, sim.events.count { it == "raise" })
        }
    }

    @Test
    fun `a 304 after a failure still means no alert, and a failure never erases a known alert`() {
        val sim = Sim()
        val engine = NativeAlertWatchEngine(sim)
        run(sim, engine, 20_000L)                       // 200 no alert, then a 304
        sim.serverFails = PollOutcome(502)
        run(sim, engine, 80_000L)
        sim.serverFails = null
        run(sim, engine, 200_000L)
        assertTrue(sim.raiseAt.isEmpty())
        assertTrue("conditional requests resume with the remembered validator", sim.conditional.last())
    }

    @Test
    fun `an answer that lands after the panel came on belongs to the page — no native raise`() {
        val sim = Sim().apply { serverAlert = true }
        sim.duringFetch = { sim.interactive = true }   // somebody pressed power mid-request
        val engine = NativeAlertWatchEngine(sim)
        run(sim, engine, 60_000L)
        assertEquals(1, sim.fetchAt.size)
        assertTrue(sim.raiseAt.isEmpty())
        assertFalse(sim.held)
    }

    // ─── a panel that will not wake, a player that will not come forward ──

    @Test
    fun `while the panel stays dark the alert is re-asserted on every poll`() {
        val sim = Sim().apply { serverAlert = true }
        val engine = NativeAlertWatchEngine(sim)
        run(sim, engine, 50_000L)
        assertEquals(listOf("raise", "re-raise", "re-raise", "re-raise"), sim.events.filter { it.contains("raise") })
        assertTrue(sim.cpuHeld)
    }

    @Test
    fun `the player is launched a bounded number of times, never while it is on the glass`() {
        val sim = Sim().apply { serverAlert = true }
        val engine = NativeAlertWatchEngine(sim)
        run(sim, engine, 4_000L)
        sim.interactive = true                          // woke, but the launcher is on top
        run(sim, engine, 60 * 60_000L)
        assertEquals(NativeAlertWatchPolicy.MAX_RELAUNCHES_PER_ALERT, sim.launchAt.size)
        sim.launchAt.zipWithNext().forEach { (a, b) -> assertTrue(b - a >= NativeAlertWatchPolicy.RELAUNCH_MIN_GAP_MS) }
        assertEquals(1, sim.logs.count { it.startsWith("PLAYER_NATIVE_ALERT_NOT_ON_GLASS") })

        val onGlass = Sim().apply { serverAlert = true; inForeground = true }
        val e2 = NativeAlertWatchEngine(onGlass)
        run(onGlass, e2, 5 * 60_000L)
        assertTrue(onGlass.launchAt.isEmpty())
    }

    @Test
    fun `a hold the page already holds is not second-guessed when the panel goes dark mid-alert`() {
        // The page raised long ago and is showing the alert; something forces
        // the panel off. The watch re-asserts, but a page that has this alert
        // is never reloaded off the glass.
        val sim = Sim().apply { serverAlert = true }
        sim.pageRaises()
        sim.now = 3_600_000L
        val engine = NativeAlertWatchEngine(sim)
        run(sim, engine, sim.now + 4_000L)
        assertEquals(1, sim.raiseAt.size)
        sim.interactive = true
        sim.inForeground = true
        run(sim, engine, sim.now + 30 * 60_000L)
        assertTrue(sim.reloadAt.isEmpty())
    }
}
