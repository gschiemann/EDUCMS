package com.educms.player.wake

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assume
import org.junit.Test
import java.io.File

/**
 * WAKE → GLASS — THE WIRING, as source facts (2026-10-11).
 *
 * [WakePolicyTest] proves the rules; this proves every wake path reaches
 * them, that the proof of a landing is the Activity's own onResume, and that
 * nothing in the wake package can do the things it must never do. Same
 * shape as `UserStandbyWiringTest`: skipped (not failed) when the sources
 * are not on disk.
 */
class WakeWiringTest {

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
        src.replace(Regex("/\\*[\\s\\S]*?\\*/"), "").replace(Regex("(?m)//.*$"), "")

    private fun body(src: String, signature: String): String {
        val at = src.indexOf(signature)
        assertTrue("`$signature` not found", at >= 0)
        val rest = src.substring(at + signature.length)
        val next = Regex("\\n    (override |private |internal |public )?fun ").find(rest)?.range?.first ?: rest.length
        return rest.substring(0, next)
    }

    private val pkg = "src/main/java/com/educms/player"
    private val registry get() = code(read("$pkg/display/DisplayControlRegistry.kt"))
    private val main get() = code(read("$pkg/MainActivity.kt"))
    private val recovery get() = code(read("$pkg/wake/WakeRecovery.kt"))
    private val keyguard get() = code(read("$pkg/wake/KeyguardDismiss.kt"))

    @Test
    fun `every WAKE through the registry starts the foreground check, after the provider and the backstop`() {
        val apply = body(registry, "fun apply(")
        val provider = apply.indexOf("provider.apply(app, action)")
        val backstop = apply.indexOf("ScreenWakeLock.pokeScreen(app)")
        val check = apply.indexOf("WakeRecovery.afterWake(app, wakeSource")
        assertTrue("the registry never starts the wake check", check >= 0)
        assertTrue("the check must come AFTER the provider and the software backstop", check > provider && check > backstop)
        assertTrue(apply.contains("if (action == DisplayAction.Wake)"))
    }

    @Test
    fun `every wake path names itself`() {
        val expected = mapOf(
            "display/DisplayGuard.kt" to "\"dead-man-revert\"",
            "display/DisplayScheduler.kt" to "\"schedule-on\"",
            "display/DisplayEmergency.kt" to "\"emergency\"",
            "display/DisplayControlApi.kt" to "\"command\"",
            "heartbeat/NativePowerControl.kt" to "\"power-on\"",
            "standby/UserStandby.kt" to "\"standby-end\"",
        )
        for ((file, source) in expected) {
            val src = code(read("$pkg/$file"))
            assertTrue("$file does not name its wake ($source)", src.contains("wakeSource = $source"))
        }
    }

    @Test
    fun `the Activity's own onResume is the proof, and it asks the keyguard to go`() {
        val resume = body(main, "override fun onResume(")
        assertTrue(resume.contains("WakeRecovery.onActivityResumed(applicationContext)"))
        assertTrue(resume.contains("KeyguardDismiss.requestIfLocked(this, \"resume\")"))
        // The wake flags re-assert showWhenLocked and ask the keyguard too.
        val wake = body(main, "private fun requestScreenWake(")
        assertTrue(wake.contains("setShowWhenLocked(true)"))
        assertTrue(wake.contains("KeyguardDismiss.requestIfLocked(this, \"wake\")"))
        // A page load is evidence for the timeline.
        assertTrue(body(main, "private fun loadPlayer(").contains("WakeRecovery.onPageLoadStarted(applicationContext)"))
    }

    @Test
    fun `the process start, the screen broadcasts and the alert watch feed the record`() {
        assertTrue(code(read("$pkg/PlayerApp.kt")).contains("WakeRecovery.onProcessStart(this)"))
        val standby = code(read("$pkg/standby/UserStandby.kt"))
        val on = body(standby, "internal fun onScreenOn(")
        assertTrue(on.contains("WakeRecovery.onScreenOn(app)"))
        assertTrue("the standby must END before the wake check runs", on.indexOf("end(app,") < on.indexOf("WakeRecovery.onScreenOn(app)"))
        assertTrue(body(standby, "internal fun onScreenOff(").contains("WakeRecovery.onScreenOff(app)"))
        val watch = code(read("$pkg/alertwatch/NativeAlertWatch.kt"))
        assertTrue(watch.contains("WakeRecovery.onAlertEpisodeSettled(app, outcome)"))
        val engine = code(read("$pkg/alertwatch/NativeAlertWatchEngine.kt"))
        for (outcome in listOf("\"confirmed\"", "\"unconfirmed\"", "\"page-cleared\"", "\"not-on-glass\"")) {
            assertTrue("the engine never settles $outcome", engine.contains("ports.alertEpisodeSettled(") && engine.contains(outcome))
        }
        // The report carries the timeline.
        assertTrue(body(code(read("$pkg/heartbeat/NativePowerControl.kt")), "fun report(").contains("WakeRecovery.attachTo(out, ctx)"))
    }

    @Test
    fun `the heartbeat is pulled forward by the power events, bounded`() {
        val heartbeat = code(read("$pkg/heartbeat/HeartbeatService.kt"))
        assertTrue(heartbeat.contains("fun requestPromptTick("))
        assertTrue(body(heartbeat, "fun requestPromptTick(").contains("PromptTickPolicy.accept("))
        assertTrue("the sleep must be interruptible", body(heartbeat, "private suspend fun runLoop(").contains("withTimeoutOrNull(delayMs) { poke.receive() }"))
        assertTrue(heartbeat.contains("promptRequested = promptReason != null"))
        for (reason in listOf("\"screen-on\"", "\"screen-off\"", "\"activity-resumed\"", "\"wake:\$source\"")) {
            assertTrue("no prompt tick for $reason", recovery.contains("HeartbeatService.requestPromptTick(app, $reason)"))
        }
    }

    @Test
    fun `the wake package never reloads, recreates, locks, pokes the panel or touches the hold`() {
        for (src in listOf(recovery, keyguard, code(read("$pkg/wake/WakePolicy.kt")), code(read("$pkg/wake/WakeTimeline.kt")))) {
            for (forbidden in listOf(
                "reload(", "loadUrl(", "recreate(", "lockNow(", "pokeScreen", "setHold(", "setHoldFrom(",
                "commitEmergencyHold", "pauseTimers(", "goToSleep", "finish(", "killProcess", "System.exit",
            )) {
                assertFalse("the wake package reaches `$forbidden`", src.contains(forbidden))
            }
        }
        // Its one way of bringing the player forward is the existing singleTask launch.
        assertTrue(recovery.contains("RelaunchEscalation.launchNow(app, \"wake/\${t.source}\")"))
        // The launch is gated by the pure policy, and the policy is asked with every fact.
        val check = body(recovery, "private fun check(")
        for (fact in listOf("interactive =", "foreground = MainActivity.isInForeground", "standbyActive =", "emergencyHeld =", "installPromptOutstanding =", "setupYield =", "lastCheck =")) {
            assertTrue("the check omits `$fact`", check.contains(fact))
        }
        assertTrue(check.contains("WakePolicy.step(facts)"))
        // A wake while already on the glass starts nothing (the alert re-asserts one per poll).
        val after = body(recovery, "fun afterWake(")
        assertTrue(after.contains("WakePolicy.alreadyOnGlass(interactiveNow, MainActivity.isInForeground)"))
        assertTrue(after.indexOf("alreadyOnGlass(") < after.indexOf("WakeTimeline("))
        // The keyguard is only ever asked on an INSECURE lock.
        assertTrue(keyguard.contains("if (km.isDeviceSecure)"))
    }

    @Test
    fun `the automatic upload names the screen the token is bound to`() {
        val upload = body(recovery, "private fun upload(")
        assertTrue(upload.contains("HostAllowlist.isApiHost(apiRoot)"))
        assertTrue(upload.contains("NativeAlertWatchPolicy.screenIdOf(token)"))
        assertTrue(upload.contains("PlayerLogger.uploadRecent(apiRoot, token, screenId)"))
        assertTrue(recovery.contains("DiagnosticsUploadPolicy.scheduleAt("))
        // The bridge's own upload was fixed the same way.
        assertTrue(main.contains("NativeAlertWatchPolicy.screenIdOf(jwt) ?: fp"))
    }
}
