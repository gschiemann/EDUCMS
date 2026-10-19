package com.educms.player.media

import org.junit.Assert.*
import org.junit.Test

/**
 * THE AUTOMATIC 60 Hz REQUEST (1.1.43): decided from the panel's own facts,
 * once per process, refused by a standing 24 h block — always: no manifest
 * key walks past it — and PROVEN by the safety net — the mode must change and
 * frames must keep flowing — or reverted and blocked. Pure: no window is ever
 * created here; a face number no other test uses keeps the process-wide state
 * private.
 */
class Prefer60HzPolicyTest {
    private val uhd30 = DisplayModeFacts(1, 3840, 2160, 30.00f)
    private val uhd60 = DisplayModeFacts(6, 3840, 2160, 60.00f)
    private val fhd60 = DisplayModeFacts(7, 1920, 1080, 60.00f)
    private val offers60 = listOf(uhd30, uhd60, fhd60)
    private val only30 = listOf(uhd30)

    @Test fun autoAsksNothingWhereThereIsNothingToAskAndWantsAModeOnlyWhereOneIsOffered() {
        val face = 11
        // M43 / L55VEC: one Android mode at 30 Hz — nothing to ask, nothing remembered, no window touched.
        assertEquals(Pair(0, PreferredDisplayMode.RESULT_NO_60HZ_MODE), PreferredDisplayMode.request(face, null, uhd30, only30, 0L, 1_000L))
        assertNull(PreferredDisplayMode.attempted(face)); assertEquals(0, PreferredDisplayMode.applied(face)); assertNull(PreferredDisplayMode.pending)
        // The rk3328 unit: already 60 Hz.
        assertEquals(Pair(0, PreferredDisplayMode.RESULT_ALREADY_60HZ), PreferredDisplayMode.request(face, null, uhd60, offers60, 0L, 1_000L))
        // A panel that offers 3840x2160@60: the request is wanted, but there is no window in a JVM test.
        assertEquals(Pair(0, PreferredDisplayMode.RESULT_NO_WINDOW), PreferredDisplayMode.request(face, null, uhd30, offers60, 0L, 1_000L))
        assertNull("no request was made, so nothing is remembered: the next boundary may ask", PreferredDisplayMode.attempted(face))
        assertNull(PreferredDisplayMode.pending)
    }

    @Test fun aStandingBlockRefusesTheRequestAndNothingWalksPastIt() {
        val face = 12
        val now = 5_000_000L
        val until = now + PreferredDisplayMode.BLOCK_MS
        assertEquals(Pair(0, PreferredDisplayMode.RESULT_BLOCKED), PreferredDisplayMode.request(face, null, uhd30, offers60, until, now))
        assertNull(PreferredDisplayMode.attempted(face))
        // The block is checked AFTER "is there anything to ask": a blocked unit with no 60 Hz mode still says so.
        assertEquals(Pair(0, PreferredDisplayMode.RESULT_NO_60HZ_MODE), PreferredDisplayMode.request(face, null, uhd30, only30, until, now))
        // An expired block is no block.
        assertEquals(Pair(0, PreferredDisplayMode.RESULT_NO_WINDOW), PreferredDisplayMode.request(face, null, uhd30, offers60, until, until + 1L))
        // The request takes no mode: a manifest key can only switch it off (the caller withdraws), never force it
        // past the block. The 1.1.42 call shape (no block) still asks — to the window, which a JVM test has not.
        assertEquals(Pair(0, PreferredDisplayMode.RESULT_NO_WINDOW), PreferredDisplayMode.request(face, null, uhd30, offers60))
        assertEquals(listOf(Prefer60Hz.OFF, Prefer60Hz.AUTO), Prefer60Hz.values().toList())
    }

    @Test fun theSafetyNetVerdictNeedsTheRequestedModeAndARecentFrame() {
        val p = PreferredDisplayMode.Pending(face = 13, modeId = 6, fromModeId = 1, atMs = 1_000L)
        val now = 20_000_000_000L
        // The panel runs the mode asked for and a frame came 10 ms ago: proven so far (null = no revert).
        assertNull(PreferredDisplayMode.verdict(p, uhd60, now - 10_000_000L, now))
        assertNull(PreferredDisplayMode.verdict(p, uhd60, now - PreferredDisplayMode.FRAME_RECENT_NS, now))
        // Still on the old mode, or on some other mode, or the mode cannot be read: the switch never happened.
        assertEquals(PreferredDisplayMode.RESULT_REVERTED_NO_SWITCH, PreferredDisplayMode.verdict(p, uhd30, now - 10_000_000L, now))
        assertEquals(PreferredDisplayMode.RESULT_REVERTED_NO_SWITCH, PreferredDisplayMode.verdict(p, fhd60, now - 10_000_000L, now))
        assertEquals(PreferredDisplayMode.RESULT_REVERTED_NO_SWITCH, PreferredDisplayMode.verdict(p, null, now - 10_000_000L, now))
        // The mode changed but the display produced no frame within the window, or none recently: no frames.
        assertEquals(PreferredDisplayMode.RESULT_REVERTED_NO_FRAMES, PreferredDisplayMode.verdict(p, uhd60, 0L, now))
        assertEquals(PreferredDisplayMode.RESULT_REVERTED_NO_FRAMES, PreferredDisplayMode.verdict(p, uhd60, now - PreferredDisplayMode.FRAME_RECENT_NS - 1L, now))
        // "No switch" is judged before "no frames": a panel that ignored the request is never blamed for frames.
        assertEquals(PreferredDisplayMode.RESULT_REVERTED_NO_SWITCH, PreferredDisplayMode.verdict(p, uhd30, 0L, now))
    }

    @Test fun confirmAbandonAndRevertKeepOneRequestPerProcessAndEveryCodeIsAStableOne() {
        val face = 14
        // Nothing pending: confirm and abandon are no-ops.
        assertFalse(PreferredDisplayMode.confirm(face))
        PreferredDisplayMode.abandon(face)
        assertNull(PreferredDisplayMode.pending)
        // A revert with no window: the verdict is remembered for the process, so the next boundary repeats it
        // (once per process) instead of asking again; the window result says the write could not be made.
        assertEquals(PreferredDisplayMode.RESULT_FAILED, PreferredDisplayMode.revert(face, null, PreferredDisplayMode.RESULT_REVERTED_NO_FRAMES))
        assertEquals(PreferredDisplayMode.RESULT_REVERTED_NO_FRAMES, PreferredDisplayMode.attempted(face))
        assertEquals(0, PreferredDisplayMode.applied(face))
        assertEquals(Pair(0, PreferredDisplayMode.RESULT_REVERTED_NO_FRAMES), PreferredDisplayMode.request(face, null, uhd30, offers60, 0L, 1L))
        assertEquals("once per process, block or not", Pair(0, PreferredDisplayMode.RESULT_REVERTED_NO_FRAMES), PreferredDisplayMode.request(face, null, uhd30, offers60))
        // Another face is its own request.
        assertEquals(Pair(0, PreferredDisplayMode.RESULT_NO_WINDOW), PreferredDisplayMode.request(face + 1, null, uhd30, offers60, 0L, 1L))
        // The kill switch with nothing applied withdraws nothing.
        assertNull(PreferredDisplayMode.withdraw(face, null))
        for (c in PreferredDisplayMode.RESULTS) assertTrue(c, Regex("^[a-z0-9-]{1,64}$").matches(c))
        assertTrue(PreferredDisplayMode.RESULTS.containsAll(listOf("applied", "kept", "already-60hz", "no-60hz-mode", "no-window",
            "other-session", "failed", "reverted", "blocked", "reverted-no-switch", "reverted-no-frames", "emergency-held")))
        assertEquals(24L * 60L * 60L * 1000L, PreferredDisplayMode.BLOCK_MS)
        assertEquals(10_000L, PreferredDisplayMode.CONFIRM_WINDOW_MS)
        // The block store's keys are stable names (the lead reads them with `adb shell` on a test unit).
        assertEquals("native_video_display", Prefer60HzBlock.PREFS)
        assertEquals("prefer60hz.blockedUntil", Prefer60HzBlock.KEY_UNTIL)
    }
}
