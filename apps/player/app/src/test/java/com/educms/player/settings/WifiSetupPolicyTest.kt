package com.educms.player.settings

import android.net.wifi.WifiManager
import android.provider.Settings
import com.educms.player.settings.DeviceSettingsPolicy.Outcome
import com.educms.player.settings.DeviceSettingsPolicy.Status
import com.educms.player.settings.WifiSetupPolicy.Journal
import com.educms.player.settings.WifiSetupPolicy.NetKey
import com.educms.player.settings.WifiSetupPolicy.Proof
import com.educms.player.settings.WifiSetupPolicy.Route
import com.educms.player.settings.WifiSetupPolicy.SavedNetwork
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Wi-Fi on every Android class — the pure decisions: which mechanism on
 * which Android, what each answer means, and the never-strand rules of the
 * Android 9-and-older switch.
 */
class WifiSetupPolicyTest {

    private val wpa2 = DesiredValue.WifiValue("Lobby", "wpa2", false, "pass-for-tests")
    private val wpa3 = wpa2.copy(security = "wpa3")
    private val open = DesiredValue.WifiValue("Guest", "open", false, null)

    // ── the mechanism, by Android version (the fleet's classes) ─────────

    @Test fun androidNineAndOlderAlwaysSaveSilentlyWhatever_permanent_says() {
        for (sdk in listOf(24, 25, 26, 27, 28)) {
            assertEquals("sdk $sdk", Route.Legacy, WifiSetupPolicy.route(sdk, wpa2, "approved", dialogAvailable = false, wpa3Supported = false))
            assertEquals(Route.Legacy, WifiSetupPolicy.route(sdk, wpa2.copy(permanent = true), "approved", true, false))
            assertEquals(Route.Legacy, WifiSetupPolicy.route(sdk, open, "unknown", false, false))
        }
    }

    @Test fun wpa3IsRefusedWhereAndroidOrTheHardwareCannotJoinIt() {
        assertEquals(Route.Refuse(DeviceSettingCodes.WIFI_SECURITY), WifiSetupPolicy.route(25, wpa3, "approved", false, wpa3Supported = true))
        assertEquals(Route.Refuse(DeviceSettingCodes.WIFI_SECURITY), WifiSetupPolicy.route(30, wpa3, "unknown", true, wpa3Supported = false))
        assertEquals(Route.Suggest, WifiSetupPolicy.route(33, wpa3, "approved", true, wpa3Supported = true))
    }

    @Test fun androidTenAndUpSuggestByDefault() {
        for (sdk in listOf(29, 30, 31, 32, 33, 34)) {
            assertEquals("sdk $sdk", Route.Suggest, WifiSetupPolicy.route(sdk, wpa2, "unknown", dialogAvailable = sdk >= 30, wpa3Supported = true))
        }
    }

    @Test fun permanentUsesAndroidsSaveDialogOrSaysItCannot() {
        assertEquals(Route.Dialog, WifiSetupPolicy.route(30, wpa2.copy(permanent = true), "unknown", dialogAvailable = true, wpa3Supported = true))
        assertEquals(Route.Dialog, WifiSetupPolicy.route(34, wpa2.copy(permanent = true), "approved", true, true))
        // resolveActivity found nothing usable (or Android 10, which has no such dialog): fall back, say so.
        assertEquals(
            Route.Refuse(DeviceSettingCodes.WIFI_NO_DIALOG),
            WifiSetupPolicy.route(30, wpa2.copy(permanent = true), "unknown", dialogAvailable = false, wpa3Supported = true),
        )
        assertEquals(
            Route.Refuse(DeviceSettingCodes.WIFI_NO_DIALOG),
            WifiSetupPolicy.route(29, wpa2.copy(permanent = true), "unknown", dialogAvailable = false, wpa3Supported = true),
        )
    }

    @Test fun declinedSuggestionsCloseOnlyTheSuggestionPath() {
        assertEquals(Route.Dialog, WifiSetupPolicy.route(31, wpa2, "rejected", dialogAvailable = true, wpa3Supported = true))
        assertEquals(Route.Refuse(DeviceSettingCodes.WIFI_REJECTED), WifiSetupPolicy.route(31, wpa2, "rejected", false, true))
    }

    @Test fun whatAnAcceptedSuggestionMeansDependsOnWhatAndroidLetsVenueOsRead() {
        // Android 10 and 11 never say whether someone allowed it.
        assertEquals(Outcome.Landed(DeviceSettingCodes.WIFI_SUGGESTED), WifiSetupPolicy.suggestionLanded(29, "unknown"))
        assertEquals(Outcome.Landed(DeviceSettingCodes.WIFI_SUGGESTED), WifiSetupPolicy.suggestionLanded(30, "approved"))
        // Android 12+: allowed = saved; anything else waits for the one-time prompt.
        assertEquals(Outcome.Landed(DeviceSettingCodes.WIFI_SAVED), WifiSetupPolicy.suggestionLanded(31, "approved"))
        assertEquals(Outcome.Held(Status.WAITING, DeviceSettingCodes.WIFI_APPROVAL), WifiSetupPolicy.suggestionLanded(33, "pending"))
        assertEquals(Outcome.Held(Status.WAITING, DeviceSettingCodes.WIFI_APPROVAL), WifiSetupPolicy.suggestionLanded(34, "unknown"))
    }

    @Test fun everySuggestionStatusMapsToTheCodeTheDashboardShows() {
        assertNull(WifiSetupPolicy.suggestionRefusal(WifiManager.STATUS_NETWORK_SUGGESTIONS_SUCCESS))
        assertNull(WifiSetupPolicy.suggestionRefusal(WifiManager.STATUS_NETWORK_SUGGESTIONS_ERROR_ADD_DUPLICATE))
        assertEquals(DeviceSettingCodes.WIFI_REJECTED, WifiSetupPolicy.suggestionRefusal(WifiManager.STATUS_NETWORK_SUGGESTIONS_ERROR_APP_DISALLOWED))
        assertEquals(DeviceSettingCodes.WIFI_LIMIT, WifiSetupPolicy.suggestionRefusal(WifiManager.STATUS_NETWORK_SUGGESTIONS_ERROR_ADD_EXCEEDS_MAX_PER_APP))
        assertEquals(DeviceSettingCodes.WIFI_INVALID, WifiSetupPolicy.suggestionRefusal(WifiManager.STATUS_NETWORK_SUGGESTIONS_ERROR_ADD_INVALID))
        assertEquals(DeviceSettingCodes.WIFI_RESTRICTED, WifiSetupPolicy.suggestionRefusal(WifiManager.STATUS_NETWORK_SUGGESTIONS_ERROR_ADD_NOT_ALLOWED))
        assertEquals(DeviceSettingCodes.WIFI_RESTRICTED, WifiSetupPolicy.suggestionRefusal(WifiManager.STATUS_NETWORK_SUGGESTIONS_ERROR_RESTRICTED_BY_ADMIN))
        assertEquals(DeviceSettingCodes.WIFI_ERROR, WifiSetupPolicy.suggestionRefusal(WifiManager.STATUS_NETWORK_SUGGESTIONS_ERROR_INTERNAL))
        assertEquals(DeviceSettingCodes.WIFI_ERROR, WifiSetupPolicy.suggestionRefusal(99))
    }

    @Test fun olderSuggestionsGoOnlyWhereTheRemovalCannotDropTheScreen() {
        // 13+: LINGER keeps a connection in use.
        assertTrue(WifiSetupPolicy.mayRemoveOlderSuggestions(33, defaultIsWifi = true))
        // 10–12: removal disconnects at once and Android hides which network is in use.
        assertFalse(WifiSetupPolicy.mayRemoveOlderSuggestions(30, defaultIsWifi = true))
        assertFalse(WifiSetupPolicy.mayRemoveOlderSuggestions(31, defaultIsWifi = null))
        assertTrue(WifiSetupPolicy.mayRemoveOlderSuggestions(30, defaultIsWifi = false))
    }

    // ── Android's save dialog ────────────────────────────────────────────

    @Test fun theDialogsAnswerIsReadAsWhatThePersonDid() {
        assertEquals(DeviceSettingCodes.WIFI_SAVED, WifiSetupPolicy.dialogResult(true, listOf(Settings.ADD_WIFI_RESULT_SUCCESS), 9_000L))
        assertEquals(DeviceSettingCodes.WIFI_SAVED, WifiSetupPolicy.dialogResult(true, listOf(Settings.ADD_WIFI_RESULT_ALREADY_EXISTS), 9_000L))
        assertEquals(DeviceSettingCodes.WIFI_SAVED, WifiSetupPolicy.dialogResult(true, null, 9_000L))
        assertEquals(DeviceSettingCodes.WIFI_ERROR, WifiSetupPolicy.dialogResult(true, listOf(Settings.ADD_WIFI_RESULT_ADD_OR_UPDATE_FAILED), 9_000L))
        assertEquals(DeviceSettingCodes.WIFI_DECLINED, WifiSetupPolicy.dialogResult(false, null, 9_000L))
        // Back before anyone could read it: Android closed it itself.
        assertEquals(DeviceSettingCodes.WIFI_NO_DIALOG, WifiSetupPolicy.dialogResult(false, null, 300L))
    }

    @Test fun theCardIsForAPersonAndNeverOverAnAlert() {
        fun offer(
            held: Boolean = false,
            foreground: Boolean = true,
            interactive: Boolean = true,
            lockTask: Boolean = false,
            standby: Boolean = false,
            other: Boolean = false,
            cooldown: Long = 0L,
            expired: Boolean = false,
        ) = WifiSetupPolicy.mayOfferCard(true, expired, foreground, interactive, held, lockTask, standby, other, cooldown, 1_000L)
        assertTrue(offer())
        assertFalse("never over an alert", offer(held = true))
        assertFalse(offer(foreground = false))
        assertFalse(offer(interactive = false))
        assertFalse(offer(lockTask = true))
        assertFalse(offer(standby = true))
        assertFalse("never on top of another card", offer(other = true))
        assertFalse("Back cools it down", offer(cooldown = 5_000L))
        assertFalse(offer(expired = true))
        assertFalse(WifiSetupPolicy.keepCard(emergencyHeld = true, shownForMs = 1L))
        assertFalse(WifiSetupPolicy.keepCard(false, WifiSetupPolicy.CARD_WINDOW_MS))
        assertTrue(WifiSetupPolicy.keepCard(false, 1L))
        assertTrue(WifiSetupPolicy.dialogExpired(0L, WifiSetupPolicy.DIALOG_WINDOW_MS))
        assertFalse(WifiSetupPolicy.dialogExpired(10L, 20L))
        assertTrue("a clock that went backwards reads expired", WifiSetupPolicy.dialogExpired(20L, 10L))
    }

    @Test fun relaunchActorsKeepOffTheGlassOnlyWhileAPersonIsInTheDialogAndNeverDuringAnAlert() {
        assertTrue(WifiSetupPolicy.relaunchShouldYield(1_000L, answered = false, nowElapsedMs = 2_000L, emergencyHeld = false))
        assertFalse(WifiSetupPolicy.relaunchShouldYield(1_000L, answered = false, nowElapsedMs = 2_000L, emergencyHeld = true))
        assertFalse(WifiSetupPolicy.relaunchShouldYield(1_000L, answered = true, nowElapsedMs = 2_000L, emergencyHeld = false))
        assertFalse(WifiSetupPolicy.relaunchShouldYield(1_000L, false, 1_000L + WifiSetupPolicy.DIALOG_YIELD_MS, false))
        assertFalse(WifiSetupPolicy.relaunchShouldYield(0L, false, 2_000L, false))
    }

    // ── Android 9 and older: never strand ────────────────────────────────

    private val home = NetKey("Home", "wpa2")
    private val lobby = NetKey("Lobby", "wpa2")

    @Test fun aSwitchHappensOnlyWhenTheTrafficRidesAnotherWifiNetworkAndAnythingUnreadableMeansNoSwitch() {
        assertEquals(WifiSetupPolicy.Next.JOINED, WifiSetupPolicy.legacyNext(networkId = 5, currentId = 5, defaultIsWifi = true))
        assertEquals(WifiSetupPolicy.Next.SWITCH, WifiSetupPolicy.legacyNext(5, currentId = 2, defaultIsWifi = true))
        assertEquals("a cable carries the traffic", WifiSetupPolicy.Next.SAVED, WifiSetupPolicy.legacyNext(5, 2, defaultIsWifi = false))
        assertEquals(WifiSetupPolicy.Next.SAVED, WifiSetupPolicy.legacyNext(5, 2, defaultIsWifi = null))
        assertEquals(WifiSetupPolicy.Next.SAVED, WifiSetupPolicy.legacyNext(5, currentId = null, defaultIsWifi = true))
    }

    @Test fun thePasswordOfTheNetworkInUseIsNeverRewritten() {
        assertFalse(WifiSetupPolicy.mayRewrite(existingId = 3, currentId = 3, defaultIsWifi = true))
        assertFalse(WifiSetupPolicy.mayRewrite(3, 3, defaultIsWifi = null))
        assertTrue("on a cable it may be", WifiSetupPolicy.mayRewrite(3, 3, defaultIsWifi = false))
        assertTrue(WifiSetupPolicy.mayRewrite(3, currentId = 4, defaultIsWifi = true))
    }

    @Test fun onlyVenueOsOwnOtherNetworksGoNeverTheOneInUseNeverAPersons() {
        val saved = listOf(
            SavedNetwork(1, home, enabled = true, current = true), // a person's, in use
            SavedNetwork(2, NetKey("OldVenueOS", "wpa2"), enabled = true, current = false), // ours, idle
            SavedNetwork(3, lobby, enabled = true, current = false), // ours, the new one
            SavedNetwork(4, NetKey("CafeOurs", "open"), enabled = true, current = true), // ours, in use
            SavedNetwork(5, null, enabled = true, current = false), // a hex name
        )
        val ours = setOf(NetKey("OldVenueOS", "wpa2"), lobby, NetKey("CafeOurs", "open"))
        assertEquals(listOf(2), WifiSetupPolicy.removable(saved, ours, keep = lobby, inUseId = null).map { it.networkId })
        assertEquals(emptyList<Int>(), WifiSetupPolicy.removable(saved, ours, keep = lobby, inUseId = 2).map { it.networkId })
    }

    @Test fun aSwitchIsKeptOnlyOnceTheServerAnsweredOverItAndAnAlertSendsTheScreenStraightBack() {
        fun step(
            since: Long = 5_000L,
            remaining: Long = 30_000L,
            on: Boolean = false,
            ever: Boolean = false,
            reached: Boolean = false,
            held: Boolean = false,
            gone: Boolean = false,
            another: Boolean = false,
        ) = WifiSetupPolicy.proofStep(since, remaining, on, ever, reached, held, gone, another)
        assertEquals(Proof.Proven, step(on = true, ever = true, reached = true))
        assertEquals("associated is not proof", Proof.Wait, step(on = true, ever = true, reached = false))
        assertEquals(Proof.RollBack(DeviceSettingCodes.WAIT_EMERGENCY), step(on = true, ever = true, reached = true, held = true))
        assertEquals(Proof.RollBack(DeviceSettingCodes.WIFI_NO_CONNECT), step(gone = true))
        assertEquals(Proof.RollBack(DeviceSettingCodes.WIFI_NO_CONNECT), step(since = WifiSetupPolicy.FELL_BACK_AFTER_MS, another = true))
        assertEquals("a fallback before the grace is not yet a verdict", Proof.Wait, step(since = 1_000L, another = true))
        assertEquals(Proof.RollBack(DeviceSettingCodes.WIFI_UNREACHABLE), step(remaining = 0L, on = true, ever = true))
        assertEquals(Proof.RollBack(DeviceSettingCodes.WIFI_NO_CONNECT), step(remaining = 0L))
    }

    @Test fun aSwitchThatOutlivedItsProcessOrAReootGetsAFairWindowNeverAnEndlessOne() {
        val j = Journal("r7", 9, lobby, previousId = 1, previousOurs = false, enabledBefore = listOf(1), startedElapsedMs = 10_000L, boot = 3)
        assertEquals(10_000L + WifiSetupPolicy.PROOF_WINDOW_MS, WifiSetupPolicy.proofDeadline(j, resumedAtElapsedMs = 10_000L, boot = 3))
        // Resumed late in the same boot: still a short, bounded look.
        assertEquals(500_000L + WifiSetupPolicy.RESUME_GRACE_MS, WifiSetupPolicy.proofDeadline(j, 500_000L, 3))
        // After a reboot the network stack started over: a fresh window.
        assertEquals(2_000L + WifiSetupPolicy.PROOF_WINDOW_MS, WifiSetupPolicy.proofDeadline(j, 2_000L, 4))
    }

    @Test fun theLedgerAndTheJournalRoundTripAndCarryNoSecret() {
        val keys = setOf(lobby, NetKey("Guest", "open"))
        assertEquals(keys, WifiSetupPolicy.decodeLedger(WifiSetupPolicy.encodeLedger(keys)))
        assertTrue(WifiSetupPolicy.decodeLedger("not json").isEmpty())
        assertTrue(WifiSetupPolicy.decodeLedger("""[{"ssid":"x","security":"wep"}]""").isEmpty())
        val j = Journal("m12", 9, lobby, 1, true, listOf(1, 4), 10_000L, 3)
        val text = WifiSetupPolicy.encodeJournal(j)
        assertEquals(j, WifiSetupPolicy.decodeJournal(text))
        assertFalse(text.contains("pass"))
        assertNull(WifiSetupPolicy.decodeJournal("""{"id":"x1","net":9,"ssid":"Lobby","security":"wpa2"}"""))
        assertNull(WifiSetupPolicy.decodeJournal(null))
    }
}
