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
}
