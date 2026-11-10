package com.educms.player.health

import com.educms.player.health.MainThreadStallPolicy.State
import org.junit.Assert.*
import org.junit.Test

class MainThreadStallPolicyTest {

    private val p = MainThreadStallPolicy.PROBE_INTERVAL_MS

    /** Drive the probe; [answerDelay] says how long the main thread takes to answer a ping posted at t (null = never). */
    private fun drive(untilMs: Long, answerDelay: (Long) -> Long?): Pair<State, List<MainThreadStallPolicy.Actions>> {
        var s = State()
        var answered: Long? = null
        val acts = mutableListOf<MainThreadStallPolicy.Actions>()
        var t = 0L
        while (t <= untilMs) {
            val (n, a) = MainThreadStallPolicy.onTick(s, t, answered?.takeIf { it <= t })
            s = n
            acts += a
            if (a.post) answered = answerDelay(t)?.let { t + it }
            t += p
        }
        return s to acts
    }

    @Test fun `a responsive main thread never stalls`() {
        val (s, acts) = drive(10 * 60_000L) { 3L }
        assertEquals(0, s.stalls)
        assertTrue(acts.none { it.captureStack || it.prompt || it.startedMs != null })
    }

    @Test fun `a slow rk3288 page boot of 8 s is not a stall`() {
        val (s, _) = drive(60_000L) { t -> if (t == 0L) 8_000L else 2L }
        assertEquals(0, s.stalls)
    }

    @Test fun `a frozen main thread opens one stall, one stack, one prompt`() {
        val (s, acts) = drive(5 * 60_000L) { t -> if (t == 0L) null else 1L }
        assertEquals(1, s.stalls)
        assertEquals(1, acts.count { it.captureStack })
        assertEquals(1, acts.count { it.prompt })
        assertTrue(s.stallOpen)
        assertEquals(5 * 60_000L, s.openStallMs(5 * 60_000L))
        assertEquals(MainThreadStallPolicy.STALL_MS, acts.first { it.startedMs != null }.startedMs)
    }

    @Test fun `the answer closes the stall with its duration`() {
        val (s, acts) = drive(2 * 60_000L) { t -> if (t == 0L) 42_000L else 1L }
        assertEquals(1, s.stalls)
        assertFalse(s.stallOpen)
        assertEquals(42_000L, s.lastStallMs)
        assertEquals(42_000L, s.maxStallMs)
        assertEquals(42_000L, acts.first { it.endedMs != null }.endedMs)
        assertEquals(1, acts.count { it.prompt })
    }

    @Test fun `a stall seen only after the answer still counts`() {
        var s = State()
        s = MainThreadStallPolicy.onTick(s, 0, null).first
        val (n, a) = MainThreadStallPolicy.onTick(s, 13_000, 12_000)
        assertEquals(1, n.stalls)
        assertEquals(12_000L, a.endedMs)
    }

    @Test fun `a frozen PROCESS (probe starved) is not a main-thread stall`() {
        var s = State()
        s = MainThreadStallPolicy.onTick(s, 0, null).first
        val (n, a) = MainThreadStallPolicy.onTick(s, 60_000, null)
        assertEquals(0, n.stalls)
        assertEquals(1, n.starved)
        assertTrue(a.post)
        assertNull(a.startedMs)
    }

    @Test fun `stack formatting is compact, redacted and capped`() {
        val frames = List(40) { StackTraceElement("com.educms.player.MainActivity", "loadPlayer$it", "MainActivity.kt", it + 1) }
        val out = MainThreadStallPolicy.formatStack(frames)
        assertTrue(out.startsWith("MainActivity.loadPlayer0:1;"))
        assertTrue(out.length <= MainThreadStallPolicy.STACK_CAP)
        assertEquals(MainThreadStallPolicy.STACK_FRAMES, out.split(';').size)
        val leaky = MainThreadStallPolicy.formatStack(listOf(StackTraceElement("x.Y", "token=abc123secret", null, -1)))
        assertFalse(leaky.contains("abc123secret"))
    }
}
