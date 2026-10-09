package com.educms.player.heartbeat

import org.junit.Assert.*
import org.junit.Test

class NativePowerOnPolicyTest {
    private val command = "2026-10-09T00:20:00.123Z"

    @Test fun noCommandNeverWakesThePanel() {
        for (value in listOf(null, "", "invalid", "null")) {
            assertFalse(NativePowerOnPolicy.mayApply(value, NativePowerOnPolicy.Memory(), 1_000_000L))
        }
    }

    @Test fun aFreshExplicitCommandWorksWithoutAnyPageOrWallClock() {
        assertTrue(NativePowerOnPolicy.mayApply(command, NativePowerOnPolicy.Memory(), 0L))
    }

    @Test fun acknowledgedIdentityCannotWakeAgainEvenAfterProcessRestart() {
        val saved = NativePowerOnPolicy.Memory(command, 1, 100L, command)
        assertFalse(NativePowerOnPolicy.mayApply(command, saved, 10_000_000L))
        assertFalse(NativePowerOnPolicy.mayApply(command, saved, 0L))
        assertTrue(NativePowerOnPolicy.mayApply("2026-10-09T00:21:00.123Z", saved, 10_000_000L))
    }

    @Test fun failedOrInterruptedWakesHaveABoundedPersistedRetryBudget() {
        var saved = NativePowerOnPolicy.Memory()
        for (n in 1..3) {
            val now = n * 60_000L
            assertTrue(NativePowerOnPolicy.mayApply(command, saved, now))
            saved = NativePowerOnPolicy.beforeApply(command, saved, now)
            assertEquals(n, saved.attempts)
            assertFalse(NativePowerOnPolicy.mayApply(command, saved, now + 100L))
        }
        assertFalse(NativePowerOnPolicy.mayApply(command, saved, 10_000_000L))
        assertFalse(NativePowerOnPolicy.mayApply(command, saved, 0L))
    }

    @Test fun anUnacknowledgedAttemptCanRetryAfterARebootWithinItsBudget() {
        val saved = NativePowerOnPolicy.Memory(command, 1, 100_000L)
        assertTrue(NativePowerOnPolicy.mayApply(command, saved, 100L))
    }

    @Test fun acknowledgementRequiresAnAppliedIdentityAndBothObservedStates() {
        val saved = NativePowerOnPolicy.Memory(command, 1, 100L)
        assertTrue(NativePowerOnPolicy.mayAcknowledge(command, saved, true, true))
        assertFalse(NativePowerOnPolicy.mayAcknowledge(command, saved, false, true))
        assertFalse(NativePowerOnPolicy.mayAcknowledge(command, saved, null, true))
        assertFalse(NativePowerOnPolicy.mayAcknowledge(command, saved, true, false))
        assertFalse(NativePowerOnPolicy.mayAcknowledge(null, saved, true, true))
        assertFalse(NativePowerOnPolicy.mayAcknowledge("2026-10-09T00:21:00.123Z", saved, true, true))
        assertFalse(NativePowerOnPolicy.mayAcknowledge(command, NativePowerOnPolicy.Memory(), true, true))
        assertFalse(NativePowerOnPolicy.mayAcknowledge(command, saved.copy(acknowledged = command), true, true))
    }

    @Test fun aCompletedThirdAttemptCanStillAcknowledgeWithoutAnotherWake() {
        val saved = NativePowerOnPolicy.Memory(command, 3, 100L)
        assertFalse(NativePowerOnPolicy.mayApply(command, saved, 10_000_000L))
        assertTrue(NativePowerOnPolicy.mayAcknowledge(command, saved, true, true))
    }

    @Test fun aNewPhysicalOffCancelsAnOlderPowerOnEvenAcrossReboot() {
        val priorOff = "5:50000:1791505277776"
        val saved = NativePowerOnPolicy.beforeApply(command, NativePowerOnPolicy.Memory(), 60_000L, priorOff)
        assertFalse(NativePowerOnPolicy.supersededByStandby(command, saved, priorOff))
        assertFalse(NativePowerOnPolicy.supersededByStandby(command, saved, null))
        assertTrue(NativePowerOnPolicy.supersededByStandby(command, saved, "5:70000:1791505297776"))
        assertTrue(NativePowerOnPolicy.supersededByStandby(command, saved, "6:100:1791505357776"))
        assertFalse(NativePowerOnPolicy.supersededByStandby("2026-10-09T00:21:00.123Z", saved, "6:100:1791505357776"))
        val cancelled = saved.copy(suppressed = command)
        assertFalse(NativePowerOnPolicy.mayApply(command, cancelled, 10_000_000L))
        assertFalse(NativePowerOnPolicy.mayAcknowledge(command, cancelled, true, true))
        assertTrue(NativePowerOnPolicy.mayApply("2026-10-09T00:21:00.123Z", cancelled, 10_000_000L))
    }
}
