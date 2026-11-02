package com.educms.player.display

import com.educms.player.display.VendorBacklightEngine.Call
import com.educms.player.display.VendorBacklightEngine.Connect
import com.educms.player.display.VendorBacklightEngine.Step
import com.educms.player.display.VendorBacklightPolicy.Detection
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * THE GUQ SLEEP / WAKE, END TO END, ON RECORDING FAKES.
 *
 * The GUQ panel cannot be reached from CI, so the only place the whole
 * sequence can be watched is here: detection and fallback, a sleep, a wake,
 * a dead binder, a service that never answers, the alert path's wake, and the
 * fault latch. Every port is a fake that records what was asked of it.
 *
 * The sequence under test is Goodview's own CMS on a t982 (`APITools
 * .PowerOff` / `PowerOn`): read the power state, then `CmdPowerOff(-1)` to
 * sleep, the power key `CmdSendKeyEvent(5000)` to wake — and never the
 * MCU-only `CmdSetScreenStatus` that latched GUQs through 1.1.56.
 */
class VendorBacklightEngineTest {

    private val okTrue = """{"status":"SUCCESS","responseName":"RespBooleanResult","paramsJson":"{\"result\":true}"}"""
    private val okFalse = """{"status":"SUCCESS","responseName":"RespBooleanResult","paramsJson":"{\"result\":false}"}"""
    private val okVoid = """{"status":"SUCCESS","responseName":"RespVoidResult","paramsJson":"{}"}"""
    private val handlerNotFound = """{"status":"HANDLER_NOT_FOUND","responseName":"","paramsJson":""}"""

    /** A recording panel: `CmdPowerOff` sleeps it, the power key TOGGLES it (as the real key does). */
    private class Fake : VendorBacklightEngine.Ports {
        var now = 0L
        var installed = true
        var connectOutcome: Connect = Connect.Ready
        /** Each connect consumes one entry when present. */
        val connectQueue = ArrayDeque<Connect>()
        var connects = 0
        var disconnects = 0
        /** Each send consumes one; a reply is otherwise derived from the panel state. */
        val sendQueue = ArrayDeque<Call>()
        var screenOn = true
        val sent = mutableListOf<String>()
        /** The budget each send was given, in order. */
        val budgets = mutableListOf<Long>()
        val submitted = mutableListOf<() -> Unit>()
        val scheduled = mutableListOf<Pair<Long, () -> Unit>>()
        var submitAccepts = true
        val darkChanges = mutableListOf<Boolean>()
        var seen = 0
        val logs = mutableListOf<String>()
        /** Advance the clock by this much on every send (a slow service). */
        var sendCostMs = 0L

        override fun nowMs(): Long = now
        override fun servicePackageInstalled(): Boolean = installed
        override fun connect(budgetMs: Long): Connect {
            connects++
            return connectQueue.removeFirstOrNull() ?: connectOutcome
        }
        override fun disconnect() { disconnects++ }
        override fun send(requestJson: String, budgetMs: Long): Call {
            sent += requestJson
            budgets += budgetMs
            if (budgetMs <= 0L) return Call.TimedOut // as the Android port does
            now += sendCostMs
            sendQueue.removeFirstOrNull()?.let { return it }
            return when {
                requestJson.contains("CmdPowerOff") -> {
                    screenOn = false
                    Call.Reply("""{"status":"SUCCESS","responseName":"RespVoidResult","paramsJson":"{}"}""")
                }
                requestJson.contains("CmdSendKeyEvent") -> {
                    screenOn = !screenOn
                    Call.Reply("""{"status":"SUCCESS","responseName":"RespVoidResult","paramsJson":"{}"}""")
                }
                requestJson.contains("CmdGetScreenStatus") -> Call.Reply(
                    """{"status":"SUCCESS","responseName":"RespBooleanResult","paramsJson":"{\"result\":$screenOn}"}""",
                )
                else -> Call.Failed("unknown command")
            }
        }
        override fun submit(work: () -> Unit): Boolean {
            if (!submitAccepts) return false
            submitted += work
            return true
        }
        override fun schedule(delayMs: Long, work: () -> Unit): Boolean {
            if (!submitAccepts) return false
            scheduled += delayMs to work
            return true
        }
        override fun darkChanged(dark: Boolean) { darkChanges += dark }
        override fun seen() { seen++ }
        override fun log(level: VendorBacklightEngine.Level, message: String) { logs += "${level.name}: $message" }

        /** The command name of every request sent, in order (short class names). */
        fun names(): List<String> = sent.map { JSONObject(it).getString("requestName").substringAfterLast('.') }
        fun params(i: Int): JSONObject = JSONObject(JSONObject(sent[i]).getString("paramsJson"))
        fun keys(): Int = sent.count { it.contains("CmdSendKeyEvent") }
    }

    /** Let our own last power command settle. */
    private fun Fake.settle() { now += VendorBacklightPolicy.POWER_SETTLE_MS }

    // ─── detection and fallback ──────────────────────────────────────────


    @Test
    fun `a box without the vendor package is ABSENT without a single bind`() {
        val f = Fake().apply { installed = false }
        val e = VendorBacklightEngine(f)
        assertEquals(Detection.ABSENT, e.probe())
        assertEquals(0, f.connects)
        assertTrue(f.sent.isEmpty())
        assertEquals(0, f.seen)
        assertTrue(VendorBacklightPolicy.supports(e.detection, seenBefore = false, killSwitchOff = false, faulted = false).isEmpty())
    }

    @Test
    fun `a bind that never completes in budget is UNREACHABLE, and the chain falls through`() {
        val f = Fake().apply { connectOutcome = Connect.TimedOut }
        val e = VendorBacklightEngine(f)
        assertEquals(Detection.UNREACHABLE, e.probe())
        assertTrue(f.sent.isEmpty())
        assertEquals(0, f.seen)
    }

    @Test
    fun `a bind the system refuses is UNREACHABLE`() {
        val f = Fake().apply { connectOutcome = Connect.Failed("bindService refused") }
        assertEquals(Detection.UNREACHABLE, VendorBacklightEngine(f).probe())
    }

    @Test
    fun `a service that binds but does not handle the screen-status command is UNSUPPORTED`() {
        val f = Fake().apply { sendQueue += Call.Reply(handlerNotFound) }
        val e = VendorBacklightEngine(f)
        assertEquals(Detection.UNSUPPORTED, e.probe())
        assertEquals(0, f.seen)
        // Settled: no retry is due however long we wait.
        f.now += 100 * VendorBacklightPolicy.PROBE_RETRY_MS
        assertEquals(Detection.UNSUPPORTED, e.probeIfDue())
        assertEquals(1, f.connects)
    }

    @Test
    fun `a service that answers the probe is AVAILABLE and remembered for the next boot`() {
        val f = Fake()
        val e = VendorBacklightEngine(f)
        assertEquals(Detection.AVAILABLE, e.probe())
        assertEquals(1, f.seen)
        assertTrue(f.sent.single().contains("CmdGetScreenStatus"))
        assertEquals(setOf(Capability.BLANK, Capability.WAKE), VendorBacklightPolicy.supports(e.detection, false, false, false))
    }

    @Test
    fun `a probe whose command times out is UNREACHABLE and is retried on the cadence, boundedly`() {
        val f = Fake().apply { sendQueue += Call.TimedOut }
        val e = VendorBacklightEngine(f)
        assertEquals(Detection.UNREACHABLE, e.probeIfDue())
        // Too soon: nothing happens.
        f.now += 1_000L
        assertEquals(1, f.connects)
        e.probeIfDue()
        assertEquals(1, f.connects)
        // On the cadence, the service is back: AVAILABLE.
        f.now += VendorBacklightPolicy.PROBE_RETRY_MS
        assertEquals(Detection.AVAILABLE, e.probeIfDue())
    }

    @Test
    fun `an unreachable service is not probed forever`() {
        val f = Fake().apply { connectOutcome = Connect.TimedOut }
        val e = VendorBacklightEngine(f)
        repeat(VendorBacklightPolicy.MAX_PROBES + 3) {
            e.probeIfDue()
            f.now += VendorBacklightPolicy.PROBE_RETRY_MS
        }
        assertEquals(VendorBacklightPolicy.MAX_PROBES, f.connects)
    }


    // ─── the exact call sequence (Goodview's CMS on a t982) ──────────────

    @Test
    fun `sleep is read-state then CmdPowerOff(-1) then one readback — never CmdSetScreenStatus`() {
        val f = Fake()
        val e = VendorBacklightEngine(f)
        val step = e.blank()
        assertTrue(step is Step.Ok)
        assertEquals(listOf("CmdGetScreenStatus", "CmdPowerOff", "CmdGetScreenStatus"), f.names())
        assertEquals("com.seewo.sdk.internal.command.system.CmdPowerOff", JSONObject(f.sent[1]).getString("requestName"))
        assertEquals(-1, f.params(1).getInt("timeCount"))
        assertFalse(f.sent.any { it.contains("CmdSetScreenStatus") })
        assertEquals(true, (step as Step.Ok).backlightOff)
        assertTrue(e.dark)
        assertEquals(listOf(true), f.darkChanges)
        assertEquals(SleepProofPolicy.OUTCOME_OFF, VendorBacklightPolicy.blankOutcome(step.backlightOff))
    }

    @Test
    fun `wake is read-state then the power key 5000 then one readback — never CmdSetScreenStatus`() {
        val f = Fake()
        val e = VendorBacklightEngine(f)
        e.blank()
        f.settle()
        f.sent.clear()
        val step = e.wake()
        assertTrue(step is Step.Ok)
        assertEquals(listOf("CmdGetScreenStatus", "CmdSendKeyEvent", "CmdGetScreenStatus"), f.names())
        assertEquals("com.seewo.sdk.internal.command.system.CmdSendKeyEvent", JSONObject(f.sent[1]).getString("requestName"))
        assertEquals(5000, f.params(1).getInt("keyCode"))
        assertFalse(f.sent.any { it.contains("CmdSetScreenStatus") })
        assertEquals(false, (step as Step.Ok).backlightOff)
        assertFalse(e.dark)
        assertTrue(f.screenOn)
        assertEquals(listOf(true, false), f.darkChanges)
        assertNull(e.faulted)
    }

    @Test
    fun `a sleep on a panel that already reads off sends nothing but records it dark`() {
        val f = Fake().apply { screenOn = false }
        val e = VendorBacklightEngine(f)
        val step = e.blank() as Step.Ok
        assertEquals(listOf("CmdGetScreenStatus"), f.names())
        assertEquals(true, step.backlightOff)
        assertTrue(e.dark)
    }

    @Test
    fun `a wake on a panel that already reads on never presses the power key (it is a toggle)`() {
        val f = Fake().apply { screenOn = true }
        val e = VendorBacklightEngine(f)
        val step = e.wake() as Step.Ok
        assertEquals(listOf("CmdGetScreenStatus"), f.names())
        assertEquals(0, f.keys())
        assertEquals(false, step.backlightOff)
        assertTrue(f.screenOn)
    }

    @Test
    fun `an unreadable power state sends no command in either direction`() {
        val f = Fake().apply { screenOn = false; sendQueue += Call.TimedOut }
        val e = VendorBacklightEngine(f)
        assertTrue(e.wake() is Step.Failed)
        assertEquals(0, f.keys())
        val g = Fake().apply { sendQueue += Call.Reply(handlerNotFound) }
        assertTrue(VendorBacklightEngine(g).blank() is Step.Failed)
        assertFalse(g.sent.any { it.contains("CmdPowerOff") })
    }

    // ─── the toggle guard: settle window ─────────────────────────────────

    @Test
    fun `two wakes back to back press the power key once, not twice`() {
        val f = Fake()
        val e = VendorBacklightEngine(f)
        e.blank()
        f.settle()
        assertTrue(e.wake() is Step.Ok)
        // The registry wake right behind the alert's wake — the panel may still read off.
        f.screenOn = false
        assertTrue(e.wake() is Step.Ok)
        assertEquals(1, f.keys())
    }

    @Test
    fun `a wake right after our own sleep presses nothing now and tries again once the panel has settled`() {
        val f = Fake()
        val e = VendorBacklightEngine(f)
        e.blank()
        f.screenOn = true // the panel still reads on while it goes down
        val step = e.wake()
        assertTrue(step is Step.Ok)
        assertNull((step as Step.Ok).backlightOff)
        assertEquals(0, f.keys())
        assertTrue(e.dark) // still ours to wake: the alert watch keeps re-raising
        val (delay, work) = f.scheduled.single()
        assertTrue(delay >= VendorBacklightPolicy.POWER_SETTLE_MS)
        // The panel has gone down; the deferred wake runs.
        f.screenOn = false
        f.now += delay
        work()
        assertEquals(1, f.keys())
        assertTrue(f.screenOn)
        assertFalse(e.dark)
    }

    @Test
    fun `a deferred wake that a newer sleep superseded does nothing`() {
        val f = Fake()
        val e = VendorBacklightEngine(f)
        e.blank()
        e.wake() // deferred
        val (delay, work) = f.scheduled.single()
        f.now += delay
        e.blank() // a newer request
        val keysBefore = f.keys()
        work()
        assertEquals(keysBefore, f.keys())
        assertTrue(e.dark)
    }

    @Test
    fun `a sleep right after our own wake is refused, so the chain takes it`() {
        val f = Fake()
        val e = VendorBacklightEngine(f)
        e.blank()
        f.settle()
        e.wake()
        f.screenOn = false
        assertTrue(e.blank() is Step.Failed)
        assertEquals(1, f.sent.count { it.contains("CmdPowerOff") })
    }

    // ─── honest readback ─────────────────────────────────────────────────

    @Test
    fun `a readback that says the panel is still on is reported honestly, never as off`() {
        val f = Fake().apply {
            sendQueue += Call.Reply(okTrue) // reads on
            sendQueue += Call.Reply(okVoid) // power off accepted
            sendQueue += Call.Reply(okTrue) // still reads on
        }
        val e = VendorBacklightEngine(f)
        val step = e.blank() as Step.Ok
        assertEquals(false, step.backlightOff)
        assertEquals(SleepProofPolicy.OUTCOME_ON, VendorBacklightPolicy.blankOutcome(step.backlightOff))
        assertTrue(e.dark)
    }

    @Test
    fun `a readback that times out leaves the outcome unknown but keeps the record`() {
        val f = Fake().apply { sendQueue += Call.Reply(okTrue); sendQueue += Call.Reply(okVoid); sendQueue += Call.TimedOut }
        val e = VendorBacklightEngine(f)
        val step = e.blank() as Step.Ok
        assertNull(step.backlightOff)
        assertTrue(e.dark)
        assertEquals(SleepProofPolicy.OUTCOME_UNKNOWN, VendorBacklightPolicy.blankOutcome(step.backlightOff))
    }

    @Test
    fun `a refused command is a Failed step that changes no record`() {
        val f = Fake().apply { sendQueue += Call.Reply(okTrue); sendQueue += Call.Reply(handlerNotFound) }
        val e = VendorBacklightEngine(f)
        val step = e.blank()
        assertTrue(step is Step.Failed)
        assertFalse(e.dark)
        assertTrue(f.darkChanges.isEmpty())
        assertNull(e.faulted)
    }

    @Test
    fun `a reply that is not an SDK response fails the step`() {
        val f = Fake().apply { sendQueue += Call.Reply(okTrue); sendQueue += Call.Reply("<html>oops</html>") }
        assertTrue(VendorBacklightEngine(f).blank() is Step.Failed)
    }

    // ─── timeouts: bounded, never a hang ─────────────────────────────────

    @Test
    fun `a command that outlives its budget is a failure, not a wait, and nothing is recorded`() {
        val f = Fake().apply { sendQueue += Call.Reply(okTrue); sendQueue += Call.TimedOut }
        val e = VendorBacklightEngine(f)
        val step = e.blank()
        assertTrue(step is Step.Failed)
        assertTrue((step as Step.Failed).reason.contains("did not answer in time"))
        assertFalse(e.dark)
        assertTrue(f.darkChanges.isEmpty())
    }

    @Test
    fun `a connect that cannot complete inside the apply budget fails the step`() {
        val f = Fake().apply { connectOutcome = Connect.TimedOut }
        val step = VendorBacklightEngine(f).wake()
        assertTrue(step is Step.Failed)
        assertTrue(f.sent.isEmpty())
    }

    @Test
    fun `every call is asked within the remaining budget — a slow service cannot stretch the step`() {
        // Each round trip eats 1 200 ms of a 1 900 ms budget: the read gets the
        // per-call ceiling (1 500 ms), the command only the 700 ms left, and
        // the readback nothing — never a fresh budget.
        val f = Fake().apply { sendCostMs = 1_200L }
        val step = VendorBacklightEngine(f).blank(budgetMs = 1_900L)
        assertTrue(step is Step.Ok)
        assertEquals(VendorBacklightPolicy.CALL_TIMEOUT_MS, f.budgets[0])
        assertEquals(700L, f.budgets[1])
        assertNull((step as Step.Ok).backlightOff)
        // A service that eats the WHOLE budget on the read gets no command.
        val g = Fake().apply { sendCostMs = 1_900L }
        assertTrue(VendorBacklightEngine(g).blank(budgetMs = 1_900L) is Step.Failed)
        assertTrue(g.screenOn)
    }

    // ─── a dead binder: one reconnect, a fresh read, inside the budget ──

    @Test
    fun `a dead binder on the power key is reconnected ONCE and the state read again before the key is resent`() {
        val f = Fake().apply { screenOn = false }
        f.sendQueue += Call.Reply(okFalse) // reads off
        f.sendQueue += Call.Failed("DeadObjectException", binderDead = true) // key lost
        val e = VendorBacklightEngine(f)
        val step = e.wake()
        assertTrue(step is Step.Ok)
        assertEquals(1, f.disconnects)
        assertEquals(2, f.connects)
        assertEquals(
            listOf("CmdGetScreenStatus", "CmdSendKeyEvent", "CmdGetScreenStatus", "CmdSendKeyEvent", "CmdGetScreenStatus"),
            f.names(),
        )
        assertTrue(f.screenOn)
    }

    @Test
    fun `a binder that dies twice fails the step rather than looping`() {
        val f = Fake().apply {
            sendQueue += Call.Failed("DeadObjectException", binderDead = true)
            sendQueue += Call.Failed("DeadObjectException", binderDead = true)
        }
        val e = VendorBacklightEngine(f)
        assertTrue(e.wake() is Step.Failed)
        assertEquals(2, f.connects)
        assertEquals(0, f.keys())
    }

    // ─── rule 4: the fault latch ─────────────────────────────────────────

    @Test
    fun `a failed wake after our own sleep latches the fault — no further blank, wake keeps trying`() {
        val f = Fake()
        val e = VendorBacklightEngine(f)
        e.probe()
        assertTrue(e.blank() is Step.Ok)
        f.settle()
        f.sendQueue += Call.TimedOut
        assertTrue(e.wake() is Step.Failed)
        assertNotNull(e.faulted)
        assertTrue(e.dark) // the record keeps telling the truth: we put it to sleep
        assertEquals(setOf(Capability.WAKE), VendorBacklightPolicy.supports(e.detection, seenBefore = true, killSwitchOff = false, faulted = e.faulted != null))
        // The next wake that succeeds clears the fault.
        assertTrue(e.wake() is Step.Ok)
        assertNull(e.faulted)
        assertFalse(e.dark)
    }

    @Test
    fun `a failed wake while the panel was never ours does not latch anything`() {
        val f = Fake().apply { sendQueue += Call.TimedOut }
        val e = VendorBacklightEngine(f)
        assertTrue(e.wake() is Step.Failed)
        assertNull(e.faulted)
    }

    // ─── rule 3: emergency first — queued, never waited for ─────────────

    @Test
    fun `an alert wakes a sleeping panel — queued off the caller's thread, then the power key`() {
        val f = Fake()
        val e = VendorBacklightEngine(f)
        e.probe()
        e.blank()
        assertFalse(f.screenOn)
        f.settle()
        val sentBefore = f.sent.size
        assertTrue(e.emergencyOn(quiet = false, seenBefore = true))
        // Nothing was sent on the caller's thread — the work sits on the worker.
        assertEquals(sentBefore, f.sent.size)
        assertEquals(1, f.submitted.size)
        f.submitted.single().invoke()
        assertEquals(listOf("CmdGetScreenStatus", "CmdSendKeyEvent", "CmdGetScreenStatus"), f.names().drop(sentBefore))
        assertTrue(f.screenOn)
        assertFalse(e.dark)
    }

    @Test
    fun `an alert that lands while the panel is still going to sleep still wakes it`() {
        val f = Fake()
        val e = VendorBacklightEngine(f)
        e.probe()
        e.blank() // no settle: the alert arrives at once
        assertTrue(e.emergencyOn(quiet = false, seenBefore = true))
        f.submitted.single().invoke()
        assertEquals(0, f.keys())
        val (delay, work) = f.scheduled.single()
        f.now += delay
        work()
        assertEquals(1, f.keys())
        assertTrue(f.screenOn)
        assertFalse(e.dark)
    }

    @Test
    fun `the native alert watch's quiet re-raise asks only while the panel sleeps by our hand`() {
        val f = Fake()
        val e = VendorBacklightEngine(f)
        e.probe()
        assertFalse(e.emergencyOn(quiet = true, seenBefore = true))
        assertTrue(f.submitted.isEmpty())
        e.blank()
        assertTrue(e.emergencyOn(quiet = true, seenBefore = true))
        assertEquals(1, f.submitted.size)
    }

    @Test
    fun `the loud engage asks even when our record says lit, and asks nothing of a box without the service`() {
        val lit = Fake()
        val e = VendorBacklightEngine(lit)
        e.probe()
        assertTrue(e.emergencyOn(quiet = false, seenBefore = true))
        // Run it: the panel reads on, so the toggle is NOT pressed.
        lit.submitted.single().invoke()
        assertEquals(0, lit.keys())
        assertTrue(lit.screenOn)
        val absent = Fake().apply { installed = false }
        val a = VendorBacklightEngine(absent)
        a.probe()
        assertFalse(a.emergencyOn(quiet = false, seenBefore = false))
        assertTrue(absent.submitted.isEmpty())
    }

    @Test
    fun `a hanging or throwing wake on the worker never reaches the caller`() {
        val f = Fake()
        val e = VendorBacklightEngine(f)
        e.probe()
        e.blank()
        f.settle()
        f.sendQueue += Call.TimedOut // the state read will time out when the worker runs it
        assertTrue(e.emergencyOn(quiet = false, seenBefore = true))
        f.submitted.single().invoke()
        assertNotNull(e.faulted)
        assertTrue(e.dark)
        // A worker that cannot even take the work is reported, not thrown.
        val stuck = Fake().apply { submitAccepts = false }
        val s = VendorBacklightEngine(stuck)
        s.probe()
        s.blank()
        assertFalse(s.emergencyOn(quiet = false, seenBefore = true))
        assertTrue(stuck.logs.any { it.startsWith("ERROR") && it.contains("could not be queued") })
    }

    @Test
    fun `a box that proved the service in an earlier boot is asked while this boot's probe still runs`() {
        val f = Fake()
        val e = VendorBacklightEngine(f) // detection = PROBING
        e.restoreDark(true)
        assertTrue(e.emergencyOn(quiet = true, seenBefore = true))
        assertFalse(VendorBacklightEngine(Fake()).emergencyOn(quiet = true, seenBefore = false))
    }
}
