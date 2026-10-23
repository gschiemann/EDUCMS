package com.educms.player.display

import com.educms.player.display.VendorBacklightEngine.Call
import com.educms.player.display.VendorBacklightEngine.Connect
import com.educms.player.display.VendorBacklightEngine.Step
import com.educms.player.display.VendorBacklightPolicy.Detection
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * THE VENDOR BACKLIGHT, END TO END, ON RECORDING FAKES (player 1.1.52).
 *
 * The GUQ panel cannot be reached from CI, so the only place the whole
 * sequence can be watched is here: detection and fallback, a blank, a wake,
 * a dead binder, a service that never answers, the alert path's ON, and the
 * fault latch. Every port is a fake that records what was asked of it.
 */
class VendorBacklightEngineTest {

    private val okTrue = """{"status":"SUCCESS","responseName":"RespBooleanResult","paramsJson":"{\"result\":true}"}"""
    private val okFalse = """{"status":"SUCCESS","responseName":"RespBooleanResult","paramsJson":"{\"result\":false}"}"""
    private val okVoid = """{"status":"SUCCESS","responseName":"RespVoidResult","paramsJson":"{}"}"""
    private val handlerNotFound = """{"status":"HANDLER_NOT_FOUND","responseName":"","paramsJson":""}"""

    private class Fake : VendorBacklightEngine.Ports {
        var now = 0L
        var installed = true
        var connectOutcome: Connect = Connect.Ready
        /** Each connect consumes one entry when present. */
        val connectQueue = ArrayDeque<Connect>()
        var connects = 0
        var disconnects = 0
        /** Each send consumes one; a reply is also looked up by request name when the queue is empty. */
        val sendQueue = ArrayDeque<Call>()
        var screenOn = true
        var setStatusCall: Call? = null
        val sent = mutableListOf<String>()
        /** The budget each send was given, in order. */
        val budgets = mutableListOf<Long>()
        val submitted = mutableListOf<() -> Unit>()
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
            now += sendCostMs
            sendQueue.removeFirstOrNull()?.let { return it }
            return when {
                requestJson.contains("CmdSetScreenStatus") -> setStatusCall ?: run {
                    screenOn = requestJson.contains("\\\"on\\\":true")
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
        override fun darkChanged(dark: Boolean) { darkChanges += dark }
        override fun seen() { seen++ }
        override fun log(level: VendorBacklightEngine.Level, message: String) { logs += "${level.name}: $message" }
    }

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

    // ─── blank and wake ──────────────────────────────────────────────────

    @Test
    fun `a blank sends OFF, reads the status back, records dark and reports what the MCU said`() {
        val f = Fake()
        val e = VendorBacklightEngine(f)
        e.probe()
        val step = e.blank()
        assertTrue(step is Step.Ok)
        assertEquals(true, (step as Step.Ok).backlightOff)
        assertTrue(e.dark)
        assertEquals(listOf(true), f.darkChanges)
        // OFF then the readback, in that order.
        assertTrue(f.sent[1].contains("CmdSetScreenStatus") && f.sent[1].contains("\\\"on\\\":false"))
        assertTrue(f.sent[2].contains("CmdGetScreenStatus"))
        assertEquals(SleepProofPolicy.OUTCOME_OFF, VendorBacklightPolicy.blankOutcome(step.backlightOff))
    }

    @Test
    fun `a wake sends ON, clears the dark record and the fault`() {
        val f = Fake()
        val e = VendorBacklightEngine(f)
        e.probe()
        e.blank()
        val step = e.wake()
        assertTrue(step is Step.Ok)
        assertFalse(e.dark)
        assertEquals(listOf(true, false), f.darkChanges)
        assertNull(e.faulted)
        assertTrue(f.sent.last { it.contains("CmdSetScreenStatus") }.contains("\\\"on\\\":true"))
    }

    @Test
    fun `a readback that says the backlight is still on is reported honestly, never as off`() {
        val f = Fake().apply { sendQueue += Call.Reply(okVoid); sendQueue += Call.Reply(okTrue) } // OFF accepted; status reads ON
        val e = VendorBacklightEngine(f)
        val step = e.blank() as Step.Ok
        assertEquals(false, step.backlightOff)
        assertEquals(SleepProofPolicy.OUTCOME_ON, VendorBacklightPolicy.blankOutcome(step.backlightOff))
        // The record still says dark — the command WAS accepted; the proof says what it saw.
        assertTrue(e.dark)
    }

    @Test
    fun `a readback that times out leaves the outcome unknown but keeps the record`() {
        val f = Fake().apply { sendQueue += Call.Reply(okVoid); sendQueue += Call.TimedOut }
        val e = VendorBacklightEngine(f)
        val step = e.blank() as Step.Ok
        assertNull(step.backlightOff)
        assertTrue(e.dark)
        assertEquals(SleepProofPolicy.OUTCOME_UNKNOWN, VendorBacklightPolicy.blankOutcome(step.backlightOff))
    }

    @Test
    fun `a refused command is a Failed step that changes no record`() {
        val f = Fake().apply { sendQueue += Call.Reply(handlerNotFound) }
        val e = VendorBacklightEngine(f)
        val step = e.blank()
        assertTrue(step is Step.Failed)
        assertFalse(e.dark)
        assertTrue(f.darkChanges.isEmpty())
        assertNull(e.faulted)
    }

    @Test
    fun `a reply that is not an SDK response fails the step`() {
        val f = Fake().apply { sendQueue += Call.Reply("<html>oops</html>") }
        assertTrue(VendorBacklightEngine(f).blank() is Step.Failed)
    }

    // ─── timeouts: bounded, never a hang ─────────────────────────────────

    @Test
    fun `a command that outlives its budget is a failure, not a wait, and nothing is recorded`() {
        val f = Fake().apply { sendQueue += Call.TimedOut }
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
        // Each round trip eats 1 200 ms of a 1 900 ms budget: the command gets
        // the per-call ceiling (1 500 ms), the readback only the 700 ms that
        // are left — never a fresh budget.
        val f = Fake().apply { sendCostMs = 1_200L }
        val e = VendorBacklightEngine(f)
        val step = e.blank(budgetMs = 1_900L)
        assertTrue(step is Step.Ok)
        assertEquals(listOf(VendorBacklightPolicy.CALL_TIMEOUT_MS, 700L), f.budgets)
        // And a service that eats the WHOLE budget on the command gets no readback at all.
        val g = Fake().apply { sendCostMs = 1_900L }
        val s = VendorBacklightEngine(g).blank(budgetMs = 1_900L)
        assertTrue(s is Step.Ok)
        assertEquals(1, g.sent.size)
        assertNull((s as Step.Ok).backlightOff)
    }

    // ─── a dead binder: one reconnect, inside the budget ────────────────

    @Test
    fun `a dead binder is reconnected ONCE and the command retried`() {
        val f = Fake().apply { sendQueue += Call.Failed("DeadObjectException", binderDead = true) }
        val e = VendorBacklightEngine(f)
        val step = e.wake()
        assertTrue(step is Step.Ok)
        assertEquals(1, f.disconnects)
        assertEquals(2, f.connects)
        // The ON was sent twice (once to the dead binder, once after reconnecting).
        assertEquals(2, f.sent.count { it.contains("CmdSetScreenStatus") })
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
    }

    // ─── rule 4: the fault latch ─────────────────────────────────────────

    @Test
    fun `a failed ON after our own OFF latches the fault — no further blank, wake keeps trying`() {
        val f = Fake()
        val e = VendorBacklightEngine(f)
        e.probe()
        assertTrue(e.blank() is Step.Ok)
        f.sendQueue += Call.TimedOut
        assertTrue(e.wake() is Step.Failed)
        assertNotNull(e.faulted)
        assertTrue(e.dark) // the record keeps telling the truth: we turned it off
        assertEquals(setOf(Capability.WAKE), VendorBacklightPolicy.supports(e.detection, seenBefore = true, killSwitchOff = false, faulted = e.faulted != null))
        // The next wake that succeeds clears the fault.
        assertTrue(e.wake() is Step.Ok)
        assertNull(e.faulted)
        assertFalse(e.dark)
    }

    @Test
    fun `a failed ON while the backlight was never ours does not latch anything`() {
        val f = Fake().apply { sendQueue += Call.TimedOut }
        val e = VendorBacklightEngine(f)
        assertTrue(e.wake() is Step.Failed)
        assertNull(e.faulted)
    }

    // ─── rule 3: emergency first — queued, never waited for ─────────────

    @Test
    fun `the alert path queues the ON and returns before any binder call is made`() {
        val f = Fake()
        val e = VendorBacklightEngine(f)
        e.probe()
        e.blank()
        val sentBefore = f.sent.size
        assertTrue(e.emergencyOn(quiet = false, seenBefore = true))
        // Nothing was sent on the caller's thread — the work sits on the worker.
        assertEquals(sentBefore, f.sent.size)
        assertEquals(1, f.submitted.size)
        // When the worker runs it, the backlight comes on and the record clears.
        f.submitted.single().invoke()
        assertFalse(e.dark)
        assertTrue(f.sent.last { it.contains("CmdSetScreenStatus") }.contains("\\\"on\\\":true"))
    }

    @Test
    fun `a quiet re-raise asks only while the backlight is off by our hand`() {
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
        val absent = Fake().apply { installed = false }
        val a = VendorBacklightEngine(absent)
        a.probe()
        assertFalse(a.emergencyOn(quiet = false, seenBefore = false))
        assertTrue(absent.submitted.isEmpty())
    }

    @Test
    fun `a hanging or throwing ON on the worker never reaches the caller`() {
        val f = Fake()
        val e = VendorBacklightEngine(f)
        e.probe()
        e.blank()
        f.sendQueue += Call.TimedOut // the ON will time out when the worker runs it
        assertTrue(e.emergencyOn(quiet = false, seenBefore = true))
        // Running the queued work throws nothing; the fault is latched, the record stands.
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
