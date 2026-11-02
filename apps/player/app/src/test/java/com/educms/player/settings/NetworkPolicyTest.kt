package com.educms.player.settings

import com.educms.player.settings.WifiScanPolicy.Access
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Nearby networks and the connection line, as pure rules: what Android
 * requires to list networks on each version, why a list may be empty (never
 * a silent empty list), and how a connection is described.
 */
class NetworkPolicyTest {

    private val fine = setOf(WifiScanPolicy.PERMISSION_FINE, WifiScanPolicy.PERMISSION_COARSE)
    private val coarse = setOf(WifiScanPolicy.PERMISSION_COARSE)

    @Test
    fun locationIsAskedOnlyAtFirstLaunch() {
        assertTrue(WifiScanPolicy.shouldAskAtLaunch(emptySet(), askedBefore = false))
        assertFalse(WifiScanPolicy.shouldAskAtLaunch(emptySet(), askedBefore = true))
        assertFalse(WifiScanPolicy.shouldAskAtLaunch(fine, askedBefore = false))
        assertTrue(WifiScanPolicy.shouldAskAtLaunch(coarse, askedBefore = false))
    }

    private fun access(
        sdk: Int = 30,
        hasWifi: Boolean = true,
        radio: Boolean? = true,
        granted: Set<String> = fine,
        location: Boolean? = true,
        held: Boolean = false,
        asked: Boolean = false,
        rationale: Boolean = false,
    ) = WifiScanPolicy.access(sdk, hasWifi, radio, granted, location, held, asked, rationale)

    @Test fun androidTenAndUpNeedFineLocationAndroidNineAndOlderAcceptCoarse() {
        for (sdk in listOf(29, 30, 31, 33, 34)) {
            assertEquals("sdk $sdk", Access.NEEDS_PERMISSION, access(sdk = sdk, granted = coarse))
            assertEquals(Access.GRANTED, access(sdk = sdk, granted = fine))
        }
        for (sdk in listOf(24, 25, 28)) {
            assertEquals("sdk $sdk", Access.GRANTED, access(sdk = sdk, granted = coarse))
            assertEquals(Access.NEEDS_PERMISSION, access(sdk = sdk, granted = emptySet()))
        }
        assertEquals(listOf(WifiScanPolicy.PERMISSION_FINE, WifiScanPolicy.PERMISSION_COARSE), WifiScanPolicy.permissions())
    }

    @Test fun locationOffIsItsOwnStateNeverAnEmptyList() {
        assertEquals(Access.LOCATION_OFF, access(location = false))
        assertEquals("unreadable is not off", Access.GRANTED, access(location = null))
    }

    @Test fun everyOtherReasonIsSaidAndAnAlertComesFirst() {
        assertEquals(Access.NO_WIFI, access(hasWifi = false))
        assertEquals(Access.EMERGENCY, access(held = true, radio = false, granted = emptySet()))
        assertEquals(Access.WIFI_OFF, access(radio = false))
        assertEquals("asked before, Android will not ask again", Access.DENIED, access(granted = emptySet(), asked = true, rationale = false))
        assertEquals("asked before, Android may ask again", Access.NEEDS_PERMISSION, access(granted = emptySet(), asked = true, rationale = true))
    }

    @Test fun scansAreThrottledInsideAndroidsOwnLimit() {
        assertTrue(WifiScanPolicy.shouldStartScan(0L, 5_000L))
        assertFalse(WifiScanPolicy.shouldStartScan(1_000L, 1_000L + WifiScanPolicy.MIN_SCAN_GAP_MS - 1))
        assertTrue(WifiScanPolicy.shouldStartScan(1_000L, 1_000L + WifiScanPolicy.MIN_SCAN_GAP_MS))
        assertTrue("a clock that went back never wedges the scan", WifiScanPolicy.shouldStartScan(9_000L, 1_000L))
        // 4 per 2 minutes, at most.
        assertTrue(120_000L / WifiScanPolicy.MIN_SCAN_GAP_MS <= 4)
        assertFalse(WifiScanPolicy.mayRequestPermission(emergencyHeld = true, lockTask = false))
        assertFalse(WifiScanPolicy.mayRequestPermission(emergencyHeld = false, lockTask = true))
        assertTrue(WifiScanPolicy.mayRequestPermission(false, false))
    }

    @Test fun securityIsReadFromAndroidsCapabilityString() {
        assertEquals("wpa2", WifiScanPolicy.security("[WPA2-PSK-CCMP][RSN-PSK-CCMP][ESS][WPS]"))
        assertEquals("wpa3", WifiScanPolicy.security("[RSN-SAE-CCMP][ESS]"))
        assertEquals("a transition network reads WPA2, which every screen joins", "wpa2", WifiScanPolicy.security("[RSN-PSK+SAE-CCMP][ESS]"))
        assertEquals("enterprise", WifiScanPolicy.security("[WPA2-EAP-CCMP][ESS]"))
        assertEquals("wep", WifiScanPolicy.security("[WEP][ESS]"))
        assertEquals("other", WifiScanPolicy.security("[RSN-OWE-CCMP][ESS]"))
        assertEquals("open", WifiScanPolicy.security("[ESS]"))
        assertEquals("open", WifiScanPolicy.security(null))
        assertTrue(WifiScanPolicy.joinable("wpa2") && WifiScanPolicy.joinable("wpa3") && WifiScanPolicy.joinable("open"))
        assertFalse(WifiScanPolicy.joinable("enterprise") || WifiScanPolicy.joinable("wep") || WifiScanPolicy.joinable("other"))
    }

    @Test fun signalIsAndroidsFiveLevelScale() {
        assertEquals(0, WifiScanPolicy.bars(-100))
        assertEquals(0, WifiScanPolicy.bars(-127))
        assertEquals(4, WifiScanPolicy.bars(-55))
        assertEquals(4, WifiScanPolicy.bars(-30))
        assertEquals(2, WifiScanPolicy.bars(-75))
        for (rssi in -100..-55) assertTrue(WifiScanPolicy.bars(rssi) in 0..4)
    }

    @Test fun theListIsOneRowPerNetworkTheOneInUseFirstHiddenOnesDroppedAndBounded() {
        val raw = listOf(
            WifiScanPolicy.Raw("Lobby", -70, "[WPA2-PSK-CCMP]"),
            WifiScanPolicy.Raw("Lobby", -50, "[WPA2-PSK-CCMP]"), // a stronger access point, same network
            WifiScanPolicy.Raw("", -40, "[ESS]"), // hidden
            WifiScanPolicy.Raw(null, -40, "[ESS]"),
            WifiScanPolicy.Raw("Guest", -60, "[ESS]"),
            WifiScanPolicy.Raw("Office", -45, "[RSN-SAE-CCMP]"),
            WifiScanPolicy.Raw("Saved", -90, "[WPA2-PSK-CCMP]"),
        )
        val list = WifiScanPolicy.networks(raw, ours = setOf("Saved"), othersSaved = setOf("Guest"), connectedSsid = "Lobby")
        assertEquals(listOf("Lobby", "Guest", "Saved", "Office"), list.map { it.ssid })
        assertTrue(list[0].connected)
        assertEquals(-50, list[0].rssi)
        assertEquals(WifiScanPolicy.SAVED_OTHER, list[1].savedBy)
        assertEquals(WifiScanPolicy.SAVED_VENUEOS, list[2].savedBy)
        assertNull(list[3].savedBy)
        val many = (1..100).map { WifiScanPolicy.Raw("Net$it", -60, "[ESS]") }
        assertEquals(WifiScanPolicy.MAX_NETWORKS, WifiScanPolicy.networks(many, emptySet(), emptySet(), null).size)
    }

    @Test fun theConnectionIsDescribedFromWhatAndroidSaysAndNothingIsGuessed() {
        assertEquals(NetworkStatusPolicy.T_ETHERNET, NetworkStatusPolicy.transport(activeWifi = false, activeEthernet = true, hasActive = true))
        assertEquals(NetworkStatusPolicy.T_WIFI, NetworkStatusPolicy.transport(true, false, true))
        assertEquals(NetworkStatusPolicy.T_OTHER, NetworkStatusPolicy.transport(false, false, true))
        assertEquals(NetworkStatusPolicy.T_NONE, NetworkStatusPolicy.transport(false, false, false))

        assertEquals("192.168.1.20", NetworkStatusPolicy.pickIp(listOf("fe80::1%wlan0", "192.168.1.20", "2001:db8::5")))
        assertEquals("2001:db8::5", NetworkStatusPolicy.pickIp(listOf("fe80::1%eth0", "2001:db8::5")))
        assertNull(NetworkStatusPolicy.pickIp(listOf("127.0.0.1", "169.254.3.4", "::1")))

        assertEquals("Android 11+: a DHCP server means automatic", true, NetworkStatusPolicy.automatic(30, hasIpv4 = true, dhcpServer = "192.168.1.1"))
        assertEquals(false, NetworkStatusPolicy.automatic(30, hasIpv4 = true, dhcpServer = null))
        assertNull(NetworkStatusPolicy.automatic(30, hasIpv4 = false, dhcpServer = null))
        assertNull("below Android 11 Android does not say", NetworkStatusPolicy.automatic(28, hasIpv4 = true, dhcpServer = null))

        assertEquals("Lobby", NetworkStatusPolicy.ssid("\"Lobby\""))
        assertNull("no location: Android's placeholder", NetworkStatusPolicy.ssid("<unknown ssid>"))
        assertNull("a hex name", NetworkStatusPolicy.ssid("4c6f626279"))
        assertNull(NetworkStatusPolicy.ssid(null))
        assertNull(NetworkStatusPolicy.rssi(-127))
        assertEquals(-60, NetworkStatusPolicy.rssi(-60))
    }
}
