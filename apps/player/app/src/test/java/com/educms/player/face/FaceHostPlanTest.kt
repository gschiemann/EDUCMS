package com.educms.player.face

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The decisions FaceHostController carries out — the four defects the 1.1.18
 * verifiers found all lived in the one file with no behavioural test.
 */
class FaceHostPlanTest {

    private fun panel(id: Int, presentation: Boolean = true, private_: Boolean = false) = FaceDisplay(
        displayId = id,
        name = "display $id",
        widthPx = 1920,
        heightPx = 1080,
        isPresentation = presentation,
        isPrivate = private_,
        stateOn = true,
    )

    private val builtIn = panel(0, presentation = false)

    @Test
    fun `a box with no second panel hosts nothing and says why`() {
        val plan = FaceHostPlan.reconcile(listOf(builtIn), listOf(1), emptyMap())
        assertTrue(plan.attach.isEmpty())
        assertEquals(
            mapOf(1 to FaceDisplayMap.shortfallReason(listOf(builtIn))),
            FaceHostPlan.shortfall(listOf(builtIn), listOf(1), emptyMap()),
        )
    }

    @Test
    fun `the back side attaches to the eligible panel`() {
        val plan = FaceHostPlan.reconcile(listOf(builtIn, panel(1)), listOf(1), emptyMap())
        assertEquals(listOf(FaceHostPlan.Attach(1, 1)), plan.attach)
        assertTrue(plan.detach.isEmpty())
    }

    @Test
    fun `a face already on the right panel is left alone - no cold boot for a touched cable`() {
        val plan = FaceHostPlan.reconcile(listOf(builtIn, panel(1)), listOf(1), mapOf(1 to 1))
        assertTrue(plan.attach.isEmpty())
        assertTrue(plan.detach.isEmpty())
    }

    @Test
    fun `THE DARK-FOREVER BUG - HDMI re-enumerates and the face follows its panel`() {
        // display 1 → display 2. The first cut kept "face 1 is hosted", so the
        // detach never fired, the attach was skipped, and every re-sync was a
        // no-op while the pane sat dark.
        val plan = FaceHostPlan.reconcile(listOf(builtIn, panel(2)), listOf(1), mapOf(1 to 1))
        assertEquals(listOf(1), plan.detach.map { it.face })
        assertTrue(plan.detach[0].why.contains("moved"))
        assertEquals(listOf(FaceHostPlan.Attach(1, 2)), plan.attach)
    }

    @Test
    fun `an unplugged panel detaches the face and reports the shortfall`() {
        val plan = FaceHostPlan.reconcile(listOf(builtIn), listOf(1), mapOf(1 to 1))
        assertEquals(listOf(1), plan.detach.map { it.face })
        assertTrue(plan.attach.isEmpty())
        assertEquals(setOf(1), FaceHostPlan.shortfall(listOf(builtIn), listOf(1), emptyMap()).keys)
    }

    @Test
    fun `a face that is no longer requested is detached even though its panel is fine`() {
        val plan = FaceHostPlan.reconcile(listOf(builtIn, panel(1)), emptyList(), mapOf(1 to 1))
        assertEquals(listOf(FaceHostPlan.Detach(1, "no longer requested")), plan.detach)
        assertTrue(plan.attach.isEmpty())
    }

    @Test
    fun `NEVER SILENCE - a panel that exists but could not be hosted is a named shortfall`() {
        // The rk3288 two-WebView OOM lands here: the panel is eligible, attach
        // threw, so the face is unbound. The first cut reported shortfall = [].
        val displays = listOf(builtIn, panel(1))
        val shortfall = FaceHostPlan.shortfall(displays, listOf(1), emptyMap())
        assertEquals(mapOf(1 to FaceHostPlan.REASON_HOST_FAILED), shortfall)
        assertEquals(FaceHostPlan.REASON_HOST_FAILED, FaceHostPlan.summaryReason(shortfall))
        // …and the plan keeps trying on the next sync.
        assertEquals(listOf(FaceHostPlan.Attach(1, 1)), FaceHostPlan.reconcile(displays, listOf(1), emptyMap()).attach)
    }

    @Test
    fun `a hosted face is never reported as short`() {
        val displays = listOf(builtIn, panel(1))
        assertTrue(FaceHostPlan.shortfall(displays, listOf(1), mapOf(1 to 1)).isEmpty())
        assertNull(FaceHostPlan.summaryReason(emptyMap()))
    }

    @Test
    fun `a private virtual display is never a face`() {
        // A screen recorder or a vendor mirror sets FLAG_PRIVATE.
        val displays = listOf(builtIn, panel(1, private_ = true))
        assertTrue(FaceHostPlan.reconcile(displays, listOf(1), emptyMap()).attach.isEmpty())
    }

    @Test
    fun `a host failure outranks a missing panel in the single summary reason`() {
        val mixed = mapOf(1 to FaceHostPlan.REASON_HOST_FAILED, 2 to FaceDisplayMap.REASON_FEWER_PANELS)
        assertEquals(FaceHostPlan.REASON_HOST_FAILED, FaceHostPlan.summaryReason(mixed))
    }
}
