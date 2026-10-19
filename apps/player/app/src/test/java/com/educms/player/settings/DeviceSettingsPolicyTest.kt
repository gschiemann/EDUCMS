package com.educms.player.settings

import com.educms.player.settings.DeviceSettingsPolicy.Ack
import com.educms.player.settings.DeviceSettingsPolicy.Conditions
import com.educms.player.settings.DeviceSettingsPolicy.Decision
import com.educms.player.settings.DeviceSettingsPolicy.Input
import com.educms.player.settings.DeviceSettingsPolicy.Outcome
import com.educms.player.settings.DeviceSettingsPolicy.Status
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * WHAT MAY BE APPLIED, AND WHEN — every rule of [DeviceSettingsPolicy] on a
 * virtual clock. The life-safety rule (nothing changes while an alert is
 * held) and the "persist before you write, bounded" rule have their own
 * cases; so does "nothing without a stored intent".
 */
class DeviceSettingsPolicyTest {

    private val boot = 7
    private val lit = Conditions(
        emergencyHeld = false,
        interactive = true,
        sinceWakeMs = null,
        processAgeMs = 10 * 60_000L,
        uptimeMs = 60 * 60_000L,
        blankedByUs = false,
        timeoutBlankActive = false,
    )
    private val brightness80 = DesiredItem(DeviceSettingKey.BRIGHTNESS, "r3", DesiredValue.IntValue(80))
    private val timeoutNever = DesiredItem(
        DeviceSettingKey.SCREEN_OFF_TIMEOUT, "r4", DesiredValue.IntValue(DeviceSettingDomains.TIMEOUT_NEVER),
    )
    private val wifiNoSecret = DesiredItem(
        DeviceSettingKey.WIFI, "r5", DesiredValue.WifiValue("Lobby", "wpa2", false, null),
    )
    private val wifiWithSecret = DesiredItem(
        DeviceSettingKey.WIFI, "r5", DesiredValue.WifiValue("Lobby", "wpa2", false, "correct horse"),
    )

    private fun input(
        item: DesiredItem = brightness80,
        capability: String = DeviceSettingCodes.OK,
        matches: Boolean? = false,
        previous: Ack? = null,
        conditions: Conditions = lit,
        now: Long = 5_000_000L,
        bootCount: Int = boot,
    ) = Input(item, capability, matches, previous, conditions, now, bootCount)

    private fun reported(d: Decision): Ack {
        assertTrue("expected Report, got $d", d is Decision.Report)
        return (d as Decision.Report).ack
    }

    private fun attempt(d: Decision): Ack {
        assertTrue("expected Apply, got $d", d is Decision.Apply)
        return (d as Decision.Apply).attempt
    }

    // ── the happy path ──────────────────────────────────────────────────

    @Test fun aNewValueOnALitSettledPanelIsAppliedAndTheAttemptIsCountedFirst() {
        val a = attempt(DeviceSettingsPolicy.decide(input()))
        assertEquals("r3", a.id)
        assertEquals(Status.PENDING, a.status)
        assertEquals(1, a.attempts)
        assertEquals(5_000_000L, a.lastAttemptElapsedMs)
        assertEquals(boot, a.boot)
    }

    @Test fun appliedMeansAndroidReadsItBackNotThatTheCallReturned() {
        val a = attempt(DeviceSettingsPolicy.decide(input()))
        val good = DeviceSettingsPolicy.afterApply(a, Outcome.Done, observedMatches = true, nowWallMs = 42L)
        assertEquals(Status.APPLIED, good.status)
        assertNull(good.why)
        assertEquals(42L, good.appliedAtWallMs)

        val ignored = DeviceSettingsPolicy.afterApply(a, Outcome.Done, observedMatches = false, nowWallMs = 42L)
        assertEquals(Status.PENDING, ignored.status)
        assertEquals(DeviceSettingCodes.NOT_TAKEN, ignored.why)

        val unreadable = DeviceSettingsPolicy.afterApply(a, Outcome.Done, observedMatches = null, nowWallMs = 42L)
        assertEquals(Status.APPLIED, unreadable.status)
        assertEquals(DeviceSettingCodes.UNVERIFIED, unreadable.why)
    }

    @Test fun aValueAlreadyInPlaceIsAppliedWithoutAWrite() {
        val ack = reported(DeviceSettingsPolicy.decide(input(matches = true)))
        assertEquals(Status.APPLIED, ack.status)
        assertEquals(DeviceSettingCodes.ALREADY_SET, ack.why)
        assertEquals(0, ack.attempts)
        // …even when this unit could not write it, and even during an alert:
        // reading is always safe, and the statement is true.
        assertEquals(
            Status.APPLIED,
            reported(DeviceSettingsPolicy.decide(input(matches = true, capability = DeviceSettingCodes.NO_WRITE_SETTINGS))).status,
        )
        assertEquals(
            Status.APPLIED,
            reported(DeviceSettingsPolicy.decide(input(matches = true, conditions = lit.copy(emergencyHeld = true)))).status,
        )
    }

    // ── ⚠️ life safety and the panel's state ────────────────────────────

    @Test fun nothingIsWrittenWhileAnEmergencyIsHeld() {
        for (item in listOf(brightness80, timeoutNever, wifiWithSecret)) {
            val ack = reported(DeviceSettingsPolicy.decide(input(item = item, conditions = lit.copy(emergencyHeld = true))))
            assertEquals(Status.WAITING, ack.status)
            assertEquals(DeviceSettingCodes.WAIT_EMERGENCY, ack.why)
            assertEquals("waiting spends no attempt", 0, ack.attempts)
        }
    }

    @Test fun nothingIsWrittenWhileThePanelIsOffOrItsPowerStateIsUnknown() {
        for (interactive in listOf(false, null)) {
            val ack = reported(DeviceSettingsPolicy.decide(input(conditions = lit.copy(interactive = interactive))))
            assertEquals(Status.WAITING, ack.status)
            assertEquals(DeviceSettingCodes.WAIT_SCREEN_OFF, ack.why)
        }
    }

    @Test fun nothingIsWrittenWhileWeHoldThePanelBlanked() {
        val ack = reported(DeviceSettingsPolicy.decide(input(conditions = lit.copy(blankedByUs = true))))
        assertEquals(DeviceSettingCodes.WAIT_BLANKED, ack.why)
    }

    @Test fun theTimeoutWaitsWhileTheScreenOffBlankOwnsItButOtherSettingsDoNot() {
        val blank = lit.copy(timeoutBlankActive = true)
        assertEquals(
            DeviceSettingCodes.WAIT_BLANKED,
            reported(DeviceSettingsPolicy.decide(input(item = timeoutNever, conditions = blank))).why,
        )
        attempt(DeviceSettingsPolicy.decide(input(item = brightness80, conditions = blank)))
    }

    @Test fun nothingIsWrittenUntilThePanelHasBeenOnForAMinuteAndUpForTwo() {
        val cases = listOf(
            lit.copy(sinceWakeMs = 10_000L),
            lit.copy(processAgeMs = 30_000L),
            lit.copy(uptimeMs = 90_000L),
        )
        for (c in cases) {
            assertEquals(c.toString(), DeviceSettingCodes.WAIT_SETTLING, reported(DeviceSettingsPolicy.decide(input(conditions = c))).why)
        }
        attempt(DeviceSettingsPolicy.decide(input(conditions = lit.copy(sinceWakeMs = 61_000L))))
    }

    // ── capability ───────────────────────────────────────────────────────

    @Test fun whatTheUnitCannotSetIsUnsupportedWithTheProbesReasonAndCostsNothing() {
        for (why in DeviceSettingCodes.CAPABILITY_REASONS) {
            val ack = reported(DeviceSettingsPolicy.decide(input(capability = why)))
            assertEquals(Status.UNSUPPORTED, ack.status)
            assertEquals(why, ack.why)
            assertEquals(0, ack.attempts)
        }
    }

    @Test fun aGrantMadeLaterIsPickedUpOnTheNextHeartbeat() {
        val unsupported = reported(DeviceSettingsPolicy.decide(input(capability = DeviceSettingCodes.NO_WRITE_SETTINGS)))
        val a = attempt(DeviceSettingsPolicy.decide(input(previous = unsupported)))
        assertEquals(1, a.attempts)
    }

    // ── bounded, persisted, identity-keyed ──────────────────────────────

    @Test fun attemptsAreBoundedSpacedAndSurviveACrashBetweenPersistAndWrite() {
        var now = 1_000_000L
        var prev: Ack? = null
        for (n in 1..DeviceSettingsPolicy.MAX_ATTEMPTS) {
            val a = attempt(DeviceSettingsPolicy.decide(input(previous = prev, now = now)))
            assertEquals(n, a.attempts)
            // Too soon: the next heartbeat inside the gap does not retry —
            // and once the last attempt is on disk, a crash before its
            // outcome was recorded reads as spent, never as a fourth try.
            val early = reported(DeviceSettingsPolicy.decide(input(previous = a, now = now + 10_000L)))
            assertEquals(
                if (n < DeviceSettingsPolicy.MAX_ATTEMPTS) Status.PENDING else Status.FAILED,
                early.status,
            )
            // A crash right after the persisted attempt: `a` is what is on
            // disk. The write never "happened" — the budget is still spent.
            prev = DeviceSettingsPolicy.afterApply(a, Outcome.Done, observedMatches = false, nowWallMs = 1L)
            now += DeviceSettingsPolicy.RETRY_GAP_MS
        }
        assertEquals(Status.FAILED, prev!!.status)
        assertEquals(DeviceSettingCodes.NOT_TAKEN, prev.why)
        // FAILED is settled for this boot.
        assertEquals(prev, reported(DeviceSettingsPolicy.decide(input(previous = prev, now = now + 999_999L))))
        // A crash AFTER the third persisted attempt: still never a fourth.
        val crashed = prev.copy(status = Status.PENDING)
        assertEquals(Status.FAILED, reported(DeviceSettingsPolicy.decide(input(previous = crashed, now = now + 999_999L))).status)
    }

    @Test fun aNewIdentityStartsAFreshBudgetAndAnAppliedIdentityIsLeftAlone() {
        val done = Ack("r3", Status.APPLIED, attempts = 1, lastAttemptElapsedMs = 10L, boot = boot, appliedAtWallMs = 9L)
        // Same identity, same boot: nothing happens, whatever Android reads.
        assertEquals(done, reported(DeviceSettingsPolicy.decide(input(previous = done, matches = false))))
        // The operator changed it (r9): applied again from attempt 1.
        val next = attempt(DeviceSettingsPolicy.decide(input(item = brightness80.copy(id = "r9"), previous = done)))
        assertEquals("r9", next.id)
        assertEquals(1, next.attempts)
    }

    @Test fun afterARebootADriftedSettingIsSetAgainAndAnIntactOneIsNot() {
        val done = Ack("r3", Status.APPLIED, attempts = 2, lastAttemptElapsedMs = 9_000_000L, boot = boot)
        val intact = reported(DeviceSettingsPolicy.decide(input(previous = done, matches = true, bootCount = boot + 1, now = 50L)))
        assertEquals(Status.APPLIED, intact.status)
        assertEquals(boot + 1, intact.boot)
        val unreadable = reported(DeviceSettingsPolicy.decide(input(previous = done, matches = null, bootCount = boot + 1)))
        assertEquals(Status.APPLIED, unreadable.status)

        val again = attempt(DeviceSettingsPolicy.decide(input(previous = done, matches = false, bootCount = boot + 1, now = 50L)))
        assertEquals("a reboot starts a fresh, still bounded, budget", 1, again.attempts)
        assertEquals(boot + 1, again.boot)
    }

    @Test fun wifiIsNeverReAppliedAfterARebootAndItsPassphraseIsAskedForNotStored() {
        val done = Ack("r5", Status.APPLIED, attempts = 1, boot = boot)
        assertEquals(
            Status.APPLIED,
            reported(DeviceSettingsPolicy.decide(input(item = wifiNoSecret, previous = done, matches = false, bootCount = boot + 1))).status,
        )
        val ask = reported(DeviceSettingsPolicy.decide(input(item = wifiNoSecret, matches = null)))
        assertEquals(Status.PENDING, ask.status)
        assertEquals(DeviceSettingCodes.NEEDS_SECRET, ask.why)
        assertTrue(DeviceSettingsPolicy.needsSecret(listOf(ask)))
        // …but only when it could be applied right now: a dark panel does not ask.
        val dark = reported(DeviceSettingsPolicy.decide(input(item = wifiNoSecret, matches = null, conditions = lit.copy(interactive = false))))
        assertFalse(DeviceSettingsPolicy.needsSecret(listOf(dark)))
        // With the passphrase in hand it is applied.
        attempt(DeviceSettingsPolicy.decide(input(item = wifiWithSecret, matches = null, previous = ask)))
    }

    @Test fun anInvalidValueIsRefusedNotTrustedAndNeverRetried() {
        val bad = listOf(
            DesiredItem(DeviceSettingKey.BRIGHTNESS, "r1", DesiredValue.IntValue(0)),
            DesiredItem(DeviceSettingKey.BRIGHTNESS, "r1", DesiredValue.IntValue(101)),
            DesiredItem(DeviceSettingKey.VOLUME, "r1", DesiredValue.BoolValue(true)),
            DesiredItem(DeviceSettingKey.SCREEN_OFF_TIMEOUT, "r1", DesiredValue.IntValue(15_000)),
            DesiredItem(DeviceSettingKey.NTP_SERVER, "r1", DesiredValue.TextValue("pool.ntp.org; reboot")),
            DesiredItem(DeviceSettingKey.WIFI, "r1", DesiredValue.WifiValue("Lobby", "wep", false, "12345678")),
            DesiredItem(DeviceSettingKey.AUTO_TIME, "r1", DesiredValue.Invalid),
        )
        for (item in bad) {
            val ack = reported(DeviceSettingsPolicy.decide(input(item = item)))
            assertEquals(item.toString(), Status.FAILED, ack.status)
            assertEquals(DeviceSettingCodes.INVALID_VALUE, ack.why)
            val afterReboot = reported(DeviceSettingsPolicy.decide(input(item = item, previous = ack, bootCount = boot + 5)))
            assertEquals(Status.FAILED, afterReboot.status)
        }
    }

    @Test fun anErrorTheUnitCannotFixIsTerminalAndAnUnknownBootCountNeverResetsTheBudget() {
        val a = attempt(DeviceSettingsPolicy.decide(input(item = wifiWithSecret, matches = null)))
        val rejected = DeviceSettingsPolicy.afterApply(a, Outcome.Error(DeviceSettingCodes.WIFI_REJECTED), null, 1L)
        assertEquals(Status.FAILED, rejected.status)
        assertEquals(
            Status.FAILED,
            reported(DeviceSettingsPolicy.decide(input(item = wifiWithSecret, previous = rejected, matches = null, bootCount = boot + 1))).status,
        )
        // BOOT_COUNT unreadable on both sides: the same boot, never "every
        // heartbeat is a new boot" (which would retry forever).
        var prev: Ack? = null
        var now = 0L
        repeat(10) {
            val d = DeviceSettingsPolicy.decide(input(previous = prev, now = now, bootCount = -1))
            prev = if (d is Decision.Apply) {
                DeviceSettingsPolicy.afterApply(d.attempt, Outcome.Error(DeviceSettingCodes.WRITE_REFUSED), null, 1L)
            } else {
                (d as Decision.Report).ack
            }
            now += DeviceSettingsPolicy.RETRY_GAP_MS
        }
        assertEquals(Status.FAILED, prev!!.status)
        assertEquals(DeviceSettingsPolicy.MAX_ATTEMPTS, prev!!.attempts)
    }

    @Test fun aRetryableErrorWaitsForTheGapAndKeepsItsReason() {
        val a = attempt(DeviceSettingsPolicy.decide(input(now = 100L)))
        val refused = DeviceSettingsPolicy.afterApply(a, Outcome.Error(DeviceSettingCodes.WRITE_REFUSED), null, 1L)
        assertEquals(Status.PENDING, refused.status)
        assertEquals(DeviceSettingCodes.WRITE_REFUSED, refused.why)
        assertEquals(DeviceSettingCodes.WRITE_REFUSED, reported(DeviceSettingsPolicy.decide(input(previous = refused, now = 200L))).why)
        assertEquals(2, attempt(DeviceSettingsPolicy.decide(input(previous = refused, now = 100L + DeviceSettingsPolicy.RETRY_GAP_MS))).attempts)
    }
}
