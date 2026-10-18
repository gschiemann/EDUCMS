package com.educms.player.settings

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The capability verdicts ("can this unit set it right now, and why not")
 * and the read-back comparisons, as pure functions of the facts the probe
 * reads.
 */
class DeviceSettingsFactsTest {

    private val android13 = DeviceSettingsFacts.Capability(
        sdk = 33,
        posterClass = false,
        brightnessProvider = "settings",
        canWriteSettings = true,
        hasSecureSettings = true,
        hasAudio = true,
        volumeFixed = false,
        hasWifi = true,
        canChangeWifi = true,
        wifiApproval = DeviceSettingsFacts.WIFI_APPROVED,
    )

    private fun caps(f: DeviceSettingsFacts.Capability) = DeviceSettingsFacts.capabilities(f)

    @Test fun aFullyGrantedAndroid13UnitCanSetEverything() {
        val c = caps(android13)
        assertEquals(DeviceSettingKey.values().toSet(), c.keys)
        assertTrue(c.toString(), c.values.all { it == DeviceSettingCodes.OK })
    }

    @Test fun belowAndroid13EverySettingSaysSoAndNothingElse() {
        for (sdk in listOf(24, 29, 30, 32)) {
            val c = caps(android13.copy(sdk = sdk))
            assertEquals(DeviceSettingKey.values().toSet(), c.keys)
            assertTrue(c.values.all { it == DeviceSettingCodes.API_LEVEL })
        }
    }

    @Test fun withoutModifySystemSettingsTheTimeoutRotationAndAndroidBrightnessSayWhy() {
        val c = caps(android13.copy(canWriteSettings = false, brightnessProvider = "software-dim"))
        assertEquals(DeviceSettingCodes.NO_WRITE_SETTINGS, c[DeviceSettingKey.SCREEN_OFF_TIMEOUT])
        assertEquals(DeviceSettingCodes.NO_WRITE_SETTINGS, c[DeviceSettingKey.ROTATION_LOCK])
        assertEquals(DeviceSettingCodes.NO_WRITE_SETTINGS, c[DeviceSettingKey.BRIGHTNESS])
        assertEquals("volume needs no grant", DeviceSettingCodes.OK, c[DeviceSettingKey.VOLUME])
    }

    @Test fun aWritableBacklightNodeNeedsNoGrantForBrightness() {
        val c = caps(android13.copy(canWriteSettings = false, brightnessProvider = "sysfs-backlight"))
        assertEquals(DeviceSettingCodes.OK, c[DeviceSettingKey.BRIGHTNESS])
    }

    @Test fun withoutTheInstallCommandTheTimeSettingsSayWhy() {
        val c = caps(android13.copy(hasSecureSettings = false))
        for (k in listOf(DeviceSettingKey.AUTO_TIME, DeviceSettingKey.AUTO_TIME_ZONE, DeviceSettingKey.NTP_SERVER, DeviceSettingKey.ATTENTIVE_TIMEOUT)) {
            assertEquals(DeviceSettingCodes.NO_SECURE_SETTINGS, c[k])
        }
        assertEquals(DeviceSettingCodes.OK, c[DeviceSettingKey.SCREEN_OFF_TIMEOUT])
    }

    @Test fun brightnessIsOfferedOnlyWhereItsLevelCanBeReadBack() {
        assertEquals(DeviceSettingCodes.VENDOR_BRIGHTNESS, caps(android13.copy(posterClass = true))[DeviceSettingKey.BRIGHTNESS])
        assertEquals(DeviceSettingCodes.VENDOR_BRIGHTNESS, caps(android13.copy(brightnessProvider = "vendor-recipe"))[DeviceSettingKey.BRIGHTNESS])
        assertEquals(DeviceSettingCodes.VENDOR_BRIGHTNESS, caps(android13.copy(brightnessProvider = "novastar-sdk"))[DeviceSettingKey.BRIGHTNESS])
        assertEquals(DeviceSettingCodes.PICTURE_ONLY, caps(android13.copy(brightnessProvider = "software-dim"))[DeviceSettingKey.BRIGHTNESS])
        assertEquals(DeviceSettingCodes.PICTURE_ONLY, caps(android13.copy(brightnessProvider = null))[DeviceSettingKey.BRIGHTNESS])
    }

    @Test fun volumeAndWifiSayWhatTheUnitIsMissing() {
        assertEquals(DeviceSettingCodes.VOLUME_FIXED, caps(android13.copy(volumeFixed = true))[DeviceSettingKey.VOLUME])
        assertEquals(DeviceSettingCodes.UNSUPPORTED, caps(android13.copy(hasAudio = false))[DeviceSettingKey.VOLUME])
        assertEquals(DeviceSettingCodes.NO_WIFI, caps(android13.copy(hasWifi = false))[DeviceSettingKey.WIFI])
        assertEquals(DeviceSettingCodes.WIFI_DISALLOWED, caps(android13.copy(wifiApproval = DeviceSettingsFacts.WIFI_REJECTED))[DeviceSettingKey.WIFI])
        assertEquals(DeviceSettingCodes.OK, caps(android13.copy(wifiApproval = DeviceSettingsFacts.WIFI_PENDING))[DeviceSettingKey.WIFI])
        assertEquals(DeviceSettingCodes.UNSUPPORTED, caps(android13.copy(canChangeWifi = false))[DeviceSettingKey.WIFI])
    }

    // ── read-back ────────────────────────────────────────────────────────

    private fun item(key: DeviceSettingKey, v: DesiredValue) = DesiredItem(key, "r1", v)

    @Test fun brightnessIsComparedInTheRawScaleItWasWrittenIn() {
        val want = item(DeviceSettingKey.BRIGHTNESS, DesiredValue.IntValue(60))
        val raw = DeviceSettingsFacts.expectedBrightnessRaw(60, 255)
        val settings = DeviceSettingsFacts.Observation(brightnessVia = "settings", brightnessRaw = raw, brightnessMax = 255, brightnessManual = true)
        assertEquals(true, DeviceSettingsFacts.matches(want, settings))
        assertEquals(true, DeviceSettingsFacts.matches(want, settings.copy(brightnessRaw = raw + 1)))
        assertEquals(false, DeviceSettingsFacts.matches(want, settings.copy(brightnessRaw = raw + 3)))
        assertEquals("adaptive brightness would move it", false, DeviceSettingsFacts.matches(want, settings.copy(brightnessManual = false)))
        val node = DeviceSettingsFacts.Observation(brightnessVia = "sysfs-backlight", brightnessRaw = DeviceSettingsFacts.expectedBrightnessRaw(60, 4095), brightnessMax = 4095)
        assertEquals(true, DeviceSettingsFacts.matches(want, node))
        assertNull(DeviceSettingsFacts.matches(want, DeviceSettingsFacts.Observation()))
        // The report speaks the slider's language: the raw value read back as a percent.
        assertEquals(60, DeviceSettingsFacts.percentFromRaw(raw, 255))
        for (p in listOf(10, 25, 50, 75, 100)) {
            val back = DeviceSettingsFacts.percentFromRaw(DeviceSettingsFacts.expectedBrightnessRaw(p, 255), 255)
            assertTrue("$p → $back", kotlin.math.abs(back - p) <= 2)
        }
    }

    @Test fun volumeIsComparedAsTheStepAndroidActuallyHas() {
        val want = item(DeviceSettingKey.VOLUME, DesiredValue.IntValue(40))
        val step = DeviceSettingsFacts.expectedVolumeIndex(40, 15)
        assertEquals(true, DeviceSettingsFacts.matches(want, DeviceSettingsFacts.Observation(volumeIndex = step, volumeMax = 15)))
        assertEquals(false, DeviceSettingsFacts.matches(want, DeviceSettingsFacts.Observation(volumeIndex = step + 1, volumeMax = 15)))
        assertNull(DeviceSettingsFacts.matches(want, DeviceSettingsFacts.Observation(volumeIndex = 3, volumeMax = 0)))
    }

    @Test fun switchesTimeoutsAndTheTimeServerCompareExactly() {
        val o = DeviceSettingsFacts.Observation(
            screenOffTimeoutMs = Int.MAX_VALUE, rotationLocked = true, autoTime = false, autoTimeZone = true, ntpServer = "",
        )
        assertEquals(true, DeviceSettingsFacts.matches(item(DeviceSettingKey.SCREEN_OFF_TIMEOUT, DesiredValue.IntValue(Int.MAX_VALUE)), o))
        assertEquals(false, DeviceSettingsFacts.matches(item(DeviceSettingKey.SCREEN_OFF_TIMEOUT, DesiredValue.IntValue(600_000)), o))
        assertEquals(true, DeviceSettingsFacts.matches(item(DeviceSettingKey.ROTATION_LOCK, DesiredValue.BoolValue(true)), o))
        assertEquals(false, DeviceSettingsFacts.matches(item(DeviceSettingKey.AUTO_TIME, DesiredValue.BoolValue(true)), o))
        assertEquals(true, DeviceSettingsFacts.matches(item(DeviceSettingKey.AUTO_TIME_ZONE, DesiredValue.BoolValue(true)), o))
        assertEquals("no override = Android's own server", true, DeviceSettingsFacts.matches(item(DeviceSettingKey.NTP_SERVER, DesiredValue.TextValue("")), o))
        assertEquals(true, DeviceSettingsFacts.matches(item(DeviceSettingKey.NTP_SERVER, DesiredValue.TextValue("Time.Google.com")), o.copy(ntpServer = "time.google.com")))
        assertNull(DeviceSettingsFacts.matches(item(DeviceSettingKey.AUTO_TIME, DesiredValue.BoolValue(true)), DeviceSettingsFacts.Observation()))
    }

    @Test fun inactivitySleepOffIsAnyValueAndroidReadsAsOff() {
        val never = item(DeviceSettingKey.ATTENTIVE_TIMEOUT, DesiredValue.IntValue(-1))
        assertEquals(true, DeviceSettingsFacts.matches(never, DeviceSettingsFacts.Observation(attentiveTimeoutMs = -1)))
        assertEquals(true, DeviceSettingsFacts.matches(never, DeviceSettingsFacts.Observation(attentiveTimeoutMs = 0)))
        assertEquals(false, DeviceSettingsFacts.matches(never, DeviceSettingsFacts.Observation(attentiveTimeoutMs = 14_400_000)))
        assertNull("unset = the build's own default, which may be a 4 h sleep", DeviceSettingsFacts.matches(never, DeviceSettingsFacts.Observation()))
        val eight = item(DeviceSettingKey.ATTENTIVE_TIMEOUT, DesiredValue.IntValue(28_800_000))
        assertEquals(true, DeviceSettingsFacts.matches(eight, DeviceSettingsFacts.Observation(attentiveTimeoutMs = 28_800_000)))
        assertEquals(false, DeviceSettingsFacts.matches(eight, DeviceSettingsFacts.Observation(attentiveTimeoutMs = -1)))
        assertEquals(-1, DeviceSettingsFacts.forReport(DeviceSettingsFacts.Observation(attentiveTimeoutMs = 0))[DeviceSettingKey.ATTENTIVE_TIMEOUT])
    }

    @Test fun wifiCanNeverBeConfirmedByReadingBecauseAPassphraseIsNotReadable() {
        val wifi = item(DeviceSettingKey.WIFI, DesiredValue.WifiValue("Lobby", "wpa2", false, "12345678"))
        assertNull(DeviceSettingsFacts.matches(wifi, DeviceSettingsFacts.Observation(wifi = DeviceSettingsWire.WifiObserved("Lobby", "approved"))))
    }

    @Test fun theReportCarriesPercentsAndOmitsWhatItCannotRead() {
        val r = DeviceSettingsFacts.forReport(
            DeviceSettingsFacts.Observation(brightnessVia = "settings", brightnessRaw = 255, brightnessMax = 255, volumeIndex = 15, volumeMax = 15, autoTime = true),
        )
        assertEquals(100, r[DeviceSettingKey.BRIGHTNESS])
        assertEquals(100, r[DeviceSettingKey.VOLUME])
        assertEquals(true, r[DeviceSettingKey.AUTO_TIME])
        assertFalse(r.containsKey(DeviceSettingKey.NTP_SERVER))
        assertFalse(r.containsKey(DeviceSettingKey.SCREEN_OFF_TIMEOUT))
    }
}
