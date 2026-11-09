package com.educms.manager.alertwatch

import com.educms.manager.alertwatch.AlertWatchWatchdogPolicy.Action
import com.educms.manager.alertwatch.AlertWatchWatchdogPolicy.Facts
import com.educms.manager.alertwatch.AlertWatchWatchdogPolicy.Memory
import com.educms.manager.alertwatch.AlertWatchWatchdogPolicy.Mode
import com.educms.manager.alertwatch.AlertWatchWatchdogPolicy.Rung
import com.educms.manager.alertwatch.AlertWatchWatchdogPolicy.Stamp
import com.educms.manager.alertwatch.AlertWatchWatchdogPolicy.StampState
import com.educms.manager.alertwatch.AlertWatchWatchdogPolicy.Step
import com.educms.manager.alertwatch.AlertWatchWatchdogPolicy.Verdict
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * THE ALERT-WATCH WATCHDOG — every rule on a virtual clock (2026-11-08, wave 5).
 *
 * The device is a bench: the Manager ticks every 30 s; the Player's stamp is
 * whatever the test says it is. Nothing here touches Android.
 */
class AlertWatchWatchdogPolicyTest {

    private val P = AlertWatchWatchdogPolicy
    private val T = P.TICK_MS

    /** A bench that ticks the policy and lets a test move the Player's stamp. */
    private class Bench(start: Long = 1_000_000L) {
        var now = start
        var mem = Memory()
        var managerInteractive: Boolean? = false
        var stamp: Stamp? = null
        var heartbeatAgeMs: Long? = 10_000L
        val actions = mutableListOf<Pair<Long, Action>>()
        val verdicts = mutableListOf<Pair<Long, Verdict>>()

        fun stampNow(state: StampState = StampState.WATCHING, mode: Mode = Mode.ON, dark: Boolean = true, hold: Boolean = false, faces: Int = 1, reason: String? = null) {
            stamp = Stamp(atElapsedMs = now, state = state, panelDark = dark, holdHeld = hold, faces = faces, mode = mode, reason = reason)
        }

        fun tick(): Step {
            val step = AlertWatchWatchdogPolicy.tick(mem, Facts(now, managerInteractive, stamp, heartbeatAgeMs))
            mem = step.memory
            if (step.action != Action.NONE) actions += now to step.action
            step.record?.let { verdicts += now to it.verdict }
            return step
        }

        /** Advance [ms] in 30 s ticks (the last tick lands exactly at +ms). */
        fun run(ms: Long): Step {
            var last: Step? = null
            var left = ms
            while (left > 0) {
                val d = minOf(left, AlertWatchWatchdogPolicy.TICK_MS)
                now += d
                left -= d
                last = tick()
            }
            return last ?: tick()
        }
    }

    // ─── rule 3: unset means today ──────────────────────────────────

    @Test
    fun `no stamp and no mode does nothing and records nothing`() {
        val b = Bench()
        repeat(40) { assertEquals(Action.NONE, b.run(T).action) }
        assertTrue(b.verdicts.isEmpty())
    }

    @Test
    fun `mode off is today's behaviour even when the watch is silent for an hour`() {
        val b = Bench()
        b.stampNow(mode = Mode.OFF)
        b.run(60 * 60_000L)
        assertTrue(b.actions.isEmpty())
        assertTrue(b.verdicts.isEmpty())
    }

    // ─── the panel is on: the page owns alerts ──────────────────────

    @Test
    fun `panel on by both reckonings is PANEL_ON and ends the dark period`() {
        val b = Bench()
        b.managerInteractive = true
        b.stampNow(state = StampState.IDLE, dark = false)
        b.run(10 * 60_000L)
        assertTrue(b.actions.isEmpty())
        assertEquals(setOf(Verdict.PANEL_ON), b.verdicts.map { it.second }.toSet())
        assertNull(b.mem.darkSinceMs)
    }

    @Test
    fun `a vendor-dark GUQ counts as dark even though Android says interactive`() {
        val b = Bench()
        b.managerInteractive = true          // the backlight is off, Android is awake
        b.stampNow(dark = true)
        b.tick()
        assertEquals(Verdict.HEALTHY, b.verdicts.last().second)
        assertNotNull(b.mem.darkSinceMs)
    }

    @Test
    fun `an unreadable power state with no stamp opinion is not dark`() {
        val b = Bench()
        b.managerInteractive = null
        b.stampNow(state = StampState.IDLE, dark = false)
        b.run(5 * 60_000L)
        assertTrue(b.actions.isEmpty())
        assertEquals(setOf(Verdict.PANEL_ON), b.verdicts.map { it.second }.toSet())
    }

    // ─── a fresh stamp is health ────────────────────────────────────

    @Test
    fun `a watching stamp refreshed every minute is HEALTHY all night`() {
        val b = Bench()
        b.stampNow()
        repeat(8 * 60) { // eight hours of minutes
            b.run(60_000L)
            b.stampNow()
        }
        assertTrue(b.actions.isEmpty())
        assertEquals(setOf(Verdict.HEALTHY), b.verdicts.map { it.second }.toSet())
        assertEquals(0, b.mem.staleTicks)
    }

    @Test
    fun `a stamp from the future reads as fresh - failing toward do nothing`() {
        val b = Bench()
        b.stampNow()
        b.stamp = b.stamp!!.copy(atElapsedMs = b.now + 10 * 60_000L)
        // While the clock has not reached the stamp, its age is 0: nothing happens.
        b.run(10 * 60_000L)
        assertTrue(b.actions.isEmpty())
        assertEquals(setOf(Verdict.HEALTHY), b.verdicts.map { it.second }.toSet())
        assertEquals(0L, P.stampAge(b.stamp!!, b.stamp!!.atElapsedMs - 1))
    }

    // ─── rule 1 + rule 2: stand down when someone else owns the screen ──

    @Test
    fun `a hold stands the watchdog down whatever the stamp age`() {
        val b = Bench()
        b.stampNow(hold = true)
        b.run(60 * 60_000L)
        assertTrue(b.actions.isEmpty())
        assertEquals(setOf(Verdict.HOLD), b.verdicts.map { it.second }.toSet())
        assertEquals(0, b.mem.staleTicks)
    }

    @Test
    fun `a stale Player heartbeat defers to the liveness watchdog`() {
        val b = Bench()
        b.stampNow()
        b.heartbeatAgeMs = P.PLAYER_HEARTBEAT_STALE_MS + 1
        b.run(60 * 60_000L)
        assertTrue(b.actions.isEmpty())
        assertEquals(setOf(Verdict.DEFERRED_LIVENESS), b.verdicts.map { it.second }.toSet())
        b.heartbeatAgeMs = null
        b.tick()
        assertEquals(Verdict.DEFERRED_LIVENESS, b.verdicts.last().second)
    }

    @Test
    fun `no stamp while dark is NO_STAMP and nothing is sent`() {
        val b = Bench()
        b.stamp = null
        // A stamp is the only carrier of the mode, so no stamp is mode OFF: nothing at all.
        b.run(60 * 60_000L)
        assertTrue(b.actions.isEmpty())
        assertTrue(b.verdicts.isEmpty())
    }

    @Test
    fun `a fresh not-watchable stamp is reported and never kicked`() {
        val b = Bench()
        b.stampNow(state = StampState.NOT_WATCHABLE, faces = 0, reason = "this screen is not paired (no usable device token)")
        repeat(60) {
            b.run(60_000L)
            b.stampNow(state = StampState.NOT_WATCHABLE, faces = 0, reason = "this screen is not paired (no usable device token)")
        }
        assertTrue(b.actions.isEmpty())
        assertEquals(setOf(Verdict.NOT_WATCHABLE), b.verdicts.map { it.second }.toSet())
    }

    // ─── rule 4: silence is counted in ticks ────────────────────────

    @Test
    fun `the ladder starts only after SILENT_TICKS stale ticks past the freshness window`() {
        val b = Bench()
        b.stampNow()
        b.tick()
        // Fresh for STAMP_FRESH_MS: no stale tick yet.
        b.run(P.STAMP_FRESH_MS)
        assertEquals(0, b.mem.staleTicks)
        // Then one stale tick per 30 s; the re-arm lands on the SILENT_TICKS-th.
        for (i in 1 until P.SILENT_TICKS) {
            assertEquals(Action.NONE, b.run(T).action)
            assertEquals(i, b.mem.staleTicks)
        }
        val step = b.run(T)
        assertEquals(Action.REARM, step.action)
        assertEquals(Verdict.REARM_SENT, step.record?.verdict)
        assertEquals(Rung.REARM, b.mem.ladder?.rung)
    }

    @Test
    fun `a fresh IDLE stamp while the Manager sees dark counts as silence`() {
        val b = Bench()
        b.stampNow(state = StampState.IDLE, dark = false)   // the loop never re-read the power state
        b.managerInteractive = false
        var sent = false
        repeat(30) {
            b.stampNow(state = StampState.IDLE, dark = false)
            if (b.run(T).action == Action.REARM) sent = true
        }
        assertTrue("an idle watch behind a dark panel must be re-armed", sent)
    }

    @Test
    fun `a gap in the Manager's own ticks means the box slept - the streak restarts`() {
        val b = Bench()
        b.stampNow()
        b.tick()
        b.run(P.STAMP_FRESH_MS + T * (P.SILENT_TICKS - 1))
        assertEquals(P.SILENT_TICKS - 1, b.mem.staleTicks)
        // Deep standby: nothing ticks for ten minutes, then one tick lands.
        b.now += 10 * 60_000L
        val step = b.tick()
        assertEquals(Action.NONE, step.action)
        assertEquals("the streak restarts after a suspend", 1, b.mem.staleTicks)
    }

    // ─── rule 5: the ladder, rung by rung ───────────────────────────

    private fun silentUntilRearm(b: Bench): Step {
        b.stampNow()
        b.tick()
        var step = b.run(P.STAMP_FRESH_MS)
        while (step.action != Action.REARM) step = b.run(T)
        return step
    }

    @Test
    fun `rung 1 re-arm, rung 2 restart the host after REARM_WAIT, then UNRECOVERED after RESTART_WAIT`() {
        val b = Bench()
        silentUntilRearm(b)
        val rearmAt = b.now
        // Nothing more inside the re-arm wait.
        val inside = b.run(P.REARM_WAIT_MS - T)
        assertEquals(Action.NONE, inside.action)
        assertEquals(1, b.actions.size)
        // The next tick restarts the host.
        val restart = b.run(T)
        assertEquals(Action.RESTART_HOST, restart.action)
        assertEquals(Verdict.RESTART_SENT, restart.record?.verdict)
        assertTrue(b.now - rearmAt >= P.REARM_WAIT_MS)
        val restartAt = b.now
        // Nothing inside the restart wait…
        assertEquals(Action.NONE, b.run(P.RESTART_WAIT_MS - T).action)
        assertEquals(2, b.actions.size)
        // …then the honest record, and nothing is sent.
        val done = b.run(T)
        assertEquals(Action.NONE, done.action)
        assertEquals(Verdict.UNRECOVERED, done.record?.verdict)
        assertTrue(b.now - restartAt >= P.RESTART_WAIT_MS)
        // Stood down for the rest of the dark period: an hour more, still two actions.
        b.run(60 * 60_000L)
        assertEquals(2, b.actions.size)
        assertEquals(listOf(Action.REARM, Action.RESTART_HOST), b.actions.map { it.second })
    }

    @Test
    fun `a stamp that comes back after the re-arm is RECOVERED and the ladder closes`() {
        val b = Bench()
        silentUntilRearm(b)
        b.now += 5_000L
        b.stampNow()
        val step = b.tick()
        assertEquals(Action.NONE, step.action)
        assertEquals(Verdict.RECOVERED, step.record?.verdict)
        assertNull(b.mem.ladder)
        assertEquals(0, b.mem.staleTicks)
        // Kept fresh: healthy, nothing more sent.
        repeat(10) { b.run(60_000L); b.stampNow() }
        assertEquals(1, b.actions.size)
    }

    @Test
    fun `a stamp that comes back after UNRECOVERED is still RECOVERED`() {
        val b = Bench()
        silentUntilRearm(b)
        b.run(P.REARM_WAIT_MS)
        b.run(P.RESTART_WAIT_MS)
        assertEquals(Verdict.UNRECOVERED, b.verdicts.last().second)
        b.stampNow()
        assertEquals(Verdict.RECOVERED, b.tick().record?.verdict)
    }

    @Test
    fun `observe mode records SILENT_OBSERVED once and sends nothing`() {
        val b = Bench()
        b.stampNow(mode = Mode.OBSERVE)
        b.tick()
        b.run(3 * 60 * 60_000L)
        assertTrue(b.actions.isEmpty())
        assertEquals(1, b.verdicts.count { it.second == Verdict.SILENT_OBSERVED })
        assertEquals(Rung.OBSERVED, b.mem.ladder?.rung)
    }

    @Test
    fun `the panel coming on resets the ladder for the next dark period`() {
        val b = Bench()
        silentUntilRearm(b)
        b.managerInteractive = true
        b.stampNow(state = StampState.IDLE, dark = false)
        val step = b.tick()
        assertEquals(Verdict.PANEL_ON, step.record?.verdict)
        assertNull(b.mem.ladder)
        assertNull(b.mem.darkSinceMs)
        assertEquals(0, b.mem.staleTicks)
        // The intervention memory is kept — that is what bounds the next period.
        assertEquals(1, b.mem.interventions.size)
    }

    // ─── backoff and the cap ────────────────────────────────────────

    @Test
    fun `a second dark period inside LADDER_MIN_GAP is SILENT_BACKOFF - nothing sent`() {
        val b = Bench()
        silentUntilRearm(b)
        // Panel on for a minute, then off and silent again.
        b.managerInteractive = true
        b.stampNow(state = StampState.IDLE, dark = false)
        b.run(60_000L)
        b.managerInteractive = false
        b.stampNow()
        b.tick()
        b.run(P.STAMP_FRESH_MS + T * P.SILENT_TICKS)
        assertEquals(1, b.actions.size)
        assertTrue(b.verdicts.any { it.second == Verdict.SILENT_BACKOFF })
        assertEquals(Rung.BACKOFF, b.mem.ladder?.rung)
    }

    @Test
    fun `after LADDER_MIN_GAP a new dark period may start a new ladder`() {
        val b = Bench()
        silentUntilRearm(b)
        b.managerInteractive = true
        b.stampNow(state = StampState.IDLE, dark = false)
        b.run(P.LADDER_MIN_GAP_MS)
        b.managerInteractive = false
        b.stampNow()
        b.tick()
        b.run(P.STAMP_FRESH_MS + T * P.SILENT_TICKS)
        assertEquals(2, b.actions.size)
        assertEquals(Action.REARM, b.actions.last().second)
    }

    @Test
    fun `the 24h cap is SILENT_CAPPED and the window rolls`() {
        val b = Bench()
        var mem = Memory(interventions = (0 until P.MAX_INTERVENTIONS_PER_DAY).map { b.now - 60_000L * (it + 1) }, lastLadderStartMs = b.now - P.LADDER_MIN_GAP_MS)
        b.mem = mem
        b.stampNow()
        b.tick()
        b.run(P.STAMP_FRESH_MS + T * P.SILENT_TICKS)
        assertTrue(b.actions.isEmpty())
        assertTrue(b.verdicts.any { it.second == Verdict.SILENT_CAPPED })
        // A day later the window has rolled: the panel comes on, goes off, and the ladder runs.
        b.managerInteractive = true
        b.stampNow(state = StampState.IDLE, dark = false)
        b.run(P.DAY_MS)
        b.managerInteractive = false
        b.stampNow()
        b.tick()
        b.run(P.STAMP_FRESH_MS + T * P.SILENT_TICKS)
        assertEquals(listOf(Action.REARM), b.actions.map { it.second })
        mem = b.mem
        assertEquals(1, mem.interventions.size)
    }

    @Test
    fun `the cap also stops rung 2 mid-ladder`() {
        val b = Bench()
        b.mem = Memory(interventions = (0 until P.MAX_INTERVENTIONS_PER_DAY - 1).map { b.now - 60_000L * (it + 1) })
        silentUntilRearm(b)                       // the sixth and last allowed intervention
        b.run(P.REARM_WAIT_MS + T)
        assertEquals(listOf(Action.REARM), b.actions.map { it.second })
        assertTrue(b.verdicts.any { it.second == Verdict.SILENT_CAPPED })
    }

    // ─── THE NO-LOOP PROPERTY ───────────────────────────────────────

    @Test
    fun `48 hours of a stamp that never comes back, with the panel flickering, stays inside the bounds`() {
        val b = Bench()
        b.stampNow()                    // one stamp, then silence for two days
        var flicker = 0
        val end = b.now + 2 * P.DAY_MS
        while (b.now < end) {
            // Every 7 minutes the panel blips on for one tick, then off again.
            flicker += 1
            if (flicker % 14 == 0) {
                b.managerInteractive = true
                b.stamp = b.stamp!!.copy(panelDark = false)
                b.tick()
                b.managerInteractive = false
                b.stamp = b.stamp!!.copy(panelDark = true)
            }
            b.run(T)
        }
        val sent = b.actions.map { it.first }
        // Never more than the daily cap in any rolling 24 h.
        for (t in sent) {
            val inWindow = sent.count { it >= t && it < t + P.DAY_MS }
            assertTrue("$inWindow interventions inside one 24 h window", inWindow <= P.MAX_INTERVENTIONS_PER_DAY)
        }
        // Every ladder start is at least LADDER_MIN_GAP from the previous one.
        val starts = b.actions.filter { it.second == Action.REARM }.map { it.first }
        starts.zipWithNext().forEach { (a, c) -> assertTrue("ladders ${(c - a) / 60_000} min apart", c - a >= P.LADDER_MIN_GAP_MS) }
        // And a ladder is never more than two interventions.
        assertTrue(b.actions.count { it.second == Action.RESTART_HOST } <= starts.size)
        assertTrue("something was tried", starts.isNotEmpty())
        assertTrue("but not many times: ${sent.size}", sent.size <= 2 * P.MAX_INTERVENTIONS_PER_DAY)
    }

    @Test
    fun `a Manager restart mid-ladder keeps the bounds - the memory round-trips`() {
        val b = Bench()
        silentUntilRearm(b)
        val encoded = P.encode(b.mem)
        val decoded = P.decode(encoded)
        assertEquals(b.mem, decoded)
        // The restarted Manager continues the same ladder: rung 2 after the wait, not a second re-arm.
        b.mem = decoded
        b.run(P.REARM_WAIT_MS + T)
        assertEquals(listOf(Action.REARM, Action.RESTART_HOST), b.actions.map { it.second })
        assertEquals(Memory(), P.decode(null))
        assertEquals(Memory(), P.decode("garbage"))
        assertEquals(Memory(), P.decode("v=2;s=3"))
    }

    // ─── rule 1: NEVER clears, suppresses or delays an alert ────────

    @Test
    fun `the action set can only start the watch`() {
        assertEquals(setOf("NONE", "REARM", "RESTART_HOST"), Action.values().map { it.name }.toSet())
        for (a in Action.values()) {
            for (word in listOf("RELEASE", "CLEAR", "WAKE", "LAUNCH", "REBOOT", "SUPPRESS", "DELAY", "HOLD")) {
                assertFalse("$a looks like $word", a.name.contains(word))
            }
        }
    }

    @Test
    fun `a hold up with a silent stamp is still HOLD - the paint ladder is never fought`() {
        val b = Bench()
        b.stampNow(hold = true)
        b.run(2 * 60 * 60_000L)                   // two hours stale AND a hold
        assertTrue(b.actions.isEmpty())
        assertEquals(setOf(Verdict.HOLD), b.verdicts.map { it.second }.toSet())
    }

    @Test
    fun `a DH43 is one process with two faces - one ladder, never two`() {
        val b = Bench()
        b.stampNow(faces = 2)
        b.tick()
        b.run(P.STAMP_FRESH_MS + T * P.SILENT_TICKS)
        b.run(P.REARM_WAIT_MS + T)
        b.run(P.RESTART_WAIT_MS + T)
        assertEquals("one ladder for the unit, not one per face", 2, b.actions.size)
        assertTrue(b.verdicts.map { it.second }.containsAll(listOf(Verdict.REARM_SENT, Verdict.RESTART_SENT, Verdict.UNRECOVERED)))
    }

    // ─── wire helpers ───────────────────────────────────────────────

    @Test
    fun `modes and states round-trip and unknown values are off or null`() {
        assertEquals(Mode.ON, P.modeOf("on"))
        assertEquals(Mode.ON, P.modeOf(" ON "))
        assertEquals(Mode.OBSERVE, P.modeOf("observe"))
        assertEquals(Mode.OFF, P.modeOf("off"))
        assertEquals(Mode.OFF, P.modeOf("yes"))
        assertEquals(Mode.OFF, P.modeOf(null))
        for (s in StampState.values()) assertEquals(s, P.stampStateOf(P.wire(s)))
        assertNull(P.stampStateOf("polling"))
        for (v in Verdict.values()) assertTrue(P.wire(v).matches(Regex("^[a-z-]+$")))
        for (r in Rung.values()) assertTrue(P.wire(r).matches(Regex("^[a-z]+$")))
    }

    @Test
    fun `a reason is short printable ASCII with no quote or backslash`() {
        assertNull(P.safeReason(null))
        assertNull(P.safeReason("   "))
        assertEquals("not paired", P.safeReason("not \"paired\"\n"))
        assertEquals(120, P.safeReason("x".repeat(500))!!.length)
    }

    @Test
    fun `the record names what the evidence proves`() {
        val b = Bench()
        b.stampNow(faces = 2)
        b.tick()
        val r = b.run(P.STAMP_FRESH_MS + T * P.SILENT_TICKS).record!!
        assertEquals(Verdict.REARM_SENT, r.verdict)
        assertEquals(Mode.ON, r.mode)
        assertEquals(2, r.faces)
        assertEquals(StampState.WATCHING, r.stampState)
        assertTrue(r.stampAgeMs!! > P.STAMP_FRESH_MS)
        assertEquals(1, r.interventionsLast24h)
        assertEquals(Rung.REARM, r.ladder?.rung)
    }
}
