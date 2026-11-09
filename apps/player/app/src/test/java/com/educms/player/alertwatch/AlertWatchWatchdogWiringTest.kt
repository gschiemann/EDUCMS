package com.educms.player.alertwatch

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assume
import org.junit.Test
import java.io.File

/**
 * THE MANAGER'S KICK AND THE STAMP — the Player-side wiring, as source facts
 * (2026-11-08, Manager wave 5). Same shape as NativeAlertWatchWiringTest:
 * skipped, not failed, when the sources are not on disk.
 *
 * What it pins: the receiver is reachable only by a package holding our
 * signature permission; it can only START the watch (never the Activity,
 * never the hold); the stamp is written after every pass and the Manager's
 * verdict rides the heartbeat under the device credential; and the Manager's
 * side agrees with ours on the action, the receiver class and the columns.
 */
class AlertWatchWatchdogWiringTest {

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

    private fun managerSource(relative: String): String? {
        val root = moduleRoot ?: return null
        val f = File(root.parentFile, "manager/src/main/$relative")
        return f.takeIf { it.isFile }?.readText()
    }

    private fun code(src: String): String =
        src.replace(Regex("/\\*[\\s\\S]*?\\*/"), "").lines().joinToString("\n") { it.substringBefore("//") }

    private val pkg = "src/main/java/com/educms/player"
    private val receiver get() = code(read("$pkg/alertwatch/AlertWatchKickReceiver.kt"))
    private val stamp get() = code(read("$pkg/alertwatch/AlertWatchStamp.kt"))
    private val watch get() = code(read("$pkg/alertwatch/NativeAlertWatch.kt"))
    private val heartbeat get() = code(read("$pkg/heartbeat/HeartbeatService.kt"))
    private val manifest get() = read("src/main/AndroidManifest.xml")

    @Test
    fun `the kick receiver is exported behind the signature permission`() {
        val m = manifest
        val at = m.indexOf("android:name=\".alertwatch.AlertWatchKickReceiver\"")
        assertTrue("receiver declared", at >= 0)
        val decl = m.substring(at, m.indexOf("</receiver>", at))
        assertTrue(decl.contains("android:exported=\"true\""))
        assertTrue(decl.contains("android:permission=\"com.educms.manager.HEALTH_PERMISSION\""))
        assertTrue(decl.contains("<action android:name=\"com.educms.player.ALERT_WATCH_KICK\" />"))
        // …and the Player holds that permission (it already did, for the heartbeat provider).
        assertTrue(m.contains("<uses-permission android:name=\"com.educms.manager.HEALTH_PERMISSION\" />"))
    }

    @Test
    fun `the kick can only start the watch - never the Activity, never the hold`() {
        val src = receiver
        for (forbidden in listOf(
            "startActivity", "MainActivity", "RelaunchEscalation", "FLAG_ACTIVITY_NEW_TASK", "getLaunchIntentForPackage",
            "setHold", "raiseFromNativeWatch", "DisplayEmergency", "displayEmergencyHold", "DisplayPrefs", "reboot",
            "FLAG_TURN_SCREEN_ON", "newWakeLock",
        )) {
            assertFalse("AlertWatchKickReceiver reaches `$forbidden`", src.contains(forbidden))
        }
        assertTrue(src.contains("NativeAlertWatch.ensureStarted(app)"))
        assertTrue(src.contains("HeartbeatService.ensureRunning(app)"))
        // A step it does not know is a plain re-arm — never an escalation.
        assertTrue(src.contains("?: STEP_REARM"))
    }

    @Test
    fun `the stamp decides nothing and cannot reach the hold`() {
        val src = stamp
        for (forbidden in listOf("setHold", "raiseFromNativeWatch", "DisplayEmergency", "displayEmergencyHold", "DisplayPrefs", "startActivity", "kick(", "ensureStarted")) {
            assertFalse("AlertWatchStamp reaches `$forbidden`", src.contains(forbidden))
        }
    }

    @Test
    fun `the watch stamps after every pass, with the facts the pass used`() {
        val src = watch
        val loop = src.substring(src.indexOf("private suspend fun runLoop("), src.indexOf("private class AndroidPorts"))
        val passAt = loop.indexOf("machine.pass()")
        val stampAt = loop.indexOf("stamp(app, machine)")
        assertTrue("stamp follows the pass", passAt >= 0 && stampAt > passAt)
        assertTrue("…before the loop decides whether to leave", stampAt < loop.indexOf("if (sleepMs == null)"))
        val fn = src.substring(src.indexOf("private fun stamp("), src.indexOf("private suspend fun runLoop("))
        assertTrue(fn.contains("p.panelInteractive()"))
        assertTrue(fn.contains("p.holdHeld()"))
        assertTrue(fn.contains("machine.status"))
        assertTrue(fn.contains("alertWatchWatchdogMode"))
        // The stamp is the only new thing the watch does: still exactly one write to the interlock.
        assertEquals(1, Regex("DisplayEmergency\\.raiseFromNativeWatch\\(").findAll(src).count())
    }

    @Test
    fun `the Manager's verdict rides the native heartbeat under the device credential`() {
        val src = heartbeat
        val at = src.indexOf("AlertWatchStamp.watchdogReportHeader(applicationContext)")
        assertTrue(at >= 0)
        // Gated like every other native report: only with the credential, inside its own runCatching.
        val before = src.substring(maxOf(0, at - 400), at)
        assertTrue(before.contains("if (nativeAllowed) runCatching {"))
        assertTrue(src.contains("setRequestProperty(com.educms.player.alertwatch.AlertWatchStamp.HEADER, it)"))
    }

    @Test
    fun `the Player and the Manager agree on the contract`() {
        val mgr = managerSource("java/com/educms/manager/alertwatch/AlertWatchWatchdog.kt")
        Assume.assumeTrue("Manager module not beside this one", mgr != null)
        val m = code(mgr!!)
        assertTrue(m.contains("\"${AlertWatchKickReceiver.ACTION}\""))
        assertTrue(m.contains("\"com.educms.player.alertwatch.AlertWatchKickReceiver\""))
        assertTrue(m.contains("\"${AlertWatchKickReceiver.STEP_REARM}\""))
        assertTrue(m.contains("\"${AlertWatchKickReceiver.STEP_RESTART_HOST}\""))
        assertTrue(m.contains("\"${AlertWatchKickReceiver.EXTRA_STEP}\""))
        val store = managerSource("java/com/educms/manager/alertwatch/AlertWatchStore.kt")!!
        for (col in listOf(
            AlertWatchStamp.COL_AT_ELAPSED_MS, AlertWatchStamp.COL_STATE, AlertWatchStamp.COL_PANEL_DARK, AlertWatchStamp.COL_HOLD_HELD,
            AlertWatchStamp.COL_FACES, AlertWatchStamp.COL_MODE, AlertWatchStamp.COL_REASON, AlertWatchStamp.COL_VERDICT,
            AlertWatchStamp.COL_RECORD_AT_ELAPSED_MS, AlertWatchStamp.COL_STAMP_AGE_MS, AlertWatchStamp.COL_STAMP_STATE,
            AlertWatchStamp.COL_LADDER_RUNG, AlertWatchStamp.COL_LADDER_AT_ELAPSED_MS, AlertWatchStamp.COL_INTERVENTIONS_24H,
        )) {
            assertTrue("Manager store lacks column `$col`", store.contains("\"$col\""))
        }
        val provider = managerSource("java/com/educms/manager/PlayerHealthProvider.kt")!!
        assertTrue(provider.contains("PATH_ALERT_WATCH = \"alert-watch\""))
        assertTrue(provider.contains("PATH_ALERT_WATCH_WATCHDOG = \"alert-watch-watchdog\""))
    }
}
