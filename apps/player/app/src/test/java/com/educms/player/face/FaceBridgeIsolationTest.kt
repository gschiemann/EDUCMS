package com.educms.player.face

import com.educms.player.display.DisplayEmergency
import com.educms.player.security.BridgeNonce
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assume
import org.junit.Test
import java.io.File

/**
 * THE STRUCTURAL RULES A GREEN FUNCTIONAL TEST CANNOT SEE.
 *
 * Same discipline as `BootBridgeWiringTest` and `LegacyBridgeExposureTest`:
 * read the sources off disk and assert the SHAPE. Those files exist because
 * "112 green tests, no caller" (2026-08-14) is a real failure mode here — and
 * because several of the rules below are one-line regressions that a
 * behaviour test could be edited to accommodate in the same commit.
 *
 * Skipped (not failed) when the sources are not on disk, so a checkout
 * without the player module still runs green.
 */
class FaceBridgeIsolationTest {

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
        Assume.assumeTrue("player module sources not on disk", root != null)
        val f = File(root, relative)
        Assume.assumeTrue("missing $relative", f.isFile)
        return f.readText()
    }

    private val facePlayerHost: String by lazy {
        read("src/main/java/com/educms/player/face/FacePlayerHost.kt")
    }

    /**
     * ⚠️ EVERY "THIS FILE MUST NOT CALL X" ASSERTION RUNS ON THIS, NOT ON THE
     * RAW SOURCE.
     *
     * `FacePlayerHost`'s header explains at length what a face deliberately
     * does NOT do — it names `BootDiagnostics`, `setRequestedOrientation` and
     * `startLockTask` in prose precisely so the next reader knows the
     * omissions are decisions rather than oversights. A naive
     * `!src.contains("BootDiagnostics")` therefore fails on the documentation
     * that exists to protect the rule, which is the worst kind of test: it
     * punishes writing the reason down.
     *
     * Comments only. String LITERALS survive, because several assertions
     * legitimately look for a log message the code emits.
     */
    private fun codeOnly(src: String): String = src
        .replace(Regex("""/\*[\s\S]*?\*/"""), "")
        .lines()
        .filterNot { it.trimStart().startsWith("//") }
        .joinToString("\n")

    private val facePlayerHostCode: String by lazy { codeOnly(facePlayerHost) }

    // ─────────────────────────────────────────────────────────────
    // 1. NO NEW BRIDGE METHOD NAME
    // ─────────────────────────────────────────────────────────────

    /**
     * The face work rides an ARGUMENT on an existing name plus per-INSTANCE
     * constructor lambdas, so the three-file atomic contract and the
     * `KNOWN_METHODS` / `METHOD_FLOORS` fleet-floor rule never engage. If a
     * future change adds a NAME it must go through the full contract — this
     * is the tripwire.
     */
    @Test
    fun `hosting faces added no bridge method name`() {
        val channel = read("src/main/java/com/educms/player/security/NativeBridgeChannel.kt")
        val block = Regex("""private val METHODS = arrayOf\(([\s\S]*?)\n\s*\)""")
            .find(channel)?.groupValues?.get(1)
        Assume.assumeTrue("METHODS block not found", block != null)
        val names = Regex(""""([A-Za-z0-9_]+)"""").findAll(block!!).map { it.groupValues[1] }.toList()
        assertEquals(
            "NativeBridgeChannel.METHODS changed size. The double-sided work must not add a " +
                "method NAME — a new name has to stay out of KNOWN_METHODS until the fleet floor " +
                "includes the APK that implements it, or manifest-less channel devices lose the " +
                "call silently (CLAUDE.md player rule 9).",
            30,
            names.size,
        )
        assertFalse("a face-specific bridge method appeared", names.any { it.startsWith("face") })
    }

    /**
     * ⚠️ LIFE SAFETY. The emergency hold must stay OUTSIDE the nonce gate on
     * both transports. A face on a Chromium-83 panel that can never arm still
     * has to be able to raise and release a hold.
     */
    @Test
    fun `the emergency hold is still a lifeline method`() {
        assertFalse(
            "displayEmergencyHold became nonce-gated — a device that cannot arm loses its alert",
            BridgeNonce.GATED_METHODS.contains("displayEmergencyHold"),
        )
    }

    /**
     * The bridge's default face must be the interlock's primary, or a hold
     * arriving on the one-argument form would be credited to a face the
     * refcount does not know about — and the primary's later all-clear would
     * leave it standing forever.
     */
    @Test
    fun `the bridge's default face is the interlock's primary`() {
        assertEquals(0, DisplayEmergency.PRIMARY_FACE)
        val bridge = read("src/main/java/com/educms/player/WebAppBridge.kt")
        assertTrue(
            "WebAppBridge.PRIMARY_FACE must be 0 to match DisplayEmergency.PRIMARY_FACE",
            bridge.contains("private const val PRIMARY_FACE = 0"),
        )
        assertTrue(
            "the historic one-argument form must still report the primary",
            bridge.contains("displayEmergencyHoldImpl(active, false, PRIMARY_FACE)"),
        )
    }

    // ─────────────────────────────────────────────────────────────
    // 2. A FACE IS NOT A SECOND WRITER OF ANY PER-BOX VALUE
    // ─────────────────────────────────────────────────────────────

    /**
     * ⚠️ `device_fingerprint` and `api_root` key the per-BOX
     * `HeartbeatService`, `OtaUpdateWorker` and diagnostics upload. A face
     * writing them would repoint the whole unit's telemetry at one pane.
     *
     * This is ALSO why `MainActivity.FINGERPRINT_RE` never has to learn about
     * the `::faceN` colon — see the test below.
     */
    @Test
    fun `a face refuses setBootstrap outright`() {
        val src = facePlayerHost
        assertTrue(
            "FacePlayerHost no longer refuses setBootstrap — a face can now repoint the box",
            Regex("""onSetBootstrap\s*=\s*\{\s*_,\s*_\s*->""").containsMatchIn(src),
        )
        assertTrue("the refusal is not logged", src.contains("setBootstrap() — refused"))
        for (perBoxKey in listOf("device_fingerprint", "api_root")) {
            assertFalse(
                "FacePlayerHost writes the per-box key \"$perBoxKey\" — a face repointing it " +
                    "would repoint the whole unit's heartbeat, OTA and diagnostics at one pane",
                Regex("putString\\(\\s*\"" + perBoxKey + "\"").containsMatchIn(facePlayerHostCode),
            )
        }
    }

    /**
     * The face fingerprint is `<primary>::faceN` and the native validator's
     * charset has NO colon. The resolution is that a face never calls
     * setBootstrap — NOT that the regex gets widened by reflex.
     */
    @Test
    fun `the native fingerprint validator was not widened to admit a face colon`() {
        val main = read("src/main/java/com/educms/player/MainActivity.kt")
        val re = Regex("""FINGERPRINT_RE\s*=\s*Regex\("([^"]+)"\)""").find(main)?.groupValues?.get(1)
        Assume.assumeTrue("FINGERPRINT_RE not found", re != null)
        assertFalse(
            "FINGERPRINT_RE now admits ':' — the face fingerprint must never become a " +
                "setBootstrap input (DEVAUTH-01: fingerprint knowledge grants nothing)",
            re!!.contains(":"),
        )
    }

    /**
     * `onSetDeviceToken` defaults to `= {}` in WebAppBridge, so a face bridge
     * that forgets to pass it NO-OPS SILENTLY: the face would appear to pair
     * and then lose its credential on every reload. Assert it is wired.
     */
    @Test
    fun `a face wires its own token writer and can only address its own slot`() {
        val src = facePlayerHost
        assertTrue("onSetDeviceToken is not wired — it would no-op silently", src.contains("onSetDeviceToken ="))
        assertTrue("the face does not write its own slot", src.contains("FaceTokenStore.write("))
        assertFalse(
            "FacePlayerHost names the primary's literal token key — one token store per side",
            facePlayerHostCode.contains("\"device_token\""),
        )
    }

    // ─────────────────────────────────────────────────────────────
    // 3. A FACE DOES NOT CERTIFY, PIN OR STEER THE BOX
    // ─────────────────────────────────────────────────────────────

    /**
     * `BootDiagnostics` holds ONE `BootProgressTracker` and one card. A
     * face's successful `registerResult` would set `satisfied = true` and
     * dismiss the "player never started" card for a PRIMARY that never
     * booted — healthy on evidence that proves nothing, which is the precise
     * failure that subsystem exists to kill.
     */
    @Test
    fun `a face never feeds the box-wide boot tracker`() {
        assertFalse(
            "FacePlayerHost feeds BootDiagnostics — face B's registration would dismiss face A's " +
                "diagnostic card",
            facePlayerHostCode.contains("BootDiagnostics"),
        )
    }

    /**
     * Each of these is a process-global with exactly ONE slot. A second
     * registrant silently evicts the first, and the blackout / KEEP_SCREEN_ON
     * path is the one that matters.
     */
    @Test
    fun `a face never claims a single-slot box singleton`() {
        val src = facePlayerHostCode
        for (forbidden in listOf(
            "DisplayWindowBridge.register",
            "startLockTask",
            "maybeEngageLockTask",
            "setRequestedOrientation",
            "LedCanvasHost.pinAll",
            "SetupCeremony",
        )) {
            assertFalse(
                "FacePlayerHost calls $forbidden — that is a per-box concern with one slot, and a " +
                    "face claiming it evicts the primary",
                src.contains(forbidden),
            )
        }
    }

    /**
     * ⚠️ C-P1-3. Chromium reports a caller-issued `stopLoading()` as a CLEAN
     * `onPageFinished`, so an abort that is not marked self-certifies as a
     * successful load and zeroes the strike counter it just incremented.
     */
    @Test
    fun `a face marks every self-issued abort before stopping the load`() {
        val src = facePlayerHost
        val mark = src.indexOf("markNextFinishAborted()")
        val stop = src.indexOf("stopLoading()")
        assertTrue("the face never marks an abort", mark > 0)
        assertTrue("the face never stops a load", stop > 0)
        assertTrue(
            "markNextFinishAborted() must come BEFORE stopLoading() — otherwise the abort " +
                "self-certifies as a clean load (C-P1-3)",
            mark < stop,
        )
    }

    /**
     * Reloading a pane that is currently showing a lockdown takes the alert
     * off the glass for the length of a cold boot.
     */
    @Test
    fun `a face is never force-reloaded during an emergency hold`() {
        assertTrue(
            "the face watchdog no longer defers to the emergency hold",
            facePlayerHost.contains("DisplayEmergency.isHeld("),
        )
    }

    /**
     * A face torn down while holding would strand its index in the persisted
     * holding set — a hold pinned to a display that no longer exists,
     * unreleasable by anything short of wiping app data.
     */
    @Test
    fun `a face stands its own hold down when it is torn down`() {
        val src = facePlayerHost
        val destroy = src.indexOf("fun destroy()")
        assertTrue("destroy() is gone", destroy > 0)
        assertTrue(
            "destroy() does not stand this face's emergency hold down — a torn-down face would " +
                "strand the interlock on a display that is gone",
            src.substring(destroy).contains("emergencyHoldJson("),
        )
    }

    // ─────────────────────────────────────────────────────────────
    // 4. THE HOST IS INERT UNTIL THE WEB HALF LANDS
    // ─────────────────────────────────────────────────────────────

    /**
     * ⚠️ Both faces share ONE `localStorage` (same origin, same process, no
     * data-directory suffix available on SDK 25). Until `page.tsx` derives
     * its keys through `faceStorage.ts`, hosting a second face would have
     * face B's mint overwrite face A's credential and put BOTH panes into a
     * mutual 401 loop. The default must stay 1.
     */
    @Test
    fun `no face is hosted unless the box is explicitly configured for one`() {
        val src = read("src/main/java/com/educms/player/face/FaceHostController.kt")
        assertTrue(
            "the face count no longer defaults to 1 — every screen in the fleet would start " +
                "hosting a second face before the web storage namespace is wired",
            src.contains("getInt(KEY_FACE_COUNT, 1)"),
        )
        assertTrue(
            "the face count is not clamped to the supported range",
            src.contains("coerceIn(1, FaceDisplayMap.MAX_FACES)"),
        )
    }
}
