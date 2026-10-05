package com.educms.player.standby

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assume
import org.junit.Test
import java.io.File

/**
 * USER STANDBY — THE WIRING, as source facts (2026-10-03, player 1.1.21).
 *
 * [UserStandbyPolicyTest] proves the rules; this proves they are in front of
 * every path that used to turn a remote-slept panel back on, and that NOTHING
 * on the alert path can be stopped by a standby. Same shape as
 * `WebTabsWiringTest`: skipped (not failed) when the sources are not on disk.
 *
 * Every assertion here was red on the 1.1.20 tree — that tree had no
 * UserStandby at all, the Watchdog started MainActivity unconditionally, and
 * onCreate armed FLAG_TURN_SCREEN_ON unconditionally.
 */
class UserStandbyWiringTest {

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

    private val main get() = read("src/main/java/com/educms/player/MainActivity.kt")
    private val watchdog get() = read("src/main/java/com/educms/player/watchdog/Watchdog.kt")
    private val escalation get() = read("src/main/java/com/educms/player/ota/RelaunchEscalation.kt")
    private val otaReceiver get() = read("src/main/java/com/educms/player/ota/OtaInstallReceiver.kt")
    private val registry get() = read("src/main/java/com/educms/player/display/DisplayControlRegistry.kt")
    private val emergency get() = read("src/main/java/com/educms/player/display/DisplayEmergency.kt")
    private val standby get() = read("src/main/java/com/educms/player/standby/UserStandby.kt")

    /** Kotlin source with comments removed, so a fact is never satisfied by prose. */
    private fun code(src: String): String =
        src.replace(Regex("/\\*[\\s\\S]*?\\*/"), "").lines().joinToString("\n") { it.substringBefore("//") }

    /** The body of `fun name(` up to the next top-level-ish `fun ` declaration. */
    private fun body(src: String, signature: String): String {
        val at = src.indexOf(signature)
        assertTrue("`$signature` not found", at >= 0)
        val next = Regex("\\n\\s*(private |internal |override |public )?fun ").find(src, at + signature.length)
        return src.substring(at, next?.range?.first ?: src.length)
    }

    // ─── the panel's own wake flags ─────────────────────────────────

    @Test
    fun `onCreate no longer arms turn-screen-on unconditionally`() {
        val onCreate = body(code(main), "override fun onCreate(")
        assertFalse(
            "onCreate adds FLAG_TURN_SCREEN_ON directly — a relaunch during a user standby would wake the panel",
            onCreate.contains("window.addFlags(WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON)"),
        )
        assertTrue("onCreate must arm through the standby check", onCreate.contains("armTurnScreenOn("))
        assertTrue(onCreate.contains("UserStandby.isActive(applicationContext)"))
        assertTrue("the Activity must hear standby transitions", onCreate.contains("UserStandby.setListener("))
    }

    @Test
    fun `the API 27 half overrides the manifest's android-turnScreenOn`() {
        val arm = body(code(main), "private fun armTurnScreenOn(")
        assertTrue(arm.contains("setTurnScreenOn(armed)"))
        assertTrue(arm.contains("Build.VERSION_CODES.O_MR1"))
        assertTrue(arm.contains("clearFlags(WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON)"))
    }

    @Test
    fun `the Activity reports the two facts the receiver needs`() {
        val src = code(main)
        assertTrue("onPause must stamp a pause caused by the sleep", body(src, "override fun onPause(").contains("lastPausedBySleepAtMs ="))
        assertTrue(body(src, "override fun onResume(").contains("UserStandby.onActivityResumed("))
        assertTrue(body(src, "override fun onCreate(").contains("liveInstances.incrementAndGet()"))
        assertTrue(body(src, "override fun onDestroy(").contains("liveInstances.decrementAndGet()"))
    }

    // ─── every relaunch path asks first ─────────────────────────────

    @Test
    fun `the watchdog tick asks before it starts the Activity`() {
        val src = code(watchdog)
        val ask = src.indexOf("UserStandby.relaunchMode(")
        val launch = src.indexOf("ctx.startActivity(launch)")
        assertTrue("the Watchdog never consults user standby", ask >= 0)
        assertTrue("the standby check must come BEFORE the launch", launch > ask)
        assertTrue("SKIP must return before the launch", src.contains("RelaunchMode.SKIP"))
        assertTrue("the tick keeps the standby CPU lock fresh", src.contains("UserStandby.onWatchdogTick("))
    }

    @Test
    fun `post-OTA escalation never escalates in standby`() {
        val attempt = body(code(escalation), "fun attempt(")
        val ask = attempt.indexOf("UserStandby.relaunchMode(")
        val chain = attempt.indexOf("chainInFlight = true")
        assertTrue("RelaunchEscalation.attempt never consults user standby", ask >= 0)
        assertTrue("the standby branch must come before the escalation chain starts", chain > ask)
        // The DARK arm launches once and returns — no proof, no notification.
        val dark = attempt.substring(attempt.indexOf("RelaunchMode.DARK"), attempt.indexOf("RelaunchMode.NORMAL"))
        assertTrue(dark.contains("launchNow("))
        assertTrue(dark.contains("return"))
        assertFalse(dark.contains("postRelaunchNotification"))
        assertFalse(dark.contains("mainHandler.postDelayed"))
    }

    @Test
    fun `the OTA receiver neither raises a prompt nor relaunches loudly in standby`() {
        val src = code(otaReceiver)
        val gate = src.indexOf("UserStandby.isActive(context)")
        val trampoline = src.indexOf("context.startActivity(trampoline)")
        assertTrue("the install-prompt trampoline is not gated", gate in 0 until trampoline)
        assertTrue(body(src, "private fun relaunchSelf(").contains("UserStandby.relaunchMode(context)"))
    }

    // ─── what ends a standby ────────────────────────────────────────

    @Test
    fun `a WAKE ends a standby and a BLANK is recorded as ours, after the alert gate`() {
        val apply = body(code(registry), "fun apply(")
        val gate = apply.indexOf("DisplayEmergency.refusalReason(")
        val wake = apply.indexOf("UserStandby.end(app, \"a WAKE command\")")
        val blank = apply.indexOf("UserStandby.noteOwnBlank()")
        val provider = apply.indexOf("provider.apply(app, action)")
        assertTrue(gate >= 0 && wake > gate && blank > gate)
        assertTrue("standby must be settled BEFORE the provider runs", provider > wake && provider > blank)
        assertTrue(
            "the software floor's WAKE must poke a slept panel",
            apply.contains("ScreenWakeLock.pokeScreenIfAsleep(app)"),
        )
    }

    // ─── ⚠️ LIFE SAFETY ─────────────────────────────────────────────

    @Test
    fun `an alert ENDS a standby and nothing on the alert path ever asks whether one is active`() {
        val src = code(emergency)
        val enforce = body(src, "fun enforceNow(")
        val end = enforce.indexOf("UserStandby.end(app, \"an emergency alert\")")
        val hooks = enforce.indexOf("DisplayWindowBridge.withHooks")
        val poke = enforce.indexOf("ScreenWakeLock.pokeScreen(app)")
        assertTrue("enforceNow must end a standby", end >= 0)
        assertTrue("…before it drives the window and the wake lock", hooks > end && poke > end)
        assertFalse(
            "the emergency interlock must never be GATED by a standby",
            src.contains("UserStandby.isActive") || src.contains("UserStandby.activeRecord") ||
                src.contains("relaunchMode"),
        )
        val api = code(read("src/main/java/com/educms/player/display/DisplayControlApi.kt"))
        assertFalse(
            "the bridge's emergencyHoldJson must never consult a standby",
            body(api, "fun emergencyHoldJson(").contains("UserStandby"),
        )
    }

    @Test
    fun `a screen-off during an alert puts the alert back`() {
        val src = code(standby)
        assertTrue(src.contains("ScreenOffCause.EMERGENCY -> reassertEmergency("))
        assertTrue(body(src, "private fun reassertEmergency(").contains("DisplayEmergency.enforceNow(app)"))
    }

    /**
     * Renamed 2026-10-05 (1.1.22). This was `the page keeps running behind a
     * dark panel` — a claim these three source facts never proved and that
     * production DISPROVED: on the X80 the page made no request for 8.8 hours
     * after its panel went off. The facts are still required (they are what
     * this app can do for the page); what reaches a dark panel now is the
     * native alert watch — see `NativeAlertWatchWiringTest`.
     */
    @Test
    fun `nothing in this app stops the page behind a dark panel, and the CPU stays awake`() {
        // (1) nothing pauses the WebView's JavaScript timers;
        val sources = File(moduleRoot ?: return, "src/main/java").walkTopDown()
            .filter { it.isFile && it.extension == "kt" }
        sources.forEach { f ->
            assertFalse(
                "${f.name} calls pauseTimers() — that stops the page's alert polling while the panel is off",
                code(f.readText()).contains("pauseTimers("),
            )
        }
        // (2) the foreground HeartbeatService shares the page's process;
        val manifest = read("src/main/AndroidManifest.xml")
        val heartbeat = Regex("<service[\\s\\S]*?HeartbeatService[\\s\\S]*?/>").find(manifest)?.value ?: ""
        assertTrue(heartbeat.isNotEmpty())
        assertFalse("HeartbeatService must keep the PAGE's process alive", heartbeat.contains("android:process"))
        // (3) the CPU stays awake for as long as the standby lasts.
        assertTrue(standby.contains("PowerManager.PARTIAL_WAKE_LOCK"))
        assertTrue(
            "the standby CPU lock needs a timeout (lint WakelockTimeout) and a refresh",
            standby.contains("wl.acquire(UserStandbyPolicy.CPU_LOCK_TIMEOUT_MS)"),
        )
    }

    @Test
    fun `the receiver is installed for the life of the process`() {
        val app = code(read("src/main/java/com/educms/player/PlayerApp.kt"))
        assertTrue(app.contains("UserStandby.install(this)"))
        val src = code(standby)
        assertTrue(src.contains("Intent.ACTION_SCREEN_OFF") && src.contains("Intent.ACTION_SCREEN_ON"))
    }

    // ─── the Manager companion: why the Player alone suffices ───────

    @Test
    fun `the Manager can only RELAUNCH the Player through MainActivity's own wake flags`() {
        val root = moduleRoot ?: return
        val managerDir = File(root.parentFile, "manager/src/main/java")
        Assume.assumeTrue("manager sources not on disk", managerDir.isDirectory)
        val managerCode = managerDir.walkTopDown()
            .filter { it.isFile && it.extension == "kt" }
            .associate { it.name to code(it.readText()) }
        // No panel-power mechanism of its own: no wake lock, no window wake
        // flag, no PowerManager.wakeUp, no device-admin lock …
        listOf(
            "newWakeLock", "ACQUIRE_CAUSES_WAKEUP", "FLAG_TURN_SCREEN_ON", "setTurnScreenOn",
            "wakeUp(", "lockNow(",
        ).forEach { token ->
            managerCode.forEach { (name, src) ->
                assertFalse(
                    "Manager $name uses $token — it could wake a panel a person turned off, " +
                        "and the Player's standby could no longer stop it",
                    src.contains(token),
                )
            }
        }
        // … so every Player relaunch it makes (heartbeat staleness = the
        // Player PROCESS is dead; and after an install) is a start of the
        // Player's launcher Activity — MainActivity — whose turn-screen-on
        // the Player disarms for the whole standby.
        val relaunchers = managerCode.filterValues { it.contains("getLaunchIntentForPackage(") }
        assertTrue("expected the Manager's Player relaunch paths", relaunchers.isNotEmpty())
        // ⚠️ KNOWN, NOT A RELAUNCH: the install-confirmation notification. A
        // Manager-driven install that needs a tap posts a FULL-SCREEN intent,
        // which turns a sleeping panel on. Reported to the lead as a Manager
        // follow-up (it needs its own release); pinned here to exactly that
        // one site so a second full-screen intent cannot appear unnoticed.
        val fullScreen = managerCode.filterValues { it.contains("setFullScreenIntent") }.keys
        assertTrue("unexpected full-screen-intent sites in the Manager: $fullScreen", fullScreen == setOf("OtaInstallReceiver.kt"))
    }
}
