package com.educms.player.alertwatch

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assume
import org.junit.Test
import java.io.File

/**
 * THE NATIVE ALERT WATCH — THE WIRING, as source facts (2026-10-05, 1.1.22).
 *
 * The policy and engine tests prove the rules. This proves the rules are in
 * front of a real caller ("112 green tests, no caller" is a shape this repo
 * has shipped before), and — the part that matters most — that NOTHING in
 * the watch can lower an emergency hold. Same shape as
 * `UserStandbyWiringTest`: skipped, not failed, when the sources are not on
 * disk.
 */
class NativeAlertWatchWiringTest {

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

    private val pkg = "src/main/java/com/educms/player"
    private val watch get() = code(read("$pkg/alertwatch/NativeAlertWatch.kt"))
    private val engine get() = code(read("$pkg/alertwatch/NativeAlertWatchEngine.kt"))
    private val policy get() = code(read("$pkg/alertwatch/NativeAlertWatchPolicy.kt"))
    private val scanner get() = code(read("$pkg/alertwatch/ManifestAlertScanner.kt"))
    private val emergency get() = code(read("$pkg/display/DisplayEmergency.kt"))
    private val heartbeat get() = code(read("$pkg/heartbeat/HeartbeatService.kt"))
    private val watchdog get() = code(read("$pkg/watchdog/Watchdog.kt"))
    private val main get() = code(read("$pkg/MainActivity.kt"))

    // ─── ⚠️ RAISE ONLY ───────────────────────────────────────────────

    @Test
    fun `nothing in the watch can lower a hold`() {
        for ((name, src) in listOf("NativeAlertWatch" to watch, "Engine" to engine, "Policy" to policy, "Scanner" to scanner)) {
            for (forbidden in listOf("setHold(", "emergencyHoldJson(", "displayEmergencyHold", "commitEmergencyHold", "DisplayPrefs")) {
                assertFalse("$name reaches the hold through `$forbidden`", src.contains(forbidden))
            }
        }
        // Its one write to the interlock:
        assertEquals(1, Regex("DisplayEmergency\\.raiseFromNativeWatch\\(").findAll(watch).count())
        // …and the engine's port surface has no way to ask for a release.
        val ports = engine.substring(engine.indexOf("interface Ports"), engine.indexOf("enum class Level"))
        assertFalse(ports.contains("release", ignoreCase = true))
        assertFalse(ports.contains("clear", ignoreCase = true))
    }

    @Test
    fun `the interlock's native door only opens one way`() {
        val raise = body(emergency, "fun raiseFromNativeWatch(")
        assertTrue(raise.contains("setHoldFrom(app, faceIndex, active = true, fromPage = false)"))
        assertFalse("the native entry point must never pass a variable for `active`", raise.contains("active = false"))
        // Exactly two callers of the shared body: the page's and the watch's.
        assertEquals(2, Regex("setHoldFrom\\(").findAll(emergency).count() - 1)
        // The page's own entry is untouched in meaning: both directions, as before.
        assertTrue(emergency.contains("setHoldFrom(ctx, faceIndex, active, fromPage = true)"))
    }

    @Test
    fun `a page raise is recorded and a page release forgets it — bookkeeping only`() {
        val shared = body(emergency, "private fun setHoldFrom(")
        assertTrue(shared.contains("if (fromPage)"))
        assertTrue(shared.contains("pageRaisedAt[face] = SystemClock.elapsedRealtime()"))
        assertTrue(shared.contains("pageRaisedAt.remove(face)"))
        assertTrue(body(emergency, "private fun release(").contains("pageRaisedAt.clear()"))
        // Never read by anything that decides the hold.
        assertEquals(
            "pageRaisedAt must only be written in setHoldFrom/release and read by pageRaisedAtMs",
            4,
            Regex("pageRaisedAt[\\[.]").findAll(emergency).count(),
        )
    }

    // ─── it has a caller, and it comes back ──────────────────────────

    @Test
    fun `the foreground service starts it and keeps putting it back`() {
        assertTrue(body(heartbeat, "override fun onCreate(").contains("NativeAlertWatch.ensureStarted(applicationContext)"))
        assertTrue(body(heartbeat, "private suspend fun runLoop(").contains("NativeAlertWatch.kick(ctx,"))
    }

    @Test
    fun `the watchdog alarm kicks it BEFORE the standby skip`() {
        val kick = watchdog.indexOf("NativeAlertWatch.kick(app,")
        val skip = watchdog.indexOf("if (mode == RelaunchMode.SKIP)")
        assertTrue("the Watchdog never kicks the alert watch", kick >= 0)
        assertTrue("a panel in standby is exactly the one to watch — the kick must precede the SKIP return", kick < skip)
    }

    @Test
    fun `screen-off takes the CPU lock before the loop is scheduled`() {
        val off = watch.substring(watch.indexOf("Intent.ACTION_SCREEN_OFF ->"), watch.indexOf("Intent.ACTION_SCREEN_ON ->"))
        val lock = off.indexOf("acquireCpuLock(")
        val kick = off.indexOf("kick(")
        assertTrue(lock >= 0 && kick > lock)
        assertTrue(watch.contains("PowerManager.PARTIAL_WAKE_LOCK"))
        assertTrue(watch.contains("it.setReferenceCounted(false)"))
        assertTrue(
            "the wake lock needs a timeout (lint WakelockTimeout) and a refresh",
            watch.contains("wl.acquire(NativeAlertWatchPolicy.CPU_LOCK_TIMEOUT_MS)"),
        )
    }

    @Test
    fun `the loop runs the engine and the engine asks the policy`() {
        assertTrue(body(watch, "private suspend fun runLoop(").contains("machine.pass()"))
        for (rule in listOf("pollRefusal(", "classify(", "afterPoll(", "onVerdict(", "followUp(", "relaunchDue(", "holdCpu(")) {
            assertTrue("the engine never consults NativeAlertWatchPolicy.$rule", engine.contains("NativeAlertWatchPolicy.$rule"))
        }
    }

    // ─── the request ─────────────────────────────────────────────────

    @Test
    fun `the manifest request is bounded, authenticated, conditional and goes nowhere but an allowed API host`() {
        val fetch = body(watch, "override fun fetchManifest(")
        assertTrue(fetch.contains("/api/v1/screens/\${target.screenId}/manifest"))
        assertFalse("the emergency-rev route has a per-screen floor shared with the page", watch.contains("emergency-rev"))
        assertTrue(fetch.contains("connectTimeout = NativeAlertWatchPolicy.CONNECT_TIMEOUT_MS"))
        assertTrue(fetch.contains("readTimeout = NativeAlertWatchPolicy.READ_TIMEOUT_MS"))
        assertTrue(fetch.contains("NativeAlertWatchPolicy.REQUEST_BUDGET_MS"))
        assertTrue(fetch.contains("DeadlineInputStream("))
        assertTrue(fetch.contains("NativeAlertWatchPolicy.MAX_BODY_BYTES"))
        assertTrue(fetch.contains("instanceFollowRedirects = false"))
        assertTrue(fetch.contains("setRequestProperty(\"Authorization\", \"Bearer \${target.token}\")"))
        assertTrue(fetch.contains("setRequestProperty(\"If-None-Match\", ifNoneMatch)"))
        assertTrue(fetch.contains("requestMethod = \"GET\""))
        // Point-of-use host check, on the narrow API list.
        assertTrue(body(watch, "private fun apiRoot(").contains("HostAllowlist.isApiHost("))
        // No second token writer (player rule 3): this file only reads prefs.
        assertFalse(watch.contains(".edit()"))
    }

    // ─── the Activity ────────────────────────────────────────────────

    @Test
    fun `the raise precedes the launch, and the launch is the post-OTA helper`() {
        val apply = body(engine, "private fun applyVerdict(")
        assertTrue(apply.contains("ports.raise(face, step.openedEpisode)"))
        val pass = body(engine, "fun pass(")
        assertTrue("poll (and raise) must run before the follow-up that launches", pass.indexOf("pollIfDark()") < pass.indexOf("followUp()"))
        assertTrue(body(watch, "override fun bringPlayerForward(").contains("RelaunchEscalation.launchNow(app,"))
    }

    @Test
    fun `MainActivity lends the watch its reload path and nothing else`() {
        assertTrue(body(main, "override fun onCreate(").contains("NativeAlertWatch.setPageHost(alertWatchHost)"))
        assertTrue(body(main, "override fun onDestroy(").contains("NativeAlertWatch.clearPageHost(alertWatchHost)"))
        val reload = body(main, "override fun reloadPage(")
        val mark = reload.indexOf("markNextFinishAborted()")
        val stop = reload.indexOf("webView.stopLoading()")
        val load = reload.indexOf("loadPlayer(resolveDeviceToken())")
        assertTrue("same sequence as the watchdog: mark, stop, load", mark in 0 until stop && stop < load)
        assertTrue("the manager gate is respected, as the watchdog respects it", reload.contains("managerGateShown"))
    }

    // ─── what this fix deliberately does NOT do ──────────────────────

    @Test
    fun `it never guesses at the WebView lifecycle`() {
        for (src in listOf(watch, engine, policy, scanner)) {
            for (guess in listOf("WebView", "resumeTimers", "pauseTimers", "onResume(", "evaluateJavascript")) {
                assertFalse("the alert watch touches `$guess`", src.contains(guess))
            }
        }
    }

    @Test
    fun `the rules and the reader are free of android imports`() {
        for (file in listOf("NativeAlertWatchPolicy.kt", "NativeAlertWatchEngine.kt", "ManifestAlertScanner.kt")) {
            val src = code(read("$pkg/alertwatch/$file"))
            assertFalse("$file imports android.*", Regex("\\nimport android").containsMatchIn(src))
            assertFalse("$file imports org.json", src.contains("import org.json"))
        }
    }

    @Test
    fun `no bridge method was added`() {
        // The page-confirmation signal is the EXISTING displayEmergencyHold
        // call, observed natively; the three-file bridge contract is untouched.
        val channel = read("$pkg/security/NativeBridgeChannel.kt")
        assertFalse(channel.contains("alertWatch", ignoreCase = true))
        assertFalse(code(read("$pkg/WebAppBridge.kt")).contains("NativeAlertWatch"))
    }
}
