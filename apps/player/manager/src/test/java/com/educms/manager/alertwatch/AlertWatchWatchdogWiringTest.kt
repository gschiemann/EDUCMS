package com.educms.manager.alertwatch

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.io.File

/**
 * THE ALERT-WATCH WATCHDOG — the wiring, as source facts (2026-11-08, wave 5).
 *
 * The policy test proves the rules; this proves the rules are in front of a
 * real caller, and — the part that matters — that the Android half can only
 * ADD a recovery path: no Activity launch (the panel stays dark), no reboot,
 * nothing that reaches the emergency hold, nothing posted to the server.
 * Skipped, not failed, when the sources are not on disk (the Player module's
 * wiring tests have the same shape).
 */
class AlertWatchWatchdogWiringTest {

    private fun source(relative: String): String? {
        val candidates = listOf(
            File("src/main/$relative"),
            File("manager/src/main/$relative"),
            File("apps/player/manager/src/main/$relative"),
        )
        return candidates.firstOrNull { it.isFile }?.readText()
    }

    /** Kotlin source with comments removed, so a fact is never satisfied by prose. */
    private fun code(src: String): String =
        src.replace(Regex("/\\*[\\s\\S]*?\\*/"), "").lines().joinToString("\n") { it.substringBefore("//") }

    private fun watchdog(): String {
        val src = source("java/com/educms/manager/alertwatch/AlertWatchWatchdog.kt")
        assumeTrue("AlertWatchWatchdog.kt not on disk", src != null)
        return code(src!!)
    }

    @Test
    fun `the watchdog never launches an Activity, reboots, or reaches a hold`() {
        val src = watchdog()
        for (forbidden in listOf(
            "startActivity", "getLaunchIntentForPackage", "Api34BalLauncher", "FLAG_ACTIVITY_NEW_TASK",
            "reboot", "DevicePolicyManager", "setHold", "all-clear", "allClear", "emergencyHold", "DisplayEmergency",
            "HttpURLConnection", "openConnection", "WAKE_LOCK", "newWakeLock", "FLAG_TURN_SCREEN_ON",
        )) {
            assertFalse("AlertWatchWatchdog reaches `$forbidden`", src.contains(forbidden))
        }
    }

    @Test
    fun `its one message to the Player is the signature-protected kick to the kick receiver`() {
        val src = watchdog()
        assertEquals(1, Regex("sendBroadcast\\(").findAll(src).count())
        assertTrue(src.contains("sendBroadcast(intent, HEALTH_PERMISSION)"))
        assertTrue(src.contains("setComponent(ComponentName(pkg, PLAYER_RECEIVER_CLASS))"))
        assertEquals("com.educms.player.ALERT_WATCH_KICK", AlertWatchWatchdog.ACTION_KICK)
        assertEquals("com.educms.player.alertwatch.AlertWatchKickReceiver", AlertWatchWatchdog.PLAYER_RECEIVER_CLASS)
        assertEquals(setOf("rearm", "restart-host"), setOf(AlertWatchWatchdog.STEP_REARM, AlertWatchWatchdog.STEP_RESTART_HOST))
    }

    @Test
    fun `the Manager holds the permission the Player's receiver requires of the sender`() {
        val manifest = source("AndroidManifest.xml")
        assumeTrue("manifest not on disk", manifest != null)
        assertTrue(manifest!!.contains("<uses-permission android:name=\"com.educms.manager.HEALTH_PERMISSION\" />"))
    }

    @Test
    fun `WatchdogService ticks it after and apart from the liveness check`() {
        val svc = source("java/com/educms/manager/WatchdogService.kt")
        assumeTrue("WatchdogService.kt not on disk", svc != null)
        val body = code(svc!!)
        val liveness = body.indexOf("checkHeartbeat()")
        val ours = body.indexOf("AlertWatchWatchdog.tick(applicationContext)")
        assertTrue(liveness >= 0 && ours > liveness)
        // Isolated: inside its own try, so a fault never costs the liveness tick its postDelayed.
        val between = body.substring(liveness, ours)
        assertTrue(between.contains("try {"))
    }

    @Test
    fun `the provider exposes the stamp and the record under the same permission`() {
        val provider = source("java/com/educms/manager/PlayerHealthProvider.kt")
        assumeTrue("PlayerHealthProvider.kt not on disk", provider != null)
        val body = code(provider!!)
        assertTrue(body.contains("addURI(AUTHORITY, PATH_ALERT_WATCH, CODE_ALERT_WATCH)"))
        assertTrue(body.contains("addURI(AUTHORITY, PATH_ALERT_WATCH_WATCHDOG, CODE_ALERT_WATCH_WATCHDOG)"))
        assertTrue(body.contains("AlertWatchStore.writeStamp"))
        assertTrue(body.contains("AlertWatchStore.recordCursor"))
        val manifest = source("AndroidManifest.xml")!!
        // One provider, one permission: nothing new is exported.
        assertEquals(1, Regex("<provider").findAll(manifest).count())
        assertTrue(manifest.contains("android:permission=\"com.educms.manager.HEALTH_PERMISSION\"\n            android:grantUriPermissions=\"false\""))
    }
}
