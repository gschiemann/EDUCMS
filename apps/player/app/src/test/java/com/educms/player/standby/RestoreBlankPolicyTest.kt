package com.educms.player.standby

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assume
import org.junit.Test
import java.io.File

/**
 * The after-alert restore must never take a latch-prone lock where one has
 * latched (2026-10-11). 2026-08-25: device-admin lockNow latched a G43
 * (Android 11 iFPDOS) and a Mobile A-Frame (Android 7.1) into a vendor
 * standby that ignored WAKE — i.e. the next alert could not have reached the
 * glass. The L55VEC (Android 13) recovered.
 */
class RestoreBlankPolicyTest {

    @Test
    fun `mechanisms that cannot latch are always allowed`() {
        for (id in listOf("screen-timeout", "software-dim", "vendor-recipe", "novastar-sdk")) {
            assertTrue(id, RestoreBlankPolicy.allows(id, 25, "rk3288"))
            assertTrue(id, RestoreBlankPolicy.allows(id, 30, "X80"))
        }
    }

    @Test
    fun `the lock family is refused below Android 13 — the two latched panels`() {
        for (id in RestoreBlankPolicy.LOCK_FAMILY) {
            assertFalse("$id on Android 7.1", RestoreBlankPolicy.allows(id, 25, "rk3288"))
            assertFalse("$id on Android 11", RestoreBlankPolicy.allows(id, 30, "G43"))
            assertFalse("$id on Android 9", RestoreBlankPolicy.allows(id, 28, "FUH43"))
        }
    }

    @Test
    fun `Android 13 keeps its real sleep`() {
        for (id in RestoreBlankPolicy.LOCK_FAMILY) {
            assertTrue(RestoreBlankPolicy.allows(id, 33, "L55VEC"))
            assertTrue(RestoreBlankPolicy.allows(id, 34, "M43"))
        }
    }

    @Test
    fun `no model is proven by default — only a supervised on-site test adds one`() {
        assertTrue(RestoreBlankPolicy.LOCK_RESTORE_PROVEN_MODELS.isEmpty())
    }

    @Test
    fun `the restore passes the policy to the registry, which honours it on the resolved provider and the fall-through`() {
        var dir: File? = File("").absoluteFile
        var root: File? = null
        while (dir != null) {
            if (File(dir, "src/main/AndroidManifest.xml").isFile) { root = dir; break }
            if (File(dir, "app/src/main/AndroidManifest.xml").isFile) { root = File(dir, "app"); break }
            dir = dir.parentFile
        }
        Assume.assumeTrue("module root not on disk", root != null)
        val standby = File(root, "src/main/java/com/educms/player/standby/UserStandby.kt").readText()
        val restore = Regex("fun restoreAfterAlertIfDue\\([\\s\\S]*?\\n    }").find(standby)?.value
        Assume.assumeTrue("restoreAfterAlertIfDue() not found", restore != null)
        assertTrue(restore!!.contains("RestoreBlankPolicy.allows(id, android.os.Build.VERSION.SDK_INT, android.os.Build.MODEL)"))
        // Exactly one native BLANK in the restore, and it is the filtered one.
        assertTrue(Regex("DisplayAction\\.Blank").findAll(restore).count() == 1)

        val registry = File(root, "src/main/java/com/educms/player/display/DisplayControlRegistry.kt").readText()
        assertTrue(registry.contains("allowProvider == null || resolved == null || allowProvider(resolved.id)"))
        assertTrue(registry.contains("if (allowProvider != null && !allowProvider(next.id)) continue"))
        // The emergency gate still runs first, before any provider is chosen.
        val gate = registry.indexOf("DisplayEmergency.refusalReason(app, action)")
        val choose = registry.indexOf("val resolved = resolve(app)[action.capability]")
        assertTrue(gate in 0 until choose)
    }
}
