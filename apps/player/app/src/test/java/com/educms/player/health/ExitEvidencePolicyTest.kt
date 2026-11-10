package com.educms.player.health

import com.educms.player.ProcessExitPolicy
import org.junit.Assert.*
import org.junit.Test

class ExitEvidencePolicyTest {

    private fun exit(at: Long, reason: Int, desc: String? = null) = ExitEvidencePolicy.Exit(at, reason, 0, 100, 1000, 2000, desc)

    @Test fun `only ANR and native crash post a trace - JVM crashes and kills do not`() {
        assertTrue(ExitEvidencePolicy.shouldPostTrace(ProcessExitPolicy.REASON_ANR))
        assertTrue(ExitEvidencePolicy.shouldPostTrace(ProcessExitPolicy.REASON_CRASH_NATIVE))
        assertFalse(ExitEvidencePolicy.shouldPostTrace(ProcessExitPolicy.REASON_CRASH))
        assertFalse(ExitEvidencePolicy.shouldPostTrace(ProcessExitPolicy.REASON_LOW_MEMORY))
        assertFalse(ExitEvidencePolicy.shouldPostTrace(ProcessExitPolicy.REASON_SIGNALED))
    }

    @Test fun `the summary keeps the newest four, deduplicated`() {
        val first = ExitEvidencePolicy.merge(null, listOf(exit(1, 3), exit(2, 6), exit(3, 2)))
        val next = ExitEvidencePolicy.merge(first.toString(), listOf(exit(3, 2), exit(4, 5), exit(5, 3)))
        assertEquals(4, next.length())
        assertEquals(listOf(5L, 4L, 3L, 2L), (0 until 4).map { next.getJSONObject(it).getLong("at") })
        assertEquals(4, ExitEvidencePolicy.merge("not json", (1L..5L).map { exit(it, 3) }).length())
    }

    @Test fun `the summary description is sanitised and redacted`() {
        val o = ExitEvidencePolicy.summary(exit(1, 6, "Input dispatching timed out https://x.example/p?token=SECRET Bearer eyJabcdefghij.kk.ll"))
        val d = o.getString("desc")
        assertFalse(d.contains("SECRET"))
        assertFalse(d.contains("eyJ"))
        assertTrue(d.length <= ProcessExitPolicy.DESCRIPTION_CAP)
    }

    @Test fun `at most two traces wait, newest first`() {
        assertEquals(listOf(4L, 2L), ExitEvidencePolicy.pendingAfter(listOf(1L), listOf(exit(2, 6), exit(3, 3), exit(4, 5))))
    }

    @Test fun `acknowledged by any 2xx or a 4xx other than 429`() {
        assertTrue(ExitEvidencePolicy.acknowledged(200))
        assertTrue(ExitEvidencePolicy.acknowledged(404))
        assertFalse(ExitEvidencePolicy.acknowledged(429))
        assertFalse(ExitEvidencePolicy.acknowledged(503))
        assertFalse(ExitEvidencePolicy.acknowledged(-1))
    }

    @Test fun `only the main thread's section of an ANR trace leaves the box`() {
        val trace = listOf(
            "----- pid 123 at 2026-11-09 -----",
            "\"Signal Catcher\" daemon prio=10 tid=2 Runnable",
            "  at x.y(Z.java:1)",
            "",
            "\"main\" prio=5 tid=1 Blocked",
            "  at com.educms.player.MainActivity.loadPlayer(MainActivity.kt:10)",
            "  - waiting to lock <0x1> held by thread 12 url=https://h.example/a?token=abc",
            "",
            "\"edu-manager-heartbeat\" prio=5 tid=20 Native",
            "  at other.Thread(Other.java:2)",
        ).joinToString("\n")
        val main = ExitEvidencePolicy.mainThreadSection(trace)!!
        assertTrue(main.startsWith("\"main\" prio=5"))
        assertTrue(main.contains("MainActivity.loadPlayer"))
        assertFalse(main.contains("Signal Catcher"))
        assertFalse(main.contains("edu-manager-heartbeat"))
        assertFalse(main.contains("token=abc"))
        assertNull(ExitEvidencePolicy.mainThreadSection("no threads here"))
        val huge = "\"main\" prio=5\n" + "  at a.b(C.java:1)\n".repeat(5000)
        assertTrue(ExitEvidencePolicy.mainThreadSection(huge)!!.length <= ExitEvidencePolicy.TRACE_CAP)
    }

    @Test fun `the crash body names the kind and the source`() {
        val b = ExitEvidencePolicy.crashBody(exit(77, ProcessExitPolicy.REASON_ANR, "Input dispatching timed out"), "stack", "1.1.68", 168)
        assertEquals("player", b.getString("source"))
        assertTrue(b.getString("message").startsWith("ANR (previous process, exited at=77"))
        assertTrue(ExitEvidencePolicy.crashMessage(exit(1, ProcessExitPolicy.REASON_CRASH_NATIVE)).startsWith("native crash"))
    }
}
