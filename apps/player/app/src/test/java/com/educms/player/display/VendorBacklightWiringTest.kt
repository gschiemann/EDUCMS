package com.educms.player.display

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assume
import org.junit.Test
import java.io.File

/**
 * THE VENDOR BACKLIGHT — THE WIRING, as source facts (player 1.1.52).
 *
 * [VendorBacklightPolicyTest] and [VendorBacklightEngineTest] prove the rules
 * and the sequence; this proves they are plugged in where they must be and
 * nowhere they must not: the chain position, the alert path asking for the
 * backlight BEFORE its first window hook, the native alert watch treating a
 * vendor-dark panel as dark, the manifest's `<queries>`, the process start,
 * and no new bridge method. Same shape as `UserStandbyWiringTest`: skipped
 * (not failed) when the sources are not on disk.
 */
class VendorBacklightWiringTest {

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

    private fun read(relative: String): String {
        val root = moduleRoot
        Assume.assumeTrue("module root not on disk", root != null)
        val f = File(root, relative)
        Assume.assumeTrue("source not on disk: $relative", f.isFile)
        return f.readText()
    }

    /** Kotlin source with comments removed, so a fact is never satisfied by prose. */
    private fun code(src: String): String =
        src.replace(Regex("/\\*[\\s\\S]*?\\*/"), "").lines().joinToString("\n") { it.substringBefore("//") }

    private fun body(src: String, signature: String): String {
        val at = src.indexOf(signature)
        assertTrue("`$signature` not found", at >= 0)
        val next = Regex("\\n\\s*(private |internal |override |public )?(suspend )?fun ").find(src, at + signature.length)
        return src.substring(at, next?.range?.first ?: src.length)
    }

    private val registry get() = code(read("src/main/java/com/educms/player/display/DisplayControlRegistry.kt"))
    private val emergency get() = code(read("src/main/java/com/educms/player/display/DisplayEmergency.kt"))
    private val watch get() = code(read("src/main/java/com/educms/player/alertwatch/NativeAlertWatch.kt"))
    private val provider get() = code(read("src/main/java/com/educms/player/display/VendorBacklightProvider.kt"))
    private val playerApp get() = code(read("src/main/java/com/educms/player/PlayerApp.kt"))
    private val manifest get() = read("src/main/AndroidManifest.xml")
    private val bridge get() = code(read("src/main/java/com/educms/player/WebAppBridge.kt"))

    @Test
    fun `the provider heads the sleeping mechanisms in BOTH chains, behind an explicit vendor recipe`() {
        for (cap in listOf("BLANK", "WAKE")) {
            val chain = Regex("Capability\\.$cap\\s+to\\s+listOf\\(([\\s\\S]*?)\\)\\s*,").find(registry)!!.groupValues[1]
            val names = chain.split(',').map { it.trim() }.filter { it.endsWith("Provider") }
            val vb = names.indexOf("VendorBacklightProvider")
            assertTrue("$cap chain has the vendor backlight", vb >= 0)
            assertTrue("$cap: an explicit recipe wins over auto-detection", names.indexOf("VendorRecipeProvider") < vb)
            assertTrue("$cap: ahead of the device-admin lock", vb < names.indexOf("DeviceAdminBlankProvider"))
            assertTrue("$cap: ahead of the accessibility lock", vb < names.indexOf("AccessibilityLockProvider"))
            assertTrue("$cap: ahead of the screen-off timeout", vb < names.indexOf("ScreenTimeoutBlankProvider"))
        }
        // BRIGHTNESS is not its business.
        val brightness = Regex("Capability\\.BRIGHTNESS\\s+to\\s+listOf\\(([\\s\\S]*?)\\)\\s*,").find(registry)!!.groupValues[1]
        assertFalse(brightness.contains("VendorBacklightProvider"))
    }

    @Test
    fun `a failed vendor blank's fall-through is filtered by the latch rule`() {
        val apply = body(registry, "fun apply(")
        assertTrue(apply.contains("VendorBacklightPolicy.fallThroughAllows("))
    }

    @Test
    fun `the alert path asks for the backlight BEFORE its first window hook and never waits for it`() {
        val enforce = body(emergency, "fun enforceNow(")
        val on = enforce.indexOf("VendorBacklightProvider.emergencyOn(")
        val hooks = enforce.indexOf("DisplayWindowBridge.withHooks")
        val registryWake = enforce.indexOf("DisplayAction.Wake")
        assertTrue("emergencyOn is called", on >= 0)
        assertTrue("before the window hooks", on < hooks)
        assertTrue("before the registry wake", on < registryWake)
        // Wrapped so a throw can never stop the drawing below it.
        assertTrue(Regex("runCatching\\s*\\{\\s*VendorBacklightProvider\\.emergencyOn\\(").containsMatchIn(enforce))
        // And the provider's emergencyOn only queues — no `.get(` wait, no blocking join.
        val eo = body(provider, "fun emergencyOn(")
        assertFalse(eo.contains(".get("))
        assertFalse(eo.contains("join("))
        assertFalse(eo.contains("await("))
    }

    @Test
    fun `the provider is reached only through the registry and the ON direction of the alert path`() {
        // The registry names it in its chains (and calls it only as a
        // DisplayControlProvider). Beyond that, nothing calls INTO the
        // provider except: the emergency interlock (ON direction), the sleep
        // proof and the alert watch (read-only facts), the bridge API (the
        // kill-switch config change) and the app's start.
        val root = moduleRoot!!
        val callers = File(root, "src/main/java").walkTopDown()
            .filter { it.isFile && it.extension == "kt" && it.name != "VendorBacklightProvider.kt" }
            .filter { code(it.readText()).contains("VendorBacklightProvider.") }
            .map { it.name }
            .toSet()
        assertTrue(callers.toString(), callers == setOf(
            "DisplayEmergency.kt", "SleepProof.kt", "NativeAlertWatch.kt", "DisplayControlApi.kt", "PlayerApp.kt",
        ))
        assertTrue(registry.contains("VendorBacklightProvider,"))
        assertFalse(registry.contains("VendorBacklightProvider.apply("))
        // The emergency interlock never asks it to darken.
        assertFalse(emergency.contains("VendorBacklightProvider.apply("))
        assertFalse(Regex("VendorBacklightProvider\\.[a-zA-Z]*[Bb]lank").containsMatchIn(emergency))
    }

    @Test
    fun `the native alert watch treats a vendor-dark panel as dark`() {
        val interactive = body(watch, "override fun panelInteractive()")
        assertTrue(interactive.contains("VendorBacklightProvider.isDarkByUs()"))
        // It reads; it never drives the backlight.
        assertFalse(watch.contains("VendorBacklightProvider.apply("))
        assertFalse(watch.contains("VendorBacklightProvider.emergencyOn("))
    }

    @Test
    fun `a change of the dark record kicks the alert watch`() {
        val dark = body(provider, "override fun darkChanged(")
        assertTrue(dark.contains("NativeAlertWatch.kick("))
    }

    @Test
    fun `the blank keeps Android awake — it never drops KEEP_SCREEN_ON`() {
        val apply = body(provider, "override fun apply(")
        assertFalse(apply.contains("setKeepScreenOn(false)"))
    }

    @Test
    fun `the manifest lets this app see and bind the vendor service on API 30+`() {
        val queries = Regex("<queries>([\\s\\S]*?)</queries>").find(manifest)!!.groupValues[1]
        assertTrue(queries.contains("<package android:name=\"com.seewo.mcuservice\" />"))
        assertTrue(queries.contains("<action android:name=\"com.ifpdos.opensdk.SERVICE_MANAGER\" />"))
    }

    @Test
    fun `the probe starts with the process, never on the main thread's critical path`() {
        assertTrue(playerApp.contains("VendorBacklightProvider.start(this)"))
        assertTrue(Regex("runCatching\\s*\\{\\s*com\\.educms\\.player\\.display\\.VendorBacklightProvider\\.start\\(this\\)").containsMatchIn(playerApp))
        val start = body(provider, "fun start(")
        assertTrue(start.contains("submitQuietly("))
        assertFalse(start.contains(".get("))
    }

    @Test
    fun `the provider id is the literal the API's drift guard parses, and equals the policy constant`() {
        assertTrue(provider.contains("override val id: String = \"${VendorBacklightPolicy.PROVIDER_ID}\""))
        assertTrue(VendorBacklightPolicy.PROVIDER_ID == "vendor-backlight")
    }

    @Test
    fun `no new bridge method — BLANK and WAKE ride the existing displayApply`() {
        assertFalse(bridge.contains("vendorBacklight"))
        assertFalse(bridge.contains("VendorBacklight"))
    }

    @Test
    fun `a kill switch that lands while the backlight is off lights it before stepping aside`() {
        val api = code(read("src/main/java/com/educms/player/display/DisplayControlApi.kt"))
        assertTrue(body(api, "fun setScheduleJson(").contains("VendorBacklightProvider.onConfigChanged(app)"))
        val changed = body(provider, "fun onConfigChanged(")
        assertTrue(changed.contains("e.wake()"))
        assertTrue(changed.contains("DisplayEmergency.isHeld(a)"))
    }
}
