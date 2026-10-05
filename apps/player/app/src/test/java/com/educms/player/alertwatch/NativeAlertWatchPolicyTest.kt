package com.educms.player.alertwatch

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Base64

/**
 * THE NATIVE ALERT WATCH — its rules, one at a time (2026-10-05, 1.1.22).
 *
 * The incident: an X80 whose page made no request for 8.8 hours behind a
 * dark panel, so a lockdown could not wake it. These are the rules the fix
 * rests on; [NativeAlertWatchEngineTest] runs them in sequence on a virtual
 * clock.
 */
class NativeAlertWatchPolicyTest {

    private val p = NativeAlertWatchPolicy

    private fun jwt(payload: String): String {
        val enc = Base64.getUrlEncoder().withoutPadding()
        return enc.encodeToString("""{"alg":"HS256","typ":"JWT"}""".toByteArray()) + "." +
            enc.encodeToString(payload.toByteArray()) + "." + enc.encodeToString(ByteArray(32) { 7 })
    }

    private val screenId = "7d0c4a3e-1b2f-4c5d-8e9f-0a1b2c3d4e5f"
    private val token = jwt("""{"sub":"$screenId","deviceId":"$screenId","kind":"device","ep":0,"iat":1,"exp":2}""")

    // ─── rule 1: who may be polled, and when ─────────────────────────

    @Test
    fun `PANEL ON means no polling, whatever else is true`() {
        assertNotNull(p.pollRefusal(panelInteractive = true, apiRoot = "https://api", apiRootAllowed = true, targets = 1))
        assertNull(p.pollRefusal(panelInteractive = false, apiRoot = "https://api", apiRootAllowed = true, targets = 1))
    }

    @Test
    fun `not paired, no API root or a foreign API root means no polling`() {
        assertNotNull(p.pollRefusal(false, apiRoot = "https://api", apiRootAllowed = true, targets = 0))
        assertNotNull(p.pollRefusal(false, apiRoot = null, apiRootAllowed = false, targets = 1))
        assertNotNull(p.pollRefusal(false, apiRoot = "  ", apiRootAllowed = true, targets = 1))
        assertNotNull(p.pollRefusal(false, apiRoot = "https://evil.example", apiRootAllowed = false, targets = 1))
    }

    @Test
    fun `the screen id is read from the token the store already holds`() {
        assertEquals(screenId, p.screenIdOf(token))
        val t = p.targetOf(0, "  $token\n")
        assertEquals(screenId, t?.screenId)
        assertEquals(token, t?.token)
        assertFalse("a target must never print its credential", t.toString().contains(token.substring(0, 20)))
    }

    @Test
    fun `no token, a damaged token or a token that names no screen is no target`() {
        assertNull(p.targetOf(0, null))
        assertNull(p.targetOf(0, ""))
        assertNull(p.targetOf(0, "not-a-jwt"))
        assertNull(p.targetOf(0, "aaaa.bbbb.cccc"))                       // payload is not JSON
        assertNull(p.targetOf(0, jwt("""{"kind":"device"}""")))           // no sub
        assertNull(p.targetOf(0, jwt("""{"sub":42}""")))                  // not a string
        assertNull(p.targetOf(0, jwt("""["sub","x"]""")))
        // A screen id goes into a URL path: nothing that could reshape it.
        assertNull(p.targetOf(0, jwt("""{"sub":"../../admin/users"}""")))
        assertNull(p.targetOf(0, jwt("""{"sub":"abc def ghi jkl"}""")))
        assertNull(p.targetOf(0, jwt("""{"sub":"a%2Fb%2Fc%2Fd"}""")))
        assertNull(p.targetOf(0, "$token\r\nX-Injected: 1"))
    }

    // ─── rule 3: what a poll proves ──────────────────────────────────

    private val fresh = PollMemory(nextPollAtMs = 0)

    @Test
    fun `200 with an alert is ALERT and 200 without is NO_ALERT`() {
        assertEquals(AlertVerdict.ALERT, p.classify(PollOutcome(200, ManifestScan.ALERT), fresh))
        assertEquals(AlertVerdict.NO_ALERT, p.classify(PollOutcome(200, ManifestScan.NO_ALERT), fresh))
    }

    @Test
    fun `every failure is UNKNOWN — never an alert, never an all-clear`() {
        val failures = listOf(
            PollOutcome(null, error = "SocketTimeoutException"),
            PollOutcome(null, error = "UnknownHostException"),
            PollOutcome(401), PollOutcome(403), PollOutcome(404), PollOutcome(429),
            PollOutcome(500), PollOutcome(502), PollOutcome(503),
            PollOutcome(301), PollOutcome(204), PollOutcome(206, ManifestScan.ALERT),
            PollOutcome(200, ManifestScan.MALFORMED), PollOutcome(200, ManifestScan.TOO_LARGE), PollOutcome(200, null),
            // A 500 whose error page happens to parse as an alert is still a 500.
            PollOutcome(500, ManifestScan.ALERT),
        )
        val knowsAlert = PollMemory(0, etag = "e1", etagVerdict = AlertVerdict.ALERT)
        for (f in failures) {
            assertEquals("$f", AlertVerdict.UNKNOWN, p.classify(f, fresh))
            assertEquals("$f", AlertVerdict.UNKNOWN, p.classify(f, knowsAlert))
        }
    }

    @Test
    fun `304 keeps the previous answer — and only for the validator that was sent`() {
        val noAlert = PollMemory(0, etag = "abc", etagVerdict = AlertVerdict.NO_ALERT)
        val alert = PollMemory(0, etag = "abc", etagVerdict = AlertVerdict.ALERT)
        assertEquals(AlertVerdict.NO_ALERT, p.classify(PollOutcome(304, sentEtag = "abc"), noAlert))
        assertEquals(AlertVerdict.ALERT, p.classify(PollOutcome(304, sentEtag = "abc"), alert))
        // A 304 nobody asked for, or for another validator, proves nothing.
        assertEquals(AlertVerdict.UNKNOWN, p.classify(PollOutcome(304, sentEtag = null), noAlert))
        assertEquals(AlertVerdict.UNKNOWN, p.classify(PollOutcome(304, sentEtag = "zzz"), noAlert))
        assertEquals(AlertVerdict.UNKNOWN, p.classify(PollOutcome(304, sentEtag = "abc"), fresh))
    }

    @Test
    fun `the validator is remembered only with an answer, and dropped when it stops standing for one`() {
        val ok = PollOutcome(200, ManifestScan.NO_ALERT, etag = "abc")
        val m1 = p.afterPoll(fresh, ok, AlertVerdict.NO_ALERT, nowMs = 1_000)
        assertEquals("abc", m1.etag)
        assertEquals(AlertVerdict.NO_ALERT, m1.etagVerdict)
        assertEquals(1_000 + p.POLL_INTERVAL_MS, m1.nextPollAtMs)

        // 304: nothing changes but the clock.
        val m2 = p.afterPoll(m1, PollOutcome(304, sentEtag = "abc"), AlertVerdict.NO_ALERT, nowMs = 16_000)
        assertEquals("abc", m2.etag)
        assertEquals(0, m2.failures)

        // A network failure says nothing about the manifest: keep the validator.
        val m3 = p.afterPoll(m2, PollOutcome(null, error = "x"), AlertVerdict.UNKNOWN, nowMs = 31_000)
        assertEquals("abc", m3.etag)
        assertEquals(1, m3.failures)

        // A 200 we could not read: the old validator no longer stands for an answer.
        val m4 = p.afterPoll(m3, PollOutcome(200, ManifestScan.MALFORMED, etag = "new"), AlertVerdict.UNKNOWN, nowMs = 46_000)
        assertNull(m4.etag)
        assertNull(m4.etagVerdict)
        assertEquals(2, m4.failures)

        // No validator, or one that could end a header line, is not kept.
        assertNull(p.afterPoll(fresh, PollOutcome(200, ManifestScan.NO_ALERT), AlertVerdict.NO_ALERT, 0).etag)
        assertNull(p.afterPoll(fresh, PollOutcome(200, ManifestScan.NO_ALERT, etag = "a\r\nX: 1"), AlertVerdict.NO_ALERT, 0).etag)
        assertNull(p.afterPoll(fresh, PollOutcome(200, ManifestScan.NO_ALERT, etag = "x".repeat(300)), AlertVerdict.NO_ALERT, 0).etag)
        assertEquals("W/\"1a-x\"", p.afterPoll(fresh, PollOutcome(200, ManifestScan.NO_ALERT, etag = "W/\"1a-x\""), AlertVerdict.NO_ALERT, 0).etag)
    }

    // ─── cadence ─────────────────────────────────────────────────────

    @Test
    fun `15 s while it answers, backing off to 60 s and never past it`() {
        assertEquals(15_000L, p.POLL_INTERVAL_MS)
        assertEquals(60_000L, p.MAX_BACKOFF_MS)
        assertEquals(15_000L, p.pollDelayMs(0))
        assertEquals(15_000L, p.pollDelayMs(1))
        assertEquals(30_000L, p.pollDelayMs(2))
        assertEquals(60_000L, p.pollDelayMs(3))
        var last = 0L
        for (f in listOf(0, 1, 2, 3, 4, 5, 10, 63, 64, 1000, Int.MAX_VALUE, -1)) {
            val d = p.pollDelayMs(f)
            assertTrue("failures=$f → $d", d in p.POLL_INTERVAL_MS..p.MAX_BACKOFF_MS)
            if (f >= 0) assertTrue("backoff must not shrink as failures grow", d >= last)
            if (f >= 0) last = d
        }
    }

    @Test
    fun `the first poll is within about three seconds of the panel going off`() {
        assertTrue(p.firstMemory(1_000).nextPollAtMs - 1_000 <= 3_000)
    }

    @Test
    fun `a success resets the backoff`() {
        var m = fresh
        repeat(5) { m = p.afterPoll(m, PollOutcome(503), AlertVerdict.UNKNOWN, nowMs = 0) }
        assertEquals(60_000L, m.nextPollAtMs)
        m = p.afterPoll(m, PollOutcome(200, ManifestScan.NO_ALERT, etag = "e"), AlertVerdict.NO_ALERT, nowMs = 0)
        assertEquals(0, m.failures)
        assertEquals(15_000L, m.nextPollAtMs)
    }

    @Test
    fun `every network call is bounded and the wake lock outlasts the longest gap between refreshes`() {
        assertTrue(p.CONNECT_TIMEOUT_MS in 1..10_000)
        assertTrue(p.READ_TIMEOUT_MS in 1..10_000)
        assertTrue(p.REQUEST_BUDGET_MS in 1L..60_000L)
        assertTrue(p.MAX_BODY_BYTES in 1_000_000L..64L * 1024 * 1024)
        // The lock is re-acquired before every request and before every
        // sleep; it must outlive a full backoff sleep plus a whole request.
        assertTrue(p.CPU_LOCK_TIMEOUT_MS >= p.MAX_BACKOFF_MS + p.REQUEST_BUDGET_MS + 30_000)
        // …and must still be a timeout, not a leak.
        assertTrue(p.CPU_LOCK_TIMEOUT_MS <= 10 * 60_000L)
    }

    @Test
    fun `the CPU is held only while the panel is off and there is work`() {
        assertTrue(p.holdCpu(panelInteractive = false, hasWork = true))
        assertFalse(p.holdCpu(panelInteractive = true, hasWork = true))
        assertFalse(p.holdCpu(panelInteractive = false, hasWork = false))
        assertFalse(p.holdCpu(panelInteractive = true, hasWork = false))
    }

    // ─── rule 2: RAISE ONLY ──────────────────────────────────────────

    @Test
    fun `the watch has exactly two actions and neither is a release`() {
        assertEquals(listOf("NONE", "RAISE"), WatchAction.values().map { it.name })
    }

    @Test
    fun `only a live alert behind a dark panel raises`() {
        assertEquals(WatchAction.RAISE, p.actionFor(AlertVerdict.ALERT, panelInteractive = false))
        assertEquals(WatchAction.NONE, p.actionFor(AlertVerdict.ALERT, panelInteractive = true))
        for (interactive in listOf(true, false)) {
            assertEquals(WatchAction.NONE, p.actionFor(AlertVerdict.NO_ALERT, interactive))
            assertEquals(WatchAction.NONE, p.actionFor(AlertVerdict.UNKNOWN, interactive))
        }
    }

    @Test
    fun `no alert and unknown never change what is held — they only inform the next raise`() {
        val open = FaceWatch(episode = AlertEpisode(openedAtMs = 0, confirmFloorMs = Long.MIN_VALUE))
        val unknown = p.onVerdict(open, AlertVerdict.UNKNOWN, nowMs = 5, panelInteractive = false)
        assertEquals(WatchAction.NONE, unknown.action)
        assertEquals(open, unknown.state)

        val cleared = p.onVerdict(open, AlertVerdict.NO_ALERT, nowMs = 9, panelInteractive = false)
        assertEquals(WatchAction.NONE, cleared.action)
        assertEquals(9L, cleared.state.lastNoAlertAtMs)
        // The page has not confirmed: the episode stays open (the page still
        // gets its reload, which is what lets the page release the hold).
        assertEquals(true, cleared.state.episode?.serverCleared)
    }

    // ─── episodes ────────────────────────────────────────────────────

    @Test
    fun `an alert opens one episode and repeats re-raise without opening another`() {
        val first = p.onVerdict(FaceWatch(), AlertVerdict.ALERT, nowMs = 100, panelInteractive = false)
        assertEquals(WatchAction.RAISE, first.action)
        assertTrue(first.openedEpisode)
        assertEquals(100L, first.state.episode?.openedAtMs)

        val again = p.onVerdict(first.state, AlertVerdict.ALERT, nowMs = 115, panelInteractive = false)
        assertEquals("a re-raise re-enforces a visible screen", WatchAction.RAISE, again.action)
        assertFalse(again.openedEpisode)
        assertEquals(first.state, again.state)
    }

    @Test
    fun `an alert that arrives once the panel is on belongs to the page`() {
        val step = p.onVerdict(FaceWatch(), AlertVerdict.ALERT, nowMs = 100, panelInteractive = true)
        assertEquals(WatchAction.NONE, step.action)
        assertNull(step.state.episode)
    }

    @Test
    fun `A NEW ALERT RESETS THE BUDGET`() {
        var s = p.onVerdict(FaceWatch(), AlertVerdict.ALERT, 0, false).state
        repeat(3) { s = p.afterReload(s, nowMs = 1_000L * (it + 1)) }
        s = p.settle(s, Settled.GAVE_UP)
        assertEquals(3, s.episode?.reloads)

        // Still the same alert: no new budget.
        val same = p.onVerdict(s, AlertVerdict.ALERT, 10_000, false)
        assertFalse(same.openedEpisode)
        assertEquals(3, same.state.episode?.reloads)

        // The server says no alert, then an alert again: a new one.
        s = p.onVerdict(s, AlertVerdict.NO_ALERT, 20_000, false).state
        assertNull("a settled episode ends with the alert", s.episode)
        val next = p.onVerdict(s, AlertVerdict.ALERT, 30_000, false)
        assertTrue(next.openedEpisode)
        assertEquals(0, next.state.episode?.reloads)
        assertEquals("only a page raise AFTER the last no-alert counts", 20_000L, next.state.episode?.confirmFloorMs)
        assertEquals("the once-a-minute gap still spans alerts", 3_000L, next.state.lastReloadAtMs)
    }

    // ─── rule 4: confirm, or reload ──────────────────────────────────

    private fun opened(at: Long, floor: Long = Long.MIN_VALUE) = FaceWatch(episode = AlertEpisode(at, floor))

    private fun facts(now: Long, held: Boolean = true, pageRaise: Long? = null, load: Long? = null) =
        FollowUpFacts(now, held, pageRaise, load)

    @Test
    fun `the page confirming ends the matter — no reload`() {
        val s = opened(at = 1_000, floor = 900)
        assertEquals(FollowUp.Confirmed, p.followUp(s, facts(now = 5_000, pageRaise = 4_000)))
        // Even long after the window.
        assertEquals(FollowUp.Confirmed, p.followUp(s, facts(now = 500_000, pageRaise = 4_000)))
        // A raise the page made BEFORE the watch last saw no alert is about an older alert.
        assertTrue(p.followUp(s, facts(now = 5_000, pageRaise = 800)) is FollowUp.Wait)
        // Never having seen "no alert": the page's raise in this hold period counts.
        assertEquals(FollowUp.Confirmed, p.followUp(opened(at = 1_000), facts(now = 1_001, pageRaise = 5)))
    }

    @Test
    fun `NEVER CONFIRMED — reload at 20 s, again no sooner than 60 s later, never more than three`() {
        var s = opened(at = 0)
        val reloadedAt = ArrayList<Long>()
        var gaveUpAt: Long? = null
        var now = 0L
        while (now <= 600_000 && gaveUpAt == null) {
            // The Activity stamps a load start when it reloads.
            when (p.followUp(s, facts(now, load = reloadedAt.lastOrNull()))) {
                FollowUp.Reload -> {
                    reloadedAt.add(now)
                    s = p.afterReload(s, now)
                }
                FollowUp.GaveUp -> {
                    gaveUpAt = now
                    s = p.settle(s, Settled.GAVE_UP)
                }
                else -> Unit
            }
            now += 1_000
        }
        assertEquals(listOf(20_000L, 80_000L, 140_000L), reloadedAt)
        assertEquals("the third load gets its minute before the watch gives up", 200_000L, gaveUpAt)
        // …and after giving up, nothing more — for as long as the alert lasts.
        for (t in listOf(200_001L, 600_000L, 86_400_000L)) {
            assertEquals(FollowUp.Idle, p.followUp(s, facts(t)))
        }
    }

    @Test
    fun `inside the 20 s window the answer is always wait`() {
        val s = opened(at = 10_000)
        for (t in 10_000L until 30_000L step 1_000L) assertTrue("t=$t", p.followUp(s, facts(t)) is FollowUp.Wait)
        assertEquals(FollowUp.Reload, p.followUp(s, facts(30_000)))
    }

    @Test
    fun `a page load younger than a minute is never restarted — ours or anybody's`() {
        val s = opened(at = 0)
        // The Activity cold-started 5 s after the raise: it gets its minute.
        assertTrue(p.followUp(s, facts(now = 20_000, load = 5_000)) is FollowUp.Wait)
        assertTrue(p.followUp(s, facts(now = 64_999, load = 5_000)) is FollowUp.Wait)
        assertEquals(FollowUp.Reload, p.followUp(s, facts(now = 65_000, load = 5_000)))
        // Our own last reload counts even when the Activity reports nothing.
        val reloaded = p.afterReload(s, nowMs = 20_000)
        assertTrue(p.followUp(reloaded, facts(now = 79_999)) is FollowUp.Wait)
        assertEquals(FollowUp.Reload, p.followUp(reloaded, facts(now = 80_000)))
    }

    @Test
    fun `the page releasing the hold on a live manifest ends the episode without a reload`() {
        assertEquals(FollowUp.PageCleared, p.followUp(opened(at = 0), facts(now = 25_000, held = false)))
        assertNull(p.close(opened(at = 0)).episode)
    }

    @Test
    fun `nothing open, or already settled, asks for nothing`() {
        assertEquals(FollowUp.Idle, p.followUp(FaceWatch(), facts(1)))
        assertEquals(FollowUp.Idle, p.followUp(p.settle(opened(0), Settled.CONFIRMED), facts(999_999)))
    }

    // ─── the player on the glass ─────────────────────────────────────

    @Test
    fun `the player is brought forward only while an alert is live and it is not on the glass, a bounded number of times`() {
        assertTrue(p.relaunchDue(RelaunchMemory(), 0, alertLive = true, playerInForeground = false))
        assertFalse(p.relaunchDue(RelaunchMemory(), 0, alertLive = true, playerInForeground = true))
        assertFalse(p.relaunchDue(RelaunchMemory(), 0, alertLive = false, playerInForeground = false))
        // Spaced…
        assertFalse(p.relaunchDue(RelaunchMemory(1, lastAtMs = 0), 9_999, true, false))
        assertTrue(p.relaunchDue(RelaunchMemory(1, lastAtMs = 0), 10_000, true, false))
        // …and bounded.
        assertFalse(p.relaunchDue(RelaunchMemory(p.MAX_RELAUNCHES_PER_ALERT, lastAtMs = 0), 999_999, true, false))
        assertTrue(p.MAX_RELAUNCHES_PER_ALERT in 1..10)
    }

    @Test
    fun `the limits are the ones the design was signed off with`() {
        assertEquals(20_000L, p.CONFIRM_WINDOW_MS)
        assertEquals(60_000L, p.RELOAD_MIN_GAP_MS)
        assertEquals(3, p.MAX_RELOADS_PER_ALERT)
    }
}
