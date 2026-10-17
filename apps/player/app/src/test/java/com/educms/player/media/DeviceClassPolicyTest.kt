package com.educms.player.media

import com.educms.player.media.DeviceClassPolicy.Facts
import com.educms.player.media.DeviceClassPolicy.SilentUpdate
import com.educms.player.media.DeviceClassPolicy.Soc
import org.junit.Assert.*
import org.junit.Test

/**
 * The device-class policy table (plan 2026-10-17 §2 / §4C), one case per
 * fleet class. Pure: the facts are what each class's Build strings report.
 */
class DeviceClassPolicyTest {
    // Build strings as the fleet reports them: Amlogic T982 units carry the
    // board/device "t982_ar301" (hardware-detect.ts); Rockchip leaves the
    // reference strings in place (HARDWARE "rk30board", BOARD "rk3288").
    private val t982a13 = Facts(sdk = 33, webviewMajor = 101, hardware = "amlogic", board = "t982_ar301", device = "t982_ar301", model = "M43GUQ", manufacturer = "Goodview", selfInstaller = true)
    private val t982a11 = Facts(sdk = 30, webviewMajor = 95, hardware = "amlogic", board = "t982_ar301", device = "t982_ar301", model = "GUQ55", manufacturer = "Goodview")
    private val rk3288a7 = Facts(sdk = 25, webviewMajor = 87, hardware = "rk30board", board = "rk3288", device = "rk3288", model = "rk3288_239", manufacturer = "rockchip")
    private val rk3328a11 = Facts(sdk = 30, webviewMajor = 101, hardware = "rk30board", board = "rk3328", device = "rk3328_box", model = "X80", manufacturer = "Rockchip")
    private val android9 = Facts(sdk = 28, webviewMajor = 66, hardware = "qcom", board = "msm8953", device = "commercial", model = "G24", manufacturer = "Commercial")
    private val taurus = Facts(sdk = 30, webviewMajor = 83, hardware = "rk30board", board = "rk356x_box", device = "rk356x_box", model = "rk356x_box", manufacturer = "rockchip")

    @Test fun amlogicT982Android13IsDynamicAboveAndUpdatesSilentlyAsItsOwnInstaller() {
        val r = DeviceClassPolicy.resolve(t982a13)
        assertEquals(Soc.AMLOGIC, r.soc)
        assertEquals("amlogic/android-13", r.className)
        assertTrue(r.fleet!!.contains("M43"))
        assertTrue(r.nativeSolo)
        assertEquals(SoloVideoLayer.Mode.DYNAMIC_ABOVE, r.composition)
        assertEquals(SoloVideoLayer.Mode.DYNAMIC_ABOVE, r.composition(2, 0))
        assertTrue(r.protocol3)
        assertEquals(3, r.protocolMax)
        assertEquals(SoloVideoLayer.Mode.STATIC_ABOVE, r.composition(3, 0))
        assertEquals(SilentUpdate.INSTALLER_OF_RECORD, r.silentUpdate)
        assertNull("nothing is qualified on this contract until Tuesday's glass says so", r.qualified)
    }

    @Test fun amlogicT982Android11TheLaunchClassIsDynamicAboveAndNeedsATapOrADeviceOwner() {
        val r = DeviceClassPolicy.resolve(t982a11)
        assertEquals("amlogic/android-11", r.className)
        assertTrue(r.fleet!!.contains("GUQ55"))
        assertTrue(r.nativeSolo)
        assertEquals(SoloVideoLayer.Mode.DYNAMIC_ABOVE, r.composition)
        assertTrue(r.protocol3)
        // API 30: the silent-install hint is API 31; installer-of-record alone is not enough, and
        // there is no device-owner path (the Manager is never device owner, owner 2026-10-17).
        assertEquals(SilentUpdate.TAP, DeviceClassPolicy.resolve(t982a11.copy(selfInstaller = true)).silentUpdate)
        assertEquals(SilentUpdate.TAP, r.silentUpdate)
    }

    @Test fun rockchipRk3288Android7IsStaticAboveOnBothFacesAndNeverUnderTheWindow() {
        val r = DeviceClassPolicy.resolve(rk3288a7)
        assertEquals(Soc.ROCKCHIP, r.soc)
        assertEquals("rockchip/android-7", r.className)
        assertTrue(r.fleet!!.contains("DH43"))
        assertTrue(r.nativeSolo)
        assertEquals(SoloVideoLayer.Mode.STATIC_ABOVE, r.composition)
        for (face in 0..1) assertEquals(SoloVideoLayer.Mode.STATIC_ABOVE, r.composition(2, face))
        assertNull(r.composition(2, 2))
        assertEquals(SilentUpdate.TAP, r.silentUpdate)
        // Android 7 has no silent path at all, whoever installed us.
        assertEquals(SilentUpdate.TAP, DeviceClassPolicy.resolve(rk3288a7.copy(selfInstaller = true)).silentUpdate)
    }

    @Test fun rockchipRk3328Android11IsDynamicAbove() {
        val r = DeviceClassPolicy.resolve(rk3328a11)
        assertEquals("rockchip/android-11", r.className)
        assertTrue(r.fleet!!.contains("VisionCore"))
        assertEquals(SoloVideoLayer.Mode.DYNAMIC_ABOVE, r.composition)
        assertTrue(r.protocol3)
        assertEquals(SilentUpdate.TAP, r.silentUpdate)
    }

    @Test fun android9CommercialChrome66IsStaticAboveOnAnyHardwareNotOnlyRockchip() {
        val r = DeviceClassPolicy.resolve(android9)
        assertEquals(Soc.OTHER, r.soc)
        assertEquals("other/android-9", r.className)
        assertTrue(r.fleet!!.contains("G24"))
        assertEquals(66, r.webviewMajor)
        assertTrue(r.nativeSolo)
        // .40 left this class UNDER the window (the white-screen mechanism); .41 parks it above.
        assertEquals(SoloVideoLayer.Mode.STATIC_ABOVE, r.composition)
        assertEquals(SilentUpdate.TAP, r.silentUpdate)
    }

    @Test fun novaStarTaurusIsNeverNativeWhateverTheStringsOrSwitchesSay() {
        for (f in listOf(taurus, taurus.copy(model = "Taurus TB40", board = "rk3399"), Facts(sdk = 30, posterClass = true), Facts(sdk = 33, manufacturer = "NovaStar"))) {
            val r = DeviceClassPolicy.resolve(f)
            assertEquals(Soc.NOVASTAR, r.soc)
            assertFalse(r.nativeSolo)
            assertNull(r.composition)
            assertNull(r.composition(2, 0))
            assertEquals(SoloVideoLayer.REASON_COMPOSITION_UNAVAILABLE, r.refusal(2, 0))
            assertFalse(r.protocol3)
            assertEquals(SilentUpdate.TAP, r.silentUpdate)
            assertTrue(r.fleet!!.contains("Taurus"))
        }
    }

    @Test fun positionedSlotsRunWhereverSoloDoesOnTheSameContractAndNowhereElse() {
        // Owner rule 2026-10-17: the best engine for the viewer on every class; web is the fallback.
        for (f in listOf(t982a13, t982a11, rk3288a7, rk3328a11, android9)) {
            val r = DeviceClassPolicy.resolve(f)
            assertTrue(r.nativeSolo)
            assertTrue(r.protocol3)
            assertEquals(3, r.protocolMax)
            for (face in 0..1) {
                assertEquals(SoloVideoLayer.Mode.STATIC_ABOVE, r.composition(3, face))
                assertNull(r.refusal(3, face))
                assertNull(r.refusal(2, face))
            }
            assertNull(r.composition(1, 0))
            assertEquals(SoloVideoLayer.REASON_COMPOSITION_UNAVAILABLE, r.refusal(1, 0))
        }
        val t = DeviceClassPolicy.resolve(taurus)
        assertFalse(t.protocol3)
        assertEquals(2, t.protocolMax)
        assertEquals(SoloVideoLayer.REASON_COMPOSITION_UNAVAILABLE, t.refusal(3, 0))
        // A face this box cannot host is refused as composition.
        assertEquals(SoloVideoLayer.REASON_COMPOSITION_UNAVAILABLE, DeviceClassPolicy.resolve(t982a13).refusal(2, 2))
        assertEquals(SoloVideoLayer.REASON_COMPOSITION_UNAVAILABLE, DeviceClassPolicy.resolve(t982a13).refusal(3, 2))
    }

    @Test fun anUnlistedBoxGetsTheSdkRuleAndNoFleetLabel() {
        val r = DeviceClassPolicy.resolve(Facts(sdk = 29, webviewMajor = 0, hardware = "mt8183", manufacturer = "MediaTek"))
        assertEquals("other/android-10", r.className)
        assertNull(r.fleet)
        assertEquals(SoloVideoLayer.Mode.STATIC_ABOVE, r.composition)
        assertEquals(SilentUpdate.TAP, r.silentUpdate)
        assertEquals(0, r.webviewMajor)
    }

    @Test fun socIsReadFromAnyBuildStringAndTaurusWinsOverItsRockchipReferenceStrings() {
        assertEquals(Soc.ROCKCHIP, DeviceClassPolicy.soc(Facts(sdk = 25, model = "RK3288")))
        assertEquals(Soc.ROCKCHIP, DeviceClassPolicy.soc(Facts(sdk = 25, hardware = "Rockchip")))
        assertEquals(Soc.AMLOGIC, DeviceClassPolicy.soc(Facts(sdk = 30, device = "t982_ar301")))
        assertEquals(Soc.AMLOGIC, DeviceClassPolicy.soc(Facts(sdk = 30, hardware = "amlogic")))
        assertEquals(Soc.AMLOGIC, DeviceClassPolicy.soc(Facts(sdk = 30, manufacturer = "Amlogic")))
        assertEquals(Soc.NOVASTAR, DeviceClassPolicy.soc(Facts(sdk = 30, hardware = "rk30board", board = "rk3568")))
        assertEquals(Soc.NOVASTAR, DeviceClassPolicy.soc(Facts(sdk = 30, model = "Taurus TB60")))
        for (name in listOf("", "mediatek", "spark3288", "rkboard", "vendor-rockchip", "qcom")) {
            assertEquals(name, Soc.OTHER, DeviceClassPolicy.soc(Facts(sdk = 28, hardware = name, board = name, model = name)))
        }
    }

    @Test fun theReportIsBoundedAndCarriesEveryPolicyColumn() {
        val j = DeviceClassPolicy.resolve(rk3288a7).toJson()
        assertEquals("rockchip/android-7", j.getString("class"))
        assertEquals("rockchip", j.getString("soc"))
        assertEquals(25, j.getInt("sdk"))
        assertEquals(87, j.getInt("webviewMajor"))
        assertTrue(j.getBoolean("nativeSolo"))
        assertEquals("static_above", j.getString("composition"))
        assertTrue(j.getBoolean("protocol3"))
        assertEquals("tap", j.getString("silentUpdate"))
        assertTrue(j.isNull("qualified"))
        assertTrue(j.getString("fleet").length <= 96)
        assertTrue(DeviceClassPolicy.resolve(taurus).toJson().isNull("composition"))
        assertEquals("installer-of-record", DeviceClassPolicy.resolve(t982a13).toJson().getString("silentUpdate"))
        assertEquals(setOf("INSTALLER_OF_RECORD", "TAP"), SilentUpdate.values().map { it.name }.toSet())
    }

    @Test fun webviewMajorAndAndroidMajorReadWhatTheyCanAndNeverInvent() {
        assertEquals(101, DeviceClassPolicy.webviewMajor("101.0.4951.61"))
        assertEquals(66, DeviceClassPolicy.webviewMajor(" 66.0.3359.158 "))
        assertEquals(0, DeviceClassPolicy.webviewMajor(null))
        assertEquals(0, DeviceClassPolicy.webviewMajor("chrome"))
        assertEquals(13, DeviceClassPolicy.androidMajor(33))
        assertEquals(11, DeviceClassPolicy.androidMajor(30))
        assertEquals(9, DeviceClassPolicy.androidMajor(28))
        assertEquals(7, DeviceClassPolicy.androidMajor(25))
        assertEquals(14, DeviceClassPolicy.androidMajor(34))
        assertEquals(0, DeviceClassPolicy.androidMajor(23))
    }
}
