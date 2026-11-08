package com.educms.player.ota

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class CompanionTapPolicyTest {
    private val base = CompanionTapPolicy.Facts(
        stagedForCompanion = true, dialogAppeared = false, foreground = true,
        emergencyHeld = false, standbyActive = false, sinceDeclineMs = null, cardsShownThisProcess = 0,
    )

    @Test fun `a refused raise puts the card up`() = assertTrue(CompanionTapPolicy.shouldShowCard(base))

    @Test fun `never over an alert`() = assertFalse(CompanionTapPolicy.shouldShowCard(base.copy(emergencyHeld = true)))
    @Test fun `never in standby`() = assertFalse(CompanionTapPolicy.shouldShowCard(base.copy(standbyActive = true)))
    @Test fun `not when the dialog came up`() = assertFalse(CompanionTapPolicy.shouldShowCard(base.copy(dialogAppeared = true)))
    @Test fun `not when nothing is staged`() = assertFalse(CompanionTapPolicy.shouldShowCard(base.copy(stagedForCompanion = false)))
    @Test fun `not in the background`() = assertFalse(CompanionTapPolicy.shouldShowCard(base.copy(foreground = false)))

    @Test fun `a decline is respected for the cooldown then expires`() {
        assertFalse(CompanionTapPolicy.shouldShowCard(base.copy(sinceDeclineMs = 1_000L)))
        assertFalse(CompanionTapPolicy.shouldShowCard(base.copy(sinceDeclineMs = CompanionTapPolicy.DECLINE_COOLDOWN_MS - 1)))
        assertTrue(CompanionTapPolicy.shouldShowCard(base.copy(sinceDeclineMs = CompanionTapPolicy.DECLINE_COOLDOWN_MS)))
        // a clock that stepped backwards must not latch silence forever
        assertTrue(CompanionTapPolicy.shouldShowCard(base.copy(sinceDeclineMs = -5L)))
    }

    @Test fun `bounded per process`() {
        assertTrue(CompanionTapPolicy.shouldShowCard(base.copy(cardsShownThisProcess = 1)))
        assertFalse(CompanionTapPolicy.shouldShowCard(base.copy(cardsShownThisProcess = CompanionTapPolicy.MAX_CARDS_PER_PROCESS)))
    }

    @Test fun `report only while an upgrade is genuinely pending and no alert`() {
        assertTrue(CompanionTapPolicy.shouldReport(10129, 10024, false))
        assertTrue(CompanionTapPolicy.shouldReport(10129, null, false))
        assertFalse(CompanionTapPolicy.shouldReport(10129, 10129, false))
        assertFalse(CompanionTapPolicy.shouldReport(10024, 10129, false))
        assertFalse(CompanionTapPolicy.shouldReport(0, null, false))
        assertFalse(CompanionTapPolicy.shouldReport(10129, 10024, true))
    }

    @Test fun `report message names the companion and claims only a waiting tap`() {
        val m = CompanionTapPolicy.reportMessage("v1.1.29")
        assertTrue(m.startsWith(CompanionTapPolicy.REPORT_PREFIX))
        assertTrue(m.contains("waiting for an Install tap"))
        assertFalse(m.contains("fail", ignoreCase = true))
        assertEquals("Companion service update is waiting for an Install tap on the screen.", CompanionTapPolicy.reportMessage(null))
        // never starts with "Manager v": the server drops those as self-update noise
        assertFalse(m.startsWith("Manager v"))
    }
}
