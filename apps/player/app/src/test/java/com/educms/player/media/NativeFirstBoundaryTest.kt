package com.educms.player.media

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assume
import org.junit.Test
import java.io.File

/**
 * THE NATIVE → NATIVE BOUNDARY SWITCH (design NATIVE-FIRST-ONE-STORE §3.3).
 *
 * The decisions (NativeFirstBoundary), the loop-end detection the renderer
 * stops on (LoopTimeline), and — as source facts — that FaceVideoBox runs
 * exactly those decisions, with the emergency hold checked FIRST in every
 * pass that can put B on the glass (§7 E1). The visual claims — no black
 * frame, the held-frame time — are the glass's (§11 item 3), not this test's.
 */
class NativeFirstBoundaryTest {

    // ─── pre-roll vs hold-last-frame, under the decoder budget of EVERY face ───

    @Test
    fun `a pre-roll is allowed one decoder early, counted across every face`() {
        // A presents on this face; the codec says nothing about its limit (3 assumed).
        assertEquals(NativeFirstBoundary.Path.PREROLL, NativeFirstBoundary.path(decodersElsewhere = 1, advertisedInstances = 0))
        // A on this face + C on the other face of a double-sided unit: the pre-roll would take the last decoder.
        assertEquals(NativeFirstBoundary.Path.HOLD_LAST_FRAME, NativeFirstBoundary.path(decodersElsewhere = 2, advertisedInstances = 0))
        // A codec that advertises four instances has room for that pre-roll.
        assertEquals(NativeFirstBoundary.Path.PREROLL, NativeFirstBoundary.path(decodersElsewhere = 2, advertisedInstances = 4))
        assertEquals(NativeFirstBoundary.Path.HOLD_LAST_FRAME, NativeFirstBoundary.path(decodersElsewhere = 3, advertisedInstances = 4))
        // A single-instance decoder can never pre-roll: A's last frame is held instead.
        assertEquals(NativeFirstBoundary.Path.HOLD_LAST_FRAME, NativeFirstBoundary.path(decodersElsewhere = 1, advertisedInstances = 1))
        // Never more than the protocol-3 ceiling, whatever the codec claims.
        assertEquals(NativeFirstBoundary.Path.HOLD_LAST_FRAME, NativeFirstBoundary.path(decodersElsewhere = 3, advertisedInstances = 16))
    }

    @Test
    fun `the swap is due at once for now, at the loop end for boundary, and never before B is ready`() {
        assertTrue(NativeFirstBoundary.swapDue(StartPolicy.NOW, bReady = true, aAtLapEnd = false, bReadyAtMs = 1_000L, nowMs = 1_001L))
        assertFalse(NativeFirstBoundary.swapDue(StartPolicy.NOW, bReady = false, aAtLapEnd = true, bReadyAtMs = 0L, nowMs = 99_999L))
        assertFalse(NativeFirstBoundary.swapDue(StartPolicy.BOUNDARY, bReady = true, aAtLapEnd = false, bReadyAtMs = 1_000L, nowMs = 30_000L))
        assertTrue(NativeFirstBoundary.swapDue(StartPolicy.BOUNDARY, bReady = true, aAtLapEnd = true, bReadyAtMs = 1_000L, nowMs = 2_000L))
        // A long clip: the boundary wait is bounded exactly like today's hand-off wait.
        assertTrue(NativeFirstBoundary.swapDue(StartPolicy.BOUNDARY, bReady = true, aAtLapEnd = false, bReadyAtMs = 1_000L,
            nowMs = 1_000L + NativeFirstBoundary.BOUNDARY_WAIT_MS))
    }

    @Test
    fun `the swap pass checks the hold FIRST — a raised hold puts nothing on the glass`() {
        for (path in NativeFirstBoundary.Path.values()) {
            assertEquals(listOf(NativeFirstBoundary.Step.ABORT_HELD), NativeFirstBoundary.swapSteps(held = true, path = path))
        }
        assertEquals(
            listOf(NativeFirstBoundary.Step.FREEZE_A, NativeFirstBoundary.Step.RELEASE_B, NativeFirstBoundary.Step.REVEAL_B, NativeFirstBoundary.Step.REMOVE_A_ON_CONFIRM),
            NativeFirstBoundary.swapSteps(held = false, path = NativeFirstBoundary.Path.PREROLL),
        )
        val hold = NativeFirstBoundary.swapSteps(held = false, path = NativeFirstBoundary.Path.HOLD_LAST_FRAME)
        assertEquals(NativeFirstBoundary.Step.FREEZE_A, hold.first())
        assertTrue("B starts only after A's decoder is let go", hold.indexOf(NativeFirstBoundary.Step.START_B) > hold.indexOf(NativeFirstBoundary.Step.FREEZE_A))
        assertEquals("A's views go last: never a black frame between them", NativeFirstBoundary.Step.REMOVE_A_ON_CONFIRM, hold.last())
    }

    // ─── the loop end the renderer stops on ─────────────────────────

    @Test
    fun `the output side sees exactly one loop end per lap, even when input runs a lap ahead`() {
        val frameUs = 33_333L
        val t = LoopTimeline(frameUs)
        val queued = ArrayList<Long>()
        // Three-frame clip, input two laps ahead of output.
        repeat(3) { queued.add(t.queue(it * frameUs)) }
        assertTrue(t.wrap())
        repeat(3) { queued.add(t.queue(it * frameUs)) }
        assertTrue(t.wrap())
        repeat(3) { queued.add(t.queue(it * frameUs)) }
        val crossings = queued.map { t.outputCrossesLap(it) }
        assertEquals(listOf(false, false, false, true, false, false, true, false, false), crossings)
        // The picture BEFORE each crossing is the last of its lap: the timeline is continuous.
        assertEquals(queued[2] + frameUs, queued[3])
        assertEquals(queued[5] + frameUs, queued[6])
    }

    @Test
    fun `a single picture past several laps consumes them all at once`() {
        val t = LoopTimeline(10L)
        t.queue(0L); t.wrap(); t.queue(0L); t.wrap(); t.queue(0L)
        assertTrue(t.outputCrossesLap(1_000L))
        assertFalse(t.outputCrossesLap(1_010L))
    }

    // ─── the wiring (source facts) ──────────────────────────────────

    private val moduleRoot: File? by lazy {
        var dir: File? = File("").absoluteFile
        while (dir != null) {
            if (File(dir, "src/main/AndroidManifest.xml").isFile) return@lazy dir
            val nested = File(dir, "app/src/main/AndroidManifest.xml")
            if (nested.isFile) return@lazy File(dir, "app")
            dir = dir.parentFile
        }
        null
    }

    private fun read(relative: String): String {
        val root = moduleRoot
        Assume.assumeTrue("module root not on disk", root != null)
        val f = File(root, relative)
        Assume.assumeTrue("source not on disk: $relative", f.isFile)
        return f.readText().replace(Regex("/\\*[\\s\\S]*?\\*/"), "").lines().joinToString("\n") { it.substringBefore("//") }
    }

    private fun body(src: String, signature: String): String {
        val at = src.indexOf(signature)
        assertTrue("`$signature` not found", at >= 0)
        val next = Regex("\\n\\s*(?:@Synchronized )?(?:private |internal |public )?fun ").find(src, at + signature.length)
        return src.substring(at, next?.range?.first ?: src.length)
    }

    private val box get() = read("src/main/java/com/educms/player/media/FaceVideoBox.kt")

    @Test
    fun `the swap pass reads the hold before it touches anything, and runs the decided steps`() {
        val swap = body(box, "private fun swap(")
        val held = swap.indexOf("val held = DisplayEmergency.isHeld(b.host.ctx)")
        assertTrue("the hold is the first thing the pass reads", held >= 0)
        for (later in listOf("synchronized(this)", "promoteKey(", "renderer?.release()", "renderer?.stop()", "continueSwap(")) {
            val at = swap.indexOf(later)
            assertTrue("`$later` after the hold read", at < 0 || at > held)
        }
        assertTrue(swap.contains("NativeFirstBoundary.swapSteps(held, path)"))
        assertTrue("an aborted swap ends both", swap.contains("NativeFirstBoundary.Step.ABORT_HELD -> {"))
        val cont = body(box, "private fun continueSwap(")
        assertTrue("the second half reads the hold again first", cont.indexOf("DisplayEmergency.isHeld(b.host.ctx)") in 0 until cont.indexOf("startNow(host, b)"))
        val start = body(box, "private fun startNow(")
        assertTrue("startNow refuses under a hold before it starts a decoder",
            start.indexOf("DisplayEmergency.isHeld(host.ctx)") in 0 until start.indexOf("s.renderer?.start()"))
    }

    @Test
    fun `the path is decided from the budget of every face, and the swap timing from the pure rule`() {
        val ready = body(box, "fun surfaceReady(")
        assertTrue(ready.contains("val elsewhere = hosts.values.sumOf"))
        assertTrue(ready.contains("s.swapPath = NativeFirstBoundary.path(elsewhere, r.advertisedInstances)"))
        assertTrue("a v4 pre-roll holds its first frame", ready.contains("holdFirst = s.protocol == 3 || (s.v4 && s.key == NEXT)"))
        assertTrue(ready.contains("freezeAtLapEnd = { s.atLapEnd != LapAction.NONE }"))
        assertTrue(body(box, "private fun maybeSwap(").contains("NativeFirstBoundary.swapDue(b.start, bReady, a.frozenAt > 0, b.readyAt, now)"))
        // The predecessor's views go on the successor's first post-reveal render — never before.
        val updated = body(box, "private fun updated(")
        val confirm = updated.indexOf("s.layer.confirm(")
        val remove = updated.indexOf("stopSession(p.host, p, \"content-changed\")")
        assertTrue(confirm >= 0 && remove > confirm)
    }

    @Test
    fun `the renderer stops at the loop end only after the picture is due, and frees its decoder on demand`() {
        val r = read("src/main/java/com/educms/player/media/FaceVideoRenderer.kt")
        val drain = body(r, "fun drain(")
        val due = drain.indexOf("if (due - now > schedule.leadNs) return false")
        val lap = drain.indexOf("timeline.outputCrossesLap(info.presentationTimeUs) && freezeAtLapEnd()")
        val observe = drain.indexOf("schedule.observe(due, now)")
        assertTrue(due >= 0 && lap > due && observe > lap)
        assertTrue(drain.contains("lapEnded()"))
        assertTrue("the next lap's first picture is never shown", drain.substring(lap).contains("c.releaseOutputBuffer(index, false)"))
        assertTrue(r.contains("finished.countDown()"))
        assertTrue(body(r, "fun stopAndAwait(").contains("finished.await("))
    }
}
