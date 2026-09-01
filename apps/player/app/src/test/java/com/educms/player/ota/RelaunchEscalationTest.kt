package com.educms.player.ota

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assume
import org.junit.Test
import java.io.File

/**
 * ── POST-OTA RELAUNCH: THE DECISION, AND THE WIRING ──────────────────────
 *
 * THE FIELD FAILURE (2026-09-01, verified on the production fleet): two
 * Goodview panels — one Android 11 carrying an OEM device owner that is not
 * ours, one Android 13 with no device owner — installed a player OTA and the
 * app never relaunched. The operator walked to each panel.
 *
 * The cause is an Android rule, and the reason it went unnoticed for so long
 * is the ugliest part of it: `startActivity` from a background process is
 * SILENTLY DROPPED on Android 10+ unless the app is the default HOME, holds
 * SYSTEM_ALERT_WINDOW, or is / has a device owner. No exception. No result
 * code. So `PostInstallRelaunchWorker` logged "relaunched com.educms.player"
 * and returned success over a screen sitting on the OEM launcher, and
 * `HeartbeatService`'s trampoline reasoned from an Android 14 BAL grant that
 * does not exist on API 30 or 33 — the two versions the failing panels run.
 *
 * WHAT THIS SUITE PINS:
 *
 *  1. THE LADDER. Foreground proof ends it; the overlay grant buys exactly
 *     ONE retry; everything else escalates. A retry that could repeat, or an
 *     escalation that could be skipped, is the failure coming back.
 *  2. THE COPY. The report says what we DID and what we OBSERVED, names the
 *     grant that is actually missing, and never claims the screen is back.
 *  3. THE WIRING — the `DeviceAdminWiringTest` lesson: a decision function
 *     nothing calls passes its tests perfectly. Both relaunch paths must
 *     route through the one implementation, MainActivity must actually
 *     publish the foreground fact, and the manifest must declare the two
 *     permissions the escalation depends on.
 *
 * Source-reading tests are skipped (not failed) when the tree is not on
 * disk, so a jar-only checkout still runs green.
 */
class RelaunchEscalationTest {

    private fun facts(
        foreground: Boolean = false,
        canDrawOverlays: Boolean = false,
        isHomeApp: Boolean = false,
        deviceOwnerIsOurs: Boolean = false,
        overlayRetryUsed: Boolean = false,
    ) = RelaunchFacts(
        foreground = foreground,
        canDrawOverlays = canDrawOverlays,
        isHomeApp = isHomeApp,
        deviceOwnerIsOurs = deviceOwnerIsOurs,
        overlayRetryUsed = overlayRetryUsed,
    )

    // ─── 1. the ladder ──────────────────────────────────────────────

    @Test
    fun `a resumed MainActivity settles the chain`() {
        // The ONLY proof the launch landed. Everything else is inference.
        assertEquals(RelaunchStage.SETTLED, RelaunchEscalationMath.next(facts(foreground = true)))
        // ...and it settles regardless of which grants are held: a screen
        // that came back does not need a notification about coming back.
        assertEquals(
            RelaunchStage.SETTLED,
            RelaunchEscalationMath.next(facts(foreground = true, canDrawOverlays = true)),
        )
    }

    @Test
    fun `the overlay grant buys exactly one retry`() {
        // Held and unspent → retry. The grant is what makes a second
        // background activity start legal, so it is worth spending.
        assertEquals(
            RelaunchStage.RETRY_WITH_OVERLAY,
            RelaunchEscalationMath.next(facts(canDrawOverlays = true)),
        )
        // Held and already spent → escalate. Without this clause the chain
        // could re-arm itself forever on a panel that will never come back,
        // which is a relaunch LOOP wearing a recovery costume.
        assertEquals(
            RelaunchStage.ESCALATE,
            RelaunchEscalationMath.next(facts(canDrawOverlays = true, overlayRetryUsed = true)),
        )
    }

    @Test
    fun `no overlay grant escalates immediately`() {
        // THE TWO PANELS. Nothing to retry with, so do not burn 8 more
        // seconds pretending: tell the panel and tell the dashboard.
        assertEquals(RelaunchStage.ESCALATE, RelaunchEscalationMath.next(facts()))
    }

    // ─── 2. the copy ────────────────────────────────────────────────

    @Test
    fun `the report never claims the screen came back`() {
        val message = RelaunchEscalationMath.blockedMessage(facts())
        assertFalse(
            "we cannot see the glass — copy states what the evidence proves",
            message.contains("back on screen") || message.contains("is playing"),
        )
        assertTrue("says what we observed", message.contains("did not report foreground"))
        assertTrue("says the install itself was fine", message.startsWith("Installed OK"))
    }

    @Test
    fun `the report names the grants this screen is actually missing`() {
        // Neither grant — the live fleet case.
        val neither = RelaunchEscalationMath.blockedMessage(facts())
        assertTrue(neither.contains("Display over other apps"))
        assertTrue(neither.contains("none of the three"))

        // Overlay held, HOME not: naming the overlay would be a lie, and an
        // operator who goes to grant something they already have gives up.
        val overlayOnly = RelaunchEscalationMath.blockedMessage(
            facts(canDrawOverlays = true, overlayRetryUsed = true),
        )
        assertFalse(
            "it holds the overlay grant — do not send anyone to grant it again",
            overlayOnly.contains("missing \"Display over other apps\""),
        )
        assertTrue(overlayOnly.contains("the Home-app default"))

        // HOME held, overlay not.
        val homeOnly = RelaunchEscalationMath.blockedMessage(facts(isHomeApp = true))
        assertTrue(homeOnly.contains("\"Display over other apps\""))
        assertFalse(homeOnly.contains("the Home-app default"))
    }

    @Test
    fun `with every checkable grant held the report says so instead of inventing one`() {
        val message = RelaunchEscalationMath.blockedMessage(
            facts(canDrawOverlays = true, isHomeApp = true, overlayRetryUsed = true),
        )
        assertTrue(
            "blaming a permission that is held sends the operator on a wild goose chase",
            message.contains("not a missing permission"),
        )
        assertTrue("still leaves a human something to do", message.contains("Tap the app once"))
    }

    @Test
    fun `the report counts the attempts it actually made`() {
        assertTrue(
            RelaunchEscalationMath.blockedMessage(facts()).contains("a relaunch attempt"),
        )
        assertTrue(
            RelaunchEscalationMath.blockedMessage(facts(overlayRetryUsed = true))
                .contains("two relaunch attempts"),
        )
    }

    @Test
    fun `the report fits the ota-state message budget`() {
        // The POST truncates at 400 chars; a message that needs truncating
        // loses its "here is what to do" tail, which is the useful half.
        listOf(
            facts(),
            facts(canDrawOverlays = true, overlayRetryUsed = true),
            facts(isHomeApp = true),
            facts(canDrawOverlays = true, isHomeApp = true, deviceOwnerIsOurs = true, overlayRetryUsed = true),
        ).forEach {
            val message = RelaunchEscalationMath.blockedMessage(it)
            assertTrue("message is ${message.length} chars: $message", message.length <= 400)
        }
    }

    // ─── 3. the wiring ──────────────────────────────────────────────

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

    private fun require(relative: String): String {
        val root = moduleRoot
        Assume.assumeTrue("module root not on disk", root != null)
        val f = File(root!!, relative)
        Assume.assumeTrue("source not on disk: $relative", f.isFile)
        return f.readText()
    }

    @Test
    fun `both relaunch paths go through the one implementation`() {
        val worker = require("src/main/java/com/educms/player/ota/PostInstallRelaunchWorker.kt")
        val heartbeat = require("src/main/java/com/educms/player/heartbeat/HeartbeatService.kt")
        assertTrue(
            "PostInstallRelaunchWorker must delegate — a second copy of the launch is a second " +
                "place that can go back to assuming it worked",
            worker.contains("RelaunchEscalation.attempt("),
        )
        assertTrue(
            "HeartbeatService's EXTRA_LAUNCH_MAIN branch must delegate for the same reason",
            heartbeat.contains("RelaunchEscalation.attempt("),
        )
        assertFalse(
            "the worker must not still fire its own unproven startActivity",
            worker.contains("ctx.startActivity("),
        )
    }

    @Test
    fun `MainActivity publishes the foreground fact the escalation reads`() {
        val main = require("src/main/java/com/educms/player/MainActivity.kt")
        assertTrue("no publisher, no proof", main.contains("var isInForeground"))
        assertTrue("set on resume", main.contains("isInForeground = true"))
        assertTrue(
            "and cleared on pause — a flag that only ever goes true would report every " +
                "blocked relaunch as a success exactly once and then never again",
            main.contains("isInForeground = false"),
        )
    }

    @Test
    fun `the manifest declares the permissions the escalation depends on`() {
        val manifest = require("src/main/AndroidManifest.xml")
        assertTrue(
            "SYSTEM_ALERT_WINDOW is the appop that makes our own relaunch legal; without the " +
                "manifest entry canDrawOverlays() can never become true and the setup step " +
                "is unreachable",
            manifest.contains("android.permission.SYSTEM_ALERT_WINDOW"),
        )
        assertTrue(
            "the last rung is a full-screen-intent notification; without this it is a plain " +
                "one nobody at the panel will see",
            manifest.contains("android.permission.USE_FULL_SCREEN_INTENT"),
        )
    }

    @Test
    fun `the escalation reports a state the dashboard understands`() {
        val src = require("src/main/java/com/educms/player/ota/RelaunchEscalation.kt")
        assertTrue(
            "RELAUNCH_BLOCKED is the ota-state the server accepts for this outcome — a typo " +
                "here is a silent 4xx and a screen nobody knows is stranded",
            src.contains("\"RELAUNCH_BLOCKED\""),
        )
        assertTrue(
            "the ota-state POST reuses the OtaInstallReceiver prefs/URL shape",
            src.contains("/api/v1/screens/status/") && src.contains("/ota-state"),
        )
        assertTrue(
            "it must not run the POST on the Handler's main thread — " +
                "NetworkOnMainThreadException would be swallowed into permanent silence",
            src.contains("Thread {"),
        )
    }
}
