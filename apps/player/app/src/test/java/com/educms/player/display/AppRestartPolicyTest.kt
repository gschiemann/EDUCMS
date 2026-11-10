package com.educms.player.display

import com.educms.player.display.AppRestartPolicy.Outcome
import com.educms.player.display.AppRestartPolicy.Reason
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assume
import org.junit.Test
import java.io.File

/** The rules of the remote app restart (2026-11-09). Pure JVM, plus the wiring as source facts. */
class AppRestartPolicyTest {

    private val now = 1_800_000_000_000L
    private val hour = 60 * 60_000L

    private fun cap(
        sdk: Int = 33,
        overlay: Boolean = false,
        home: Boolean = false,
        trusted: Boolean = true,
        failedAt: Long = 0L,
    ) = AppRestartPolicy.capability(AppRestartPolicy.CapabilityFacts(sdk, overlay, home, trusted, failedAt, now))

    @Test fun capability_needs_a_background_launch_grant_from_android_10() {
        assertEquals("none", cap(sdk = 29).first)
        assertEquals("no-background-launch-grant", cap(sdk = 33).second)
        assertEquals("relaunch", cap(sdk = 33, overlay = true).first)
        assertEquals("relaunch", cap(sdk = 30, home = true).first)
        // Android 9 and older: no background-start restriction exists.
        assertEquals("relaunch", cap(sdk = 28).first)
    }

    @Test fun capability_needs_the_trusted_bridge() {
        assertEquals("no-trusted-bridge", cap(overlay = true, trusted = false).second)
    }

    @Test fun a_relaunch_that_did_not_land_withdraws_the_capability_for_a_week() {
        assertEquals("relaunch-did-not-land", cap(overlay = true, failedAt = now - 6 * 24 * hour).second)
        assertEquals("relaunch", cap(overlay = true, failedAt = now - 8 * 24 * hour).first)
        // A failure stamped in the future (clock step) still counts.
        assertEquals("none", cap(overlay = true, failedAt = now + hour).first)
    }

    private fun req(
        id: String? = "a1",
        trusted: Boolean = true,
        capable: Boolean = true,
        emergency: Boolean = false,
        ota: Boolean = false,
        pairing: Boolean = false,
        setup: Boolean = false,
        standby: Boolean = false,
        age: Long = 2 * hour,
        history: List<Long> = emptyList(),
        last: String? = null,
        at: Long = now,
    ) = AppRestartPolicy.refusal(
        AppRestartPolicy.RequestFacts(id, trusted, capable, emergency, ota, pairing, setup, standby, age, history, last, at),
    )

    @Test fun an_ordinary_request_is_accepted() {
        assertNull(req())
    }

    @Test fun refusals_each_have_a_reason() {
        assertEquals(Reason.BAD_ID, req(id = null))
        assertEquals(Reason.BAD_ID, req(id = "x".repeat(65)))
        assertEquals(Reason.DUPLICATE, req(last = "a1"))
        assertEquals(Reason.EMERGENCY, req(emergency = true))
        assertEquals(Reason.UNTRUSTED, req(trusted = false))
        assertEquals(Reason.NOT_CAPABLE, req(capable = false))
        assertEquals(Reason.OTA, req(ota = true))
        assertEquals(Reason.PAIRING, req(pairing = true))
        assertEquals(Reason.SETUP, req(setup = true))
        assertEquals(Reason.STANDBY, req(standby = true))
        assertEquals(Reason.TOO_SOON_AFTER_START, req(age = 60_000L))
    }

    @Test fun an_emergency_outranks_every_other_reason() {
        assertEquals(Reason.EMERGENCY, req(emergency = true, trusted = false, capable = false, ota = true))
    }

    @Test fun rate_limits_hold_and_a_bad_clock_only_tightens_them() {
        assertEquals(Reason.RATE_INTERVAL, req(history = listOf(now - 10 * 60_000L)))
        assertEquals(Reason.RATE_INTERVAL, req(history = listOf(now + 5 * hour)))
        assertEquals(Reason.RATE_DAY, req(history = listOf(now - 20 * hour, now - 10 * hour, now - 2 * hour)))
        assertNull(req(history = listOf(now - 30 * hour, now - 25 * hour, now - 2 * hour)))
    }

    @Test fun a_command_storm_can_never_loop_restarts() {
        // A command every minute for two days: at most MAX_PER_DAY a day get through.
        var history = emptyList<Long>()
        var accepted = 0
        var t = now
        repeat(2 * 24 * 60) {
            if (req(id = "id$it", history = history, at = t) == null) {
                accepted++
                history = AppRestartPolicy.historyAfterAccept(history, t)
            }
            t += 60_000L
        }
        assertTrue("accepted=$accepted", accepted in 1..(2 * AppRestartPolicy.MAX_PER_DAY))
    }

    @Test fun landing_outcomes() {
        assertEquals(Outcome.LANDED, AppRestartPolicy.landingOutcome(true, true, false))
        assertEquals(Outcome.NOT_LANDED, AppRestartPolicy.landingOutcome(false, true, false))
        assertEquals(Outcome.STARTED, AppRestartPolicy.landingOutcome(false, false, false))
        assertEquals(Outcome.STARTED, AppRestartPolicy.landingOutcome(false, null, false))
        assertEquals(Outcome.STARTED, AppRestartPolicy.landingOutcome(false, true, true))
    }

    @Test fun a_new_pid_proves_the_restart_even_before_the_landing_check() {
        assertEquals(Outcome.STARTED, AppRestartPolicy.reportedOutcome(Outcome.RESTARTING, 100, 200))
        assertEquals(Outcome.RESTARTING, AppRestartPolicy.reportedOutcome(Outcome.RESTARTING, 100, 100))
        assertEquals(Outcome.REFUSED, AppRestartPolicy.reportedOutcome(Outcome.REFUSED, 100, 200))
    }

    @Test fun the_alarm_fires_after_the_kill() {
        assertTrue(AppRestartPolicy.RELAUNCH_ALARM_DELAY_MS > AppRestartPolicy.KILL_DELAY_MS)
    }

    // ── Wiring, as source facts (skipped when the sources are not on disk) ──

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

    private val pkg = "src/main/java/com/educms/player"

    @Test fun wiring_receiver_is_declared_unexported() {
        val m = read("src/main/AndroidManifest.xml")
        val i = m.indexOf(".display.AppRestartReceiver")
        assertTrue(i > 0)
        assertTrue(m.substring(i, i + 200).contains("android:exported=\"false\""))
    }

    @Test fun wiring_bridge_probe_and_heartbeat() {
        assertTrue(read("$pkg/display/DisplayControlApi.kt").contains("\"APPRESTART\" -> AppRestart.requestJson(app, obj, trusted)"))
        assertTrue(read("$pkg/display/DisplayCapabilityProbe.kt").contains("put(\"appRestart\", AppRestart.capability(ctx))"))
        assertTrue(read("$pkg/heartbeat/NativePowerControl.kt").contains("AppRestart.reportJson(ctx)"))
    }

    @Test fun wiring_the_process_ends_only_after_a_last_emergency_look_and_relaunches_through_the_one_ladder() {
        val src = read("$pkg/display/AppRestart.kt")
        val end = src.substring(src.indexOf("private fun endProcess"))
        assertTrue(end.indexOf("DisplayEmergency.isHeld") in 0 until end.indexOf("killProcess"))
        assertTrue(src.contains("RelaunchEscalation.attempt(app, \"app-restart\", RelaunchPurpose.APP_RESTART)"))
        // The heartbeat service (host of the native alert watch) comes back first.
        val alarm = src.substring(src.indexOf("internal fun onRelaunchAlarm"))
        assertTrue(alarm.indexOf("HeartbeatService.ensureRunning") in 0 until alarm.indexOf("RelaunchEscalation.attempt"))
        // No device-owner or root path anywhere in the feature.
        assertFalse(src.contains("DevicePolicyManager"))
        assertFalse(src.contains("Runtime.getRuntime().exec"))
    }

    @Test fun wiring_an_app_restart_never_reports_as_an_ota() {
        val src = read("$pkg/ota/RelaunchEscalation.kt")
        assertTrue(src.contains("if (purpose == RelaunchPurpose.OTA) reportRelaunchBlocked(ctx, message)"))
    }
}
