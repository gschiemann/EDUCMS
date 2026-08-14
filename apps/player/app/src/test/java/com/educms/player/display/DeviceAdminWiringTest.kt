package com.educms.player.display

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assume
import org.junit.Test
import java.io.File

/**
 * ⚠️ THE CALL-SITE GUARD.
 *
 * THE DEFINING FAILURE OF THIS FEATURE, so it cannot happen a third
 * time: two build waves and two review waves shipped the display-control
 * layer with 112 PASSING TESTS while it was completely disconnected —
 * everything compiled, everything was covered, and no screen could
 * execute any of it, because nothing ever CALLED it.
 *
 * Unit tests of a state machine cannot catch that: a function nothing
 * calls passes its tests perfectly. So this suite asserts the WIRING —
 * that the receiver is declared, that its policy set is force-lock and
 * nothing else, and that every entry point has a real caller. It reads
 * the source tree, exactly like the web side's `nativeBridge.test.ts`
 * drift guard reads `NativeBridgeChannel.kt` off disk.
 *
 * Skipped (not failed) when the sources are not on disk, so a jar-only
 * checkout still runs green.
 */
class DeviceAdminWiringTest {

    private val moduleRoot: File? by lazy {
        var dir: File? = File("").absoluteFile
        while (dir != null) {
            if (File(dir, "src/main/AndroidManifest.xml").isFile) return@lazy dir
            val nested = File(dir, "app/src/main/AndroidManifest.xml")
            if (nested.isFile) return@lazy File(dir, "app")
            dir = dir.parentFile
        }
        null
    }

    private fun source(relative: String): String? {
        val root = moduleRoot ?: return null
        val f = File(root, relative)
        return if (f.isFile) f.readText() else null
    }

    private fun require(relative: String): String {
        val src = source(relative)
        Assume.assumeTrue("source not on disk: $relative", src != null)
        return src!!
    }

    // ─── the receiver actually ships ────────────────────────────────

    @Test
    fun `the manifest declares the Player's own DeviceAdminReceiver`() {
        val manifest = require("src/main/AndroidManifest.xml")
        assertTrue(
            "without a Player-owned DeviceAdminReceiver, lockNow() is illegal for us and " +
                "DeviceAdminBlankProvider can never resolve — the exact gap this wave closes",
            manifest.contains(".display.PlayerAdminReceiver"),
        )
        assertTrue(
            "the system sends DEVICE_ADMIN_ENABLED; BIND_DEVICE_ADMIN is what guarantees only it can",
            manifest.contains("android.permission.BIND_DEVICE_ADMIN"),
        )
        assertTrue(
            "the receiver is invisible to the platform without the android.app.device_admin meta-data",
            manifest.contains("android.app.device_admin"),
        )
        assertTrue(
            "the meta-data must point at OUR policy file, not the Manager's",
            manifest.contains("@xml/player_device_admin"),
        )
        assertTrue(
            "DEVICE_ADMIN_ENABLED is delivered by the system, so the receiver must be exported",
            manifest.contains("android.app.action.DEVICE_ADMIN_ENABLED"),
        )
    }

    @Test
    fun `the policy set is force-lock and NOTHING else`() {
        val raw = require("src/main/res/xml/player_device_admin.xml")
        // Strip XML comments FIRST. The file's own header explains why we
        // do not declare wipe-data, and a naive substring scan over the
        // prose fails on the very sentence that documents the rule — the
        // assertions below are about what the PLATFORM parses, so the
        // comments must not be part of the input.
        val xml = raw.replace(Regex("""<!--[\s\S]*?-->"""), "")
        assertTrue("lockNow() needs force-lock", xml.contains("<force-lock"))
        // Every extra policy is extra scary text in the dialog the
        // operator has to approve, and we call none of them. The
        // Manager's device_admin.xml declares wipe-data purely to be
        // device-owner-eligible; we are deliberately not doing that.
        assertFalse("we never call wipeData() — do not ask for it", xml.contains("wipe-data"))
        assertFalse(xml.contains("reset-password"))
        assertFalse(xml.contains("encrypted-storage"))
        assertFalse(xml.contains("disable-camera"))
        assertFalse(xml.contains("watch-login"))
        assertFalse(xml.contains("limit-password"))
        assertFalse(xml.contains("disable-keyguard-features"))
        assertTrue(
            "visible=true is what puts us in Settings > Security > Device admin apps — " +
                "the one enrolment path that needs no adb, no dashboard and no web deploy",
            Regex("""android:visible\s*=\s*"true"""").containsMatchIn(xml),
        )
    }

    // ─── every entry point has a caller ─────────────────────────────

    @Test
    fun `the blank provider resolves off OUR admin component, not any active admin`() {
        val provider = require("src/main/java/com/educms/player/display/DeviceAdminBlankProvider.kt")
        assertTrue(
            "the force-lock policy is scoped to the CALLING package — a vendor CMS's admin " +
                "grants us nothing, so 'any active admin' is the mis-reading that ships a " +
                "blank button which always throws SecurityException",
            provider.contains("PlayerAdminReceiver.componentName") && provider.contains("isAdminActive"),
        )
        // The one-way-blank trap: lockNow() also engages the keyguard,
        // and a SECURE keyguard cannot be dismissed remotely, so the
        // screen would wake to a lock screen instead of the content.
        assertTrue(
            "supports() must decline this tier when a real screen lock is set",
            provider.contains("secureKeyguardBlocks") && provider.contains("isDeviceSecure"),
        )
        val supportsAt = provider.indexOf("override fun supports")
        val applyAt = provider.indexOf("private fun blank")
        assertTrue(
            "the keyguard check must gate supports() AND be re-checked at apply time — " +
                "the registry caches its resolution and an operator can set a lock afterwards",
            provider.indexOf("secureKeyguardBlocks", supportsAt) in supportsAt until applyAt &&
                provider.indexOf("secureKeyguardBlocks", applyAt) > applyAt,
        )
    }

    @Test
    fun `enrolment completing re-resolves the provider chain without a process restart`() {
        val receiver = require("src/main/java/com/educms/player/display/PlayerAdminReceiver.kt")
        assertTrue(
            "onEnabled is the only hook that fires when the operator enables us from " +
                "Settings rather than from our dialog",
            receiver.contains("DeviceAdminEnrollment.onAdminEnabled"),
        )
        assertTrue(receiver.contains("DeviceAdminEnrollment.onAdminDisabled"))

        val enrollment = require("src/main/java/com/educms/player/display/DeviceAdminEnrollment.kt")
        assertTrue(
            "DisplayControlRegistry caches capability->provider for the life of the process; " +
                "without an invalidate the tier stays invisible until the process next dies",
            enrollment.contains("DisplayControlRegistry.invalidate"),
        )

        val main = require("src/main/java/com/educms/player/MainActivity.kt")
        assertTrue(
            "onResume is where an ACTION_ADD_DEVICE_ADMIN round trip lands",
            main.contains("DeviceAdminEnrollment.settlePending"),
        )
        // Ordering is load-bearing: settle first, so a successful
        // enrolment is already reflected when the registry re-resolves
        // in the SAME resume.
        val settleAt = main.indexOf("DeviceAdminEnrollment.settlePending")
        val invalidateAt = main.indexOf("DisplayControlRegistry.invalidate", settleAt)
        assertTrue("settlePending must run before the registry invalidate", invalidateAt > settleAt)
    }

    @Test
    fun `the enrolment prompt is reachable from the web bridge AND from a field intent`() {
        val bridge = require("src/main/java/com/educms/player/WebAppBridge.kt")
        assertTrue(
            "a bridge method with no @JavascriptInterface is invisible to the web layer",
            bridge.contains("fun displayEnrollAdmin"),
        )
        assertTrue(bridge.contains("displayEnrollAdminImpl"))

        val main = require("src/main/java/com/educms/player/MainActivity.kt")
        assertTrue(
            "the bridge lambda must be WIRED at the WebAppBridge construction site, " +
                "or the method returns the {\"ok\":false,\"code\":\"unavailable\"} default forever",
            main.contains("displayEnrollAdminImpl ="),
        )
        assertTrue(
            "requestEnrollment is the only thing that fires ACTION_ADD_DEVICE_ADMIN",
            main.contains("DeviceAdminEnrollment.requestEnrollment"),
        )
        assertTrue(main.contains("ACTION_ENROLL_DISPLAY_ADMIN"))
        assertTrue(
            "the field-ops intent must be handled on BOTH the cold-start and the " +
                "singleTask relaunch path",
            main.contains("handleDeviceAdminEnrollIntent"),
        )

        val enrollment = require("src/main/java/com/educms/player/display/DeviceAdminEnrollment.kt")
        assertTrue(
            enrollment.contains("DevicePolicyManager.ACTION_ADD_DEVICE_ADMIN"),
        )
        assertTrue(
            "EXTRA_ADD_EXPLANATION is the honest sentence the operator reads above the dialog",
            enrollment.contains("DevicePolicyManager.EXTRA_ADD_EXPLANATION"),
        )
    }

    @Test
    fun `nothing on a boot or background path can raise the dialog`() {
        // The rule: enrolment is explicit and operator-initiated. A
        // signage box that pops a system security dialog on a wall in
        // front of customers is worse than a screen that dims in
        // software. `requestEnrollment` takes an Activity precisely so
        // this stays structurally true — this guard is what notices if
        // somebody adds a Context overload and calls it from boot.
        val enrollment = require("src/main/java/com/educms/player/display/DeviceAdminEnrollment.kt")
        assertTrue(
            "requestEnrollment must require an Activity, never a bare Context",
            Regex("""fun requestEnrollment\(\s*activity: Activity""").containsMatchIn(enrollment),
        )

        val callers = listOf(
            "src/main/java/com/educms/player/PlayerApp.kt",
            "src/main/java/com/educms/player/BootReceiver.kt",
            "src/main/java/com/educms/player/display/DisplayScheduler.kt",
            "src/main/java/com/educms/player/display/DisplayScheduleReceiver.kt",
            "src/main/java/com/educms/player/display/DisplayControlApi.kt",
            "src/main/java/com/educms/player/display/DisplayControlRegistry.kt",
            "src/main/java/com/educms/player/watchdog/Watchdog.kt",
        )
        callers.forEach { path ->
            val src = source(path) ?: return@forEach
            assertFalse(
                "$path must never raise the enrolment dialog — enrolment is operator-initiated only",
                src.contains("requestEnrollment"),
            )
        }
    }

    @Test
    fun `the probe reports enrolment and stays read-only`() {
        val probe = require("src/main/java/com/educms/player/display/DisplayCapabilityProbe.kt")
        assertTrue(
            "the dashboard needs to see which screens are one tap away from a real blank",
            probe.contains("DeviceAdminEnrollment.probeJson"),
        )
        assertTrue(probe.contains("selfIsActiveAdmin"))
        assertFalse(
            "the probe's safety contract is that it only observes — settling writes prefs",
            probe.contains("settlePending"),
        )
        assertFalse(
            "and it must never raise a dialog",
            probe.contains("requestEnrollment"),
        )
    }
}
