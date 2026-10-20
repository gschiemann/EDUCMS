package com.educms.player.display

import com.educms.player.media.SoloVideoLayer
import org.junit.Assert.*
import org.junit.Test

class EmergencyPaintPolicyTest {
    private fun episode() = EmergencyPaintPolicy.Episode("live-challenge", 1_000_000, 100)

    @Test fun `no paint dispatches all recovery stages in order once and reaches its bound`() {
        var e = episode()
        val calls = mutableListOf<String>()
        assertNull(EmergencyPaintPolicy.next(e, 3_099))
        for (now in listOf(3_100L, 3_350L, 4_100L, 7_100L)) {
            val step = EmergencyPaintPolicy.next(e, now)!!
            // Production persists the consumed attempt before dispatch; the same policy drives both.
            e = EmergencyPaintPolicy.event(e, step, now, "started")
            EmergencyPaintPolicy.dispatch(step, { calls.add("hold-and-remove") }, { calls.add("visible-opaque-front") },
                { calls.add("reload") }, { calls.add("relaunch") })
            assertNull(EmergencyPaintPolicy.next(e, now))
        }
        assertEquals(listOf("hold-and-remove", "visible-opaque-front", "reload", "relaunch"), calls)
        assertFalse(EmergencyPaintPolicy.finished(e, 10_099))
        assertTrue(EmergencyPaintPolicy.finished(e, 10_100))
        repeat(100) { assertNull(EmergencyPaintPolicy.next(e, 100_000L + it)) }
        assertEquals(4, e.step)
    }

    @Test fun `registry wake throws but immediate drawing still proceeds`() {
        val calls = mutableListOf<String>()
        EmergencyPaintPolicy.bestEffort(wake = { calls.add("registry-wake"); error("OEM wake failure") },
            draw = { calls.add("draw-alert") }, failed = { calls.add("wake-failed") })
        assertEquals(listOf("registry-wake", "wake-failed", "draw-alert"), calls)
    }

    @Test fun `native presenting is retired before a visible overlay can satisfy proof`() {
        val native = SoloVideoLayer(SoloVideoLayer.Mode.DYNAMIC_ABOVE)
        native.request(true, true)
        native.promote(true, true, false, true)
        native.revealRequested(1_000)
        assertTrue(native.confirm(1_001, true, true, false, true))
        assertEquals(SoloVideoLayer.Phase.ABOVE_WINDOW, native.phase)
        val e = episode()
        fun accept() = EmergencyPaintPolicy.accepts(e, e.challenge, "em:weather", "document-a", 2,
            visible = true, interactive = true, foreground = true, nativeClear = native.phase == SoloVideoLayer.Phase.RETIRED)
        assertFalse(accept())
        EmergencyPaintPolicy.dispatch(1, { native.retire() }, {}, {}, {})
        assertTrue(accept())
        // A queued native callback cannot reclaim the window after the alert wins.
        assertFalse(native.confirm(1_002, true, true, true, true))
    }

    @Test fun `normal liveness wrong challenge or hidden page cannot certify paint`() {
        val e = episode()
        assertFalse(EmergencyPaintPolicy.accepts(e, null, null, null, null, true, true, true))
        assertFalse(EmergencyPaintPolicy.accepts(e, "old-challenge", "em:weather", "document-a", 2, true, true, true))
        assertFalse(EmergencyPaintPolicy.accepts(e, e.challenge, "em:weather", "document-a", 1, true, true, true))
        for (missing in 0..2) assertFalse(EmergencyPaintPolicy.accepts(e, e.challenge, "em:weather", "document-a", 2,
            missing != 0, missing != 1, missing != 2))
        assertTrue(EmergencyPaintPolicy.accepts(e, e.challenge, "em:weather", "document-a", 2, true, true, true))
        assertNull(EmergencyPaintPolicy.next(e.copy(status = "painted"), 100_000))
    }

    @Test fun `document replacement invalidates old proof without replenishing consumed attempts`() {
        val old = EmergencyPaintPolicy.event(episode(), 3, 4_100, "started")
        val fresh = EmergencyPaintPolicy.documentStarted(old, "new-document-challenge", 4_101)
        assertEquals(old.step, fresh.step)
        assertEquals(old.startedAtMs, fresh.startedAtMs)
        assertFalse(EmergencyPaintPolicy.accepts(fresh, old.challenge, "em:weather", "document-a", 2, true, true, true))
        assertNull(EmergencyPaintPolicy.next(fresh, 7_099))
        assertEquals(4, EmergencyPaintPolicy.next(fresh, 7_100))
        val painted = fresh.copy(status = "painted", paintedAtMs = 5_000)
        val replaced = EmergencyPaintPolicy.documentStarted(painted, "another-document", 20_000)
        assertNull(replaced.paintedAtMs)
        assertEquals(3, replaced.step)
        assertEquals(20_000L, replaced.startedAtMs)
    }

    @Test fun `repeat announcement retains deadline but a different alert invalidates the old receipt`() {
        val old = episode().copy(identity = "alert-a", status = "painted", step = 2, paintedAtMs = 1_000)
        assertSame(old, EmergencyPaintPolicy.announce(old, "alert-a", "unused", 2_000_000, 8_000))
        val fresh = EmergencyPaintPolicy.announce(old, "alert-b", "next-alert-challenge", 2_000_000, 8_000)
        assertEquals("pending", fresh.status)
        assertEquals(0, fresh.step)
        assertEquals(8_000L, fresh.startedAtMs)
        assertNull(fresh.paintedAtMs)
        assertFalse(EmergencyPaintPolicy.accepts(fresh, fresh.challenge, "alert-a", "document-a", 2, true, true, true))
        assertTrue(EmergencyPaintPolicy.accepts(fresh, fresh.challenge, "alert-b", "document-a", 2, true, true, true))
    }

    @Test fun `older watch waits until ordered ladder ends and durable budgets cannot replenish`() {
        val e = episode().copy(step = 4, status = "unconfirmed")
        assertFalse(EmergencyPaintPolicy.legacyAllowed(e, 10_099, launch = false))
        assertTrue(EmergencyPaintPolicy.legacyAllowed(e, 10_100, launch = false))
        assertFalse(EmergencyPaintPolicy.legacyAllowed(e.copy(step = 3), 50_000, launch = false))
        assertFalse(EmergencyPaintPolicy.legacyAllowed(e.copy(legacyReloads = 3), 50_000, launch = false))
        assertFalse(EmergencyPaintPolicy.legacyAllowed(e.copy(legacyLaunches = 6), 50_000, launch = true))
        val recreated = EmergencyPaintPolicy.documentStarted(e.copy(legacyReloads = 3, legacyLaunches = 6), "fresh", 20_000)
        assertFalse(EmergencyPaintPolicy.legacyAllowed(recreated, 100_000, launch = false))
        assertFalse(EmergencyPaintPolicy.legacyAllowed(recreated, 100_000, launch = true))
    }

    @Test fun `wire episode omits internal persistence fields and unknown optional values`() {
        val wire = EmergencyPaintRecovery.json(0, episode(), wire = true)
        assertEquals(setOf("face", "challenge", "heldAtMs", "step", "status", "events"), wire.keys().asSequence().toSet())
        val saved = EmergencyPaintRecovery.json(0, episode())
        assertTrue(saved.has("startedAtMs"))
        assertTrue(saved.has("legacyReloads"))
        assertTrue(saved.has("legacyLaunches"))
        assertFalse(wire.has("identity"))
        assertFalse(wire.has("documentId"))
    }
}
