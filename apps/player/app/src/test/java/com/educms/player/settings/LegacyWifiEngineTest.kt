package com.educms.player.settings

import com.educms.player.settings.DeviceSettingsPolicy.Outcome
import com.educms.player.settings.DeviceSettingsPolicy.Status
import com.educms.player.settings.WifiSetupPolicy.Journal
import com.educms.player.settings.WifiSetupPolicy.NetKey
import com.educms.player.settings.WifiSetupPolicy.SavedNetwork
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * NEVER STRAND A SCREEN — the Android 9-and-older Wi-Fi engine driven through
 * a fake Android that records every call IN ORDER. The order is the rule:
 * claim, add, persist, and only then switch (with the way back on disk);
 * prove or switch back; remove only VenueOS's own networks, only afterwards,
 * never the one in use, never a person's.
 */
class LegacyWifiEngineTest {

    private class FakeAndroid(
        val networks: MutableList<SavedNetwork>,
        var defaultWifi: Boolean? = true,
        var radio: Boolean? = true,
        var addResult: Int = 50,
        var enableConnectOk: Boolean = true,
        var reenableOthersOk: Boolean = true,
        var serverAnswers: Boolean = false,
    ) : LegacyWifiPort {
        val calls = mutableListOf<String>()
        override fun radioOn() = radio
        override fun configured() = networks.toList()
        override fun add(value: DesiredValue.WifiValue): Int {
            calls += "add:${value.ssid}"
            if (addResult >= 0) networks += SavedNetwork(addResult, NetKey(value.ssid, value.security), enabled = false, current = false)
            return addResult
        }
        override fun update(networkId: Int, value: DesiredValue.WifiValue): Int {
            calls += "update:$networkId"
            return networkId
        }
        override fun enable(networkId: Int, connect: Boolean): Boolean {
            calls += "enable:$networkId:${if (connect) "connect" else "quiet"}"
            if (connect) return enableConnectOk
            val i = networks.indexOfFirst { it.networkId == networkId }
            if (i >= 0) networks[i] = networks[i].copy(enabled = true)
            return reenableOthersOk || networks.getOrNull(i)?.key?.ssid == "Lobby"
        }
        override fun remove(networkId: Int): Boolean {
            calls += "remove:$networkId"
            return networks.removeAll { it.networkId == networkId }
        }
        override fun disable(networkId: Int): Boolean { calls += "disable:$networkId"; return true }
        override fun saveConfiguration(): Boolean { calls += "save"; return true }
        override fun reconnect(): Boolean { calls += "reconnect"; return true }
        override fun defaultIsWifi() = defaultWifi
        override fun reachesServerOverWifi(): Boolean { calls += "probe"; return serverAnswers }
        fun connectTo(id: Int) {
            for (i in networks.indices) networks[i] = networks[i].copy(current = networks[i].networkId == id)
        }
    }

    private class FakeStore(var ours: Set<NetKey> = emptySet(), var j: Journal? = null) : WifiStateStore {
        val writes = mutableListOf<String>()
        var failJournal = false
        override fun ledger() = ours
        override fun putLedger(keys: Set<NetKey>): Boolean { writes += "ledger:${keys.map { it.ssid }.sorted()}"; ours = keys; return true }
        override fun journal() = j
        override fun putJournal(journal: Journal?): Boolean {
            if (failJournal && journal != null) return false
            writes += if (journal == null) "journal:clear" else "journal:${journal.id}"
            j = journal
            return true
        }
    }

    private val lobby = DesiredValue.WifiValue("Lobby", "wpa2", false, "pass-for-tests")
    private val home = SavedNetwork(1, NetKey("Home", "wpa2"), enabled = true, current = true) // a PERSON's network

    private fun engine(android: FakeAndroid, store: FakeStore, sdk: Int = 28) = LegacyWifiEngine(android, store, sdk)

    @Test fun onACableTheNetworkIsSavedNotSwitchedAndNothingElseIsTouched() {
        val android = FakeAndroid(mutableListOf(home.copy(current = false)), defaultWifi = false)
        val store = FakeStore()
        val out = engine(android, store).apply("r1", lobby, 1_000L, 7)
        assertEquals(Outcome.Landed(DeviceSettingCodes.WIFI_SAVED), out)
        assertEquals(listOf("add:Lobby", "enable:50:quiet", "save"), android.calls)
        assertTrue("claimed before it was added", store.writes.first().startsWith("ledger:"))
        assertNull("no switch, no journal", store.j)
        assertTrue("the person's network is untouched", android.networks.any { it.networkId == 1 })
    }

    @Test fun onAnotherWifiTheWayBackIsOnDiskBeforeTheConnectRequest() {
        val android = FakeAndroid(mutableListOf(home))
        val store = FakeStore()
        val out = engine(android, store).apply("r2", lobby, 1_000L, 7)
        assertEquals(Outcome.Held(Status.PENDING, DeviceSettingCodes.WIFI_SWITCHING), out)
        // Saved and persisted BEFORE the connect request; the journal precedes it too.
        assertEquals(listOf("add:Lobby", "enable:50:quiet", "save", "enable:50:connect"), android.calls)
        val j = store.j
        assertNotNull(j)
        assertEquals(1, j!!.previousId)
        assertFalse("the previous network is a person's", j.previousOurs)
        assertEquals(listOf(1), j.enabledBefore)
        // Nothing is saved after a connect request (Android 7 would persist the others disabled).
        assertEquals(1, android.calls.count { it == "save" })
    }

    @Test fun noWayBackOnDiskMeansNoSwitchAtAll() {
        val android = FakeAndroid(mutableListOf(home))
        val store = FakeStore().apply { failJournal = true }
        assertEquals(Outcome.Landed(DeviceSettingCodes.WIFI_SAVED), engine(android, store).apply("r2", lobby, 1_000L, 7))
        assertFalse(android.calls.any { it.endsWith(":connect") })
    }

    @Test fun provedOnlyOnTheNewNetworkWithTheServerAnsweringThenOlderVenueOsNetworksGo() {
        val old = SavedNetwork(7, NetKey("OldVenueOS", "wpa2"), enabled = true, current = false)
        val android = FakeAndroid(mutableListOf(home, old))
        val store = FakeStore(ours = setOf(NetKey("OldVenueOS", "wpa2")))
        val e = engine(android, store)
        e.apply("r3", lobby, 1_000L, 7)
        val j = store.j!!
        // Still on the old network: not proved, whatever the server says.
        android.serverAnswers = true
        assertFalse(e.observe(j).onOurNetwork)
        // On the new one, and the server answers over it: proved.
        android.connectTo(50)
        val seen = e.observe(j)
        assertTrue(seen.onOurNetwork && seen.reachedServer)
        android.calls.clear()
        assertEquals(Outcome.Landed(DeviceSettingCodes.WIFI_JOINED), e.commit(j))
        assertEquals("only VenueOS's OLD network goes, never the person's", listOf("remove:7"), android.calls)
        assertTrue(android.networks.any { it.networkId == 1 })
        assertEquals(setOf(NetKey("Lobby", "wpa2")), store.ours)
    }

    @Test fun notProvedTheScreenGoesBackOnlyVenueOsNewNetworkIsRemovedAndAPersonsIsNeverTouched() {
        val android = FakeAndroid(mutableListOf(home))
        val store = FakeStore()
        val e = engine(android, store, sdk = 28)
        e.apply("r4", lobby, 1_000L, 7)
        val j = store.j!!
        android.calls.clear()
        assertEquals(Outcome.Error(DeviceSettingCodes.WIFI_UNREACHABLE), e.rollBack(j, DeviceSettingCodes.WIFI_UNREACHABLE))
        assertEquals(listOf("remove:50", "reconnect"), android.calls)
        assertTrue(android.networks.any { it.networkId == 1 && it.enabled })
        assertFalse(android.networks.any { it.networkId == 50 })
        assertTrue("the claim goes with the network", store.ours.isEmpty())
    }

    @Test fun onAndroidSevenEveryOtherNetworkIsEnabledAgainBEFOREAnythingThatSaves() {
        val android = FakeAndroid(mutableListOf(home, SavedNetwork(2, NetKey("Vendor", "open"), true, false)))
        val store = FakeStore()
        val e = engine(android, store, sdk = 25)
        e.apply("r5", lobby, 1_000L, 7)
        val j = store.j!!
        android.calls.clear()
        e.rollBack(j, DeviceSettingCodes.WIFI_NO_CONNECT)
        val removeAt = android.calls.indexOf("remove:50")
        assertTrue(android.calls.indexOf("enable:1:quiet") in 0 until removeAt)
        assertTrue(android.calls.indexOf("enable:2:quiet") in 0 until removeAt)
        // And on a proved switch too, before VenueOS's older networks go.
        val android2 = FakeAndroid(mutableListOf(home))
        val store2 = FakeStore()
        val e2 = engine(android2, store2, sdk = 25)
        e2.apply("r6", lobby, 1_000L, 7)
        android2.calls.clear()
        e2.commit(store2.j!!)
        assertEquals("enable:1:quiet", android2.calls.first())
    }

    @Test fun ifAndroidSevenWillNotEnableAnOtherNetworkAgainVenueOsKeepsItsOlderOnes() {
        val old = SavedNetwork(7, NetKey("OldVenueOS", "wpa2"), enabled = true, current = false)
        val android = FakeAndroid(mutableListOf(home, old), reenableOthersOk = false)
        val store = FakeStore(ours = setOf(NetKey("OldVenueOS", "wpa2")))
        val e = engine(android, store, sdk = 25)
        e.apply("r7", lobby, 1_000L, 7)
        android.calls.clear()
        e.commit(store.j!!)
        assertFalse("a removal would SAVE the disabled list", android.calls.any { it.startsWith("remove:") })
    }

    @Test fun aSwitchBackToVenueOsOwnPreviousNetworkReconnectsToIt() {
        val ours = SavedNetwork(3, NetKey("OldVenueOS", "wpa2"), enabled = true, current = true)
        val android = FakeAndroid(mutableListOf(ours))
        val store = FakeStore(ours = setOf(NetKey("OldVenueOS", "wpa2")))
        val e = engine(android, store)
        e.apply("r8", lobby, 1_000L, 7)
        assertTrue(store.j!!.previousOurs)
        android.calls.clear()
        e.rollBack(store.j!!, DeviceSettingCodes.WIFI_NO_CONNECT)
        assertTrue(android.calls.contains("enable:3:connect"))
    }

    @Test fun aNameSomeoneElseSavedIsLeftAloneAndTheNetworkInUseIsNeverRewritten() {
        val theirs = SavedNetwork(4, NetKey("Lobby", "wpa2"), enabled = true, current = false)
        val android = FakeAndroid(mutableListOf(home, theirs))
        assertEquals(Outcome.Error(DeviceSettingCodes.WIFI_EXISTS), engine(android, FakeStore()).apply("r9", lobby, 1L, 7))
        assertTrue(android.calls.isEmpty())

        val oursInUse = SavedNetwork(5, NetKey("Lobby", "wpa2"), enabled = true, current = true)
        val android2 = FakeAndroid(mutableListOf(oursInUse))
        val out = engine(android2, FakeStore(ours = setOf(NetKey("Lobby", "wpa2")))).apply("r10", lobby, 1L, 7)
        assertEquals(Outcome.Landed(DeviceSettingCodes.WIFI_JOINED), out)
        assertFalse("a wrong password here could not be undone", android2.calls.any { it.startsWith("update:") })
    }

    @Test fun aFailedAddGivesTheClaimBackAndSaysWhy() {
        val android = FakeAndroid(mutableListOf(home), addResult = -1)
        val store = FakeStore()
        assertEquals(Outcome.Error(DeviceSettingCodes.WIFI_ERROR), engine(android, store).apply("r11", lobby, 1L, 7))
        assertTrue(store.ours.isEmpty())
    }

    @Test fun refusalsThatNeedNoAndroidCallAtAll() {
        val android = FakeAndroid(mutableListOf(home))
        assertEquals(Outcome.Error(DeviceSettingCodes.WIFI_SECURITY), engine(android, FakeStore()).apply("r12", lobby.copy(security = "wpa3"), 1L, 7))
        assertEquals(Outcome.Error(DeviceSettingCodes.NEEDS_SECRET), engine(android, FakeStore()).apply("r13", lobby.copy(passphrase = null), 1L, 7))
        android.radio = false
        assertEquals(Outcome.Held(Status.WAITING, DeviceSettingCodes.WIFI_OFF), engine(android, FakeStore()).apply("r14", lobby, 1L, 7))
        val busy = FakeStore(j = Journal("r1", 9, NetKey("X", "open"), -1, false, emptyList(), 0L, 7))
        assertEquals(Outcome.Held(Status.PENDING, DeviceSettingCodes.WIFI_SWITCHING), engine(FakeAndroid(mutableListOf()), busy).apply("r15", lobby, 1L, 7))
        assertTrue(android.calls.isEmpty())
    }

    @Test fun theReportNamesVenueOsNetworkAndWhetherTheScreenIsOnIt() {
        val ours = SavedNetwork(5, NetKey("Lobby", "wpa2"), enabled = true, current = true)
        val e = engine(FakeAndroid(mutableListOf(home.copy(current = false), ours)), FakeStore(ours = setOf(NetKey("Lobby", "wpa2"))))
        assertEquals("Lobby" to true, e.ourNetwork())
        val e2 = engine(FakeAndroid(mutableListOf(home)), FakeStore())
        assertEquals(null to false, e2.ourNetwork())
    }
}
