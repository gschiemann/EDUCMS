package com.educms.player.settings

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The value rules this unit applies ON ITS OWN SIDE: a value that goes into a
 * system setting is refused here, whatever the server sent.
 */
class DeviceSettingDomainsTest {

    private fun ok(key: DeviceSettingKey, v: DesiredValue) = DeviceSettingDomains.valid(key, v)

    @Test fun brightnessNeverBelowTheSafeFloor() {
        assertFalse(ok(DeviceSettingKey.BRIGHTNESS, DesiredValue.IntValue(4)))
        assertTrue(ok(DeviceSettingKey.BRIGHTNESS, DesiredValue.IntValue(5)))
        assertTrue(ok(DeviceSettingKey.BRIGHTNESS, DesiredValue.IntValue(100)))
        assertFalse(ok(DeviceSettingKey.BRIGHTNESS, DesiredValue.IntValue(101)))
        assertEquals(com.educms.player.display.DisplayLimits.MIN_SAFE_BRIGHTNESS, DeviceSettingDomains.MIN_BRIGHTNESS)
    }

    @Test fun volumeIsZeroToOneHundred() {
        assertTrue(ok(DeviceSettingKey.VOLUME, DesiredValue.IntValue(0)))
        assertTrue(ok(DeviceSettingKey.VOLUME, DesiredValue.IntValue(100)))
        assertFalse(ok(DeviceSettingKey.VOLUME, DesiredValue.IntValue(-1)))
    }

    @Test fun theTimeoutIsOneOfTheOfferedValuesAndNeverShorterThanAMinute() {
        for (ms in DeviceSettingDomains.TIMEOUTS_MS) assertTrue(ok(DeviceSettingKey.SCREEN_OFF_TIMEOUT, DesiredValue.IntValue(ms)))
        assertTrue(DeviceSettingDomains.TIMEOUTS_MS.all { it >= 60_000 })
        for (ms in listOf(0, 15_000, 59_999, 120_000)) assertFalse(ok(DeviceSettingKey.SCREEN_OFF_TIMEOUT, DesiredValue.IntValue(ms)))
        assertEquals(Int.MAX_VALUE, DeviceSettingDomains.TIMEOUT_NEVER)
    }

    @Test fun switchesAreBooleans() {
        for (k in listOf(DeviceSettingKey.ROTATION_LOCK, DeviceSettingKey.AUTO_TIME, DeviceSettingKey.AUTO_TIME_ZONE)) {
            assertTrue(ok(k, DesiredValue.BoolValue(false)))
            assertFalse(ok(k, DesiredValue.IntValue(1)))
        }
    }

    @Test fun theTimeServerIsAHostNameAnIpv4AddressOrEmpty() {
        for (good in listOf("", "time.google.com", "pool.ntp.org", "ntp1.school-district.k12.example", "10.0.0.1", "time")) {
            assertTrue(good, DeviceSettingDomains.validNtpServer(good))
        }
        for (bad in listOf(
            "http://time.google.com", "time.google.com:123", "time google", "-bad.example", "bad-.example",
            "a..b", "999.1.1.1", "12345", "time.google.com\n", "x".repeat(254), "exämple.com", "pool.ntp.org;reboot",
        )) {
            assertFalse(bad, DeviceSettingDomains.validNtpServer(bad))
        }
    }

    @Test fun wifiIsOneNetworkWithASaneSsidAndAPersonalPassphrase() {
        assertTrue(ok(DeviceSettingKey.WIFI, DesiredValue.WifiValue("Lobby", "wpa2", false, "12345678")))
        assertTrue(ok(DeviceSettingKey.WIFI, DesiredValue.WifiValue("Café ☕", "wpa3", true, "x".repeat(63))))
        assertTrue("open needs none", ok(DeviceSettingKey.WIFI, DesiredValue.WifiValue("Guest", "open", false, null)))
        assertTrue("a missing passphrase is asked for, not refused", ok(DeviceSettingKey.WIFI, DesiredValue.WifiValue("Lobby", "wpa2", false, null)))
        assertFalse(ok(DeviceSettingKey.WIFI, DesiredValue.WifiValue("Guest", "open", false, "12345678")))
        assertFalse(ok(DeviceSettingKey.WIFI, DesiredValue.WifiValue("Lobby", "wpa2", false, "short")))
        assertFalse(ok(DeviceSettingKey.WIFI, DesiredValue.WifiValue("Lobby", "wpa2", false, "x".repeat(64))))
        assertFalse(ok(DeviceSettingKey.WIFI, DesiredValue.WifiValue("Lobby", "wpa2", false, "tab\there!")))
        assertFalse(ok(DeviceSettingKey.WIFI, DesiredValue.WifiValue("", "wpa2", false, "12345678")))
        assertFalse(ok(DeviceSettingKey.WIFI, DesiredValue.WifiValue("x".repeat(33), "wpa2", false, "12345678")))
        assertFalse(ok(DeviceSettingKey.WIFI, DesiredValue.WifiValue("bad\u0007", "wpa2", false, "12345678")))
        assertFalse(ok(DeviceSettingKey.WIFI, DesiredValue.WifiValue("Lobby", "wep", false, "12345678")))
    }

    @Test fun thePassphraseNeverAppearsInALogLine() {
        val v = DesiredValue.WifiValue("Lobby", "wpa2", false, "correct horse battery")
        assertFalse(v.toString().contains("correct horse"))
        assertNull(v.withoutSecret().passphrase)
    }

    @Test fun everyKeyHasOneWireName() {
        val names = DeviceSettingKey.values().map { it.wire }
        assertEquals(names.size, names.toSet().size)
        for (k in DeviceSettingKey.values()) assertEquals(k, DeviceSettingKey.fromWire(k.wire))
        assertNull(DeviceSettingKey.fromWire("reboot"))
        assertFalse("Wi-Fi is never re-applied after a reboot", DeviceSettingKey.WIFI.recheckAfterBoot)
    }
}
