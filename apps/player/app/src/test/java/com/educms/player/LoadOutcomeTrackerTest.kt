package com.educms.player

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 2026-08-30 player reliability program, W2-3.
 *
 * Chromium fires `onPageFinished` for error documents too, so the old
 * "any finish that isn't about:blank is a success" rule cleared the
 * recovery loop, zeroed the watchdog failure count and engaged lock task
 * on a screen showing an HTTP 403. These pin the contract that says a
 * finish is only a success when nothing failed the main frame first.
 */
class LoadOutcomeTrackerTest {

    @Test
    fun `a clean load counts as success`() {
        val t = LoadOutcomeTracker()
        t.onPageStarted()
        assertTrue(t.onPageFinished())
    }

    @Test
    fun `a main-frame error before the finish disqualifies it`() {
        val t = LoadOutcomeTracker()
        t.onPageStarted()
        t.onMainFrameError()
        assertFalse(t.onPageFinished())
    }

    @Test
    fun `the next navigation resets the verdict`() {
        val t = LoadOutcomeTracker()
        t.onPageStarted()
        t.onMainFrameError()
        assertFalse(t.onPageFinished())

        t.onPageStarted()
        assertTrue("a fresh navigation must not inherit the last one's failure", t.onPageFinished())
    }

    @Test
    fun `a failed load stays failed across repeated finishes`() {
        // Chromium can finish the same error document more than once
        // (redirect chains, soft reloads). Only onPageStarted clears it.
        val t = LoadOutcomeTracker()
        t.onPageStarted()
        t.onMainFrameError()
        assertFalse(t.onPageFinished())
        assertFalse(t.onPageFinished())
    }

    @Test
    fun `several errors in one navigation still resolve to a single failure`() {
        val t = LoadOutcomeTracker()
        t.onPageStarted()
        t.onMainFrameError()   // net::ERR_*
        t.onMainFrameError()   // then the HTTP error document
        assertFalse(t.onPageFinished())
    }

    @Test
    fun `errors the client never forwards cannot affect the verdict`() {
        // Sub-resource failures are filtered out by
        // SafePlayerWebViewClient (request.isForMainFrame), so the tracker
        // simply never hears about them. This asserts the contract from
        // the tracker's side: silence means success.
        val t = LoadOutcomeTracker()
        t.onPageStarted()
        // …a dozen 404s on images would land here, and don't.
        assertTrue(t.onPageFinished())
    }

    @Test
    fun `a finish with no preceding start is permissive`() {
        // Matches today's behaviour for the very first load event and
        // keeps this from becoming a new way to wedge a booting kiosk.
        val t = LoadOutcomeTracker()
        assertTrue(t.onPageFinished())
    }

    // ─── C-P1-3: an abort WE issued is not a success ──────────────────
    //
    // The tracker CANNOT see this case and is not supposed to: Chromium
    // delivers a caller-initiated `stopLoading()` as a clean
    // `onPageFinished` with NO `onReceivedError` at all (crbug/473261),
    // so nothing ever calls `onMainFrameError` and the tracker's honest
    // answer is "success". The disqualifier therefore lives in
    // SafePlayerWebViewClient as a separate one-shot flag.
    //
    // These tests pin the SEQUENCE that flag has to survive, modelled
    // exactly as the real client implements it, so a refactor that folds
    // the two mechanisms together has to keep both behaviours.

    /** Mirror of SafePlayerWebViewClient's abort flag + tracker pairing. */
    private class ClientOutcomeModel {
        private val tracker = LoadOutcomeTracker()
        private var abortedByUs = false

        fun markNextFinishAborted() { abortedByUs = true }

        fun onPageStarted() {
            tracker.onPageStarted()
            abortedByUs = false
        }

        fun onMainFrameError() = tracker.onMainFrameError()

        /** True iff this finish should invoke `onPageFinishedOk`. */
        fun onPageFinished(): Boolean {
            if (abortedByUs) {
                abortedByUs = false
                return false
            }
            return tracker.onPageFinished()
        }
    }

    @Test
    fun `the watchdog's own abort does not count as a successful load`() {
        // The exact live sequence: a page is loading, the watchdog decides
        // it is stale, marks the abort and calls stopLoading — and
        // Chromium answers with a CLEAN finish. Before C-P1-3 that finish
        // cleared recovery, zeroed the strike counter and pinned lock
        // task on a page that had painted nothing.
        val c = ClientOutcomeModel()
        c.onPageStarted()
        c.markNextFinishAborted()
        assertFalse("our own stopLoading was counted as a success", c.onPageFinished())
    }

    @Test
    fun `the reload that follows an abort can still succeed`() {
        // The flag must be strictly one-shot, or the watchdog's own
        // recovery reload would be disqualified too and the screen could
        // never report healthy again.
        val c = ClientOutcomeModel()
        c.onPageStarted()
        c.markNextFinishAborted()
        assertFalse(c.onPageFinished())

        c.onPageStarted()
        assertTrue("the recovery navigation was wrongly disqualified", c.onPageFinished())
    }

    @Test
    fun `a new navigation clears a mark that never produced a finish`() {
        // `stopLoading()` on an already-idle WebView produces no finish at
        // all, leaving the flag armed. onPageStarted must clear it or the
        // NEXT genuine success would be swallowed — which would look
        // exactly like the bug this fixes, in the opposite direction.
        val c = ClientOutcomeModel()
        c.markNextFinishAborted()      // …and no finish ever arrives
        c.onPageStarted()
        assertTrue("a stale abort mark swallowed a real success", c.onPageFinished())
    }

    @Test
    fun `an aborted load that also errored stays failed`() {
        // Both disqualifiers can be true at once (the abort raced a real
        // net error). The verdict must be a single failure, and the abort
        // flag must not "consume" the error and let a repeat finish pass.
        val c = ClientOutcomeModel()
        c.onPageStarted()
        c.onMainFrameError()
        c.markNextFinishAborted()
        assertFalse(c.onPageFinished())
        assertFalse("the tracker's failure was lost when the abort flag cleared", c.onPageFinished())
    }
}
