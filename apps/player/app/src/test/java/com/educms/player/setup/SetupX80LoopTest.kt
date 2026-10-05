package com.educms.player.setup

import com.educms.player.setup.SetupCeremonyMath.ChecklistInput
import com.educms.player.setup.SetupCeremonyMath.ChecklistMode
import com.educms.player.setup.SetupCeremonyMath.RowStatus
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assume
import org.junit.Test
import java.io.File

/**
 * THE X80 SETUP FREEZE (2026-10-05, v1.1.23).
 *
 * VisionCore X80 (Goodview firmware, RK3328, Android 11), owner on site with
 * only a remote: Enter on the setup card opened a Google web page, Back came
 * back to the SAME card, the D-pad "could not get anywhere else", and the way
 * out was a power cycle — twice. The lead's required outcome:
 *
 *  1. a step whose Settings page this screen does not have says so ON THE
 *     CARD in plain words and is skipped — never a web page, never a button;
 *  2. every card with an action has a second reachable control ("Skip this
 *     step"), and the D-pad moves between them;
 *  3. Back closes the card until the next restart;
 *  4. a skipped or impossible step never re-arms itself in a loop.
 *
 * Plus the root causes the agent found in code: a failed launch cleared the
 * step's marker (re-arming it on the next render), focus could escape the
 * card into a WebView behind it, and the Watchdog relaunched the player over
 * the Settings screen the operator was using.
 */
class SetupX80LoopTest {

    private val core = listOf(
        "installPromptShown",
        "writeSettingsPromptShown",
        "batteryExemptPromptShown",
        "overlayPromptShown",
        "homeSetupPromptShown",
    )

    private fun input(
        key: String,
        satisfied: Boolean = false,
        offered: Boolean = false,
        unavailable: String? = null,
        optional: Boolean = false,
    ) = ChecklistInput(
        state = StepState(
            key = key,
            applies = true,
            satisfied = satisfied,
            offered = offered,
            optional = optional,
            unavailable = unavailable != null,
            unavailableReason = unavailable,
        ),
        name = "name-$key",
        why = "why-$key",
        hint = "hint-$key",
    )

    // ─── 1. a step this screen cannot do is never a button ──────────────

    @Test
    fun `an unavailable step is never armed — the next doable step is`() {
        val model = SetupCeremonyMath.buildModel(
            listOf(
                input("installPromptShown", satisfied = true),
                input("writeSettingsPromptShown", unavailable = SetupCeremonyMath.UNAVAILABLE_NO_PAGE),
                input("batteryExemptPromptShown"),
            ),
        )
        assertEquals(ChecklistMode.GRANTING, model.mode)
        assertEquals("batteryExemptPromptShown", model.primaryKey)
        val dead = model.rows.first { it.key == "writeSettingsPromptShown" }
        assertEquals(RowStatus.UNAVAILABLE, dead.status)
        assertFalse("a row with no page behind it must not be a button", dead.actionable)
        assertEquals("it says so in plain words", SetupCeremonyMath.UNAVAILABLE_NO_PAGE, dead.why)
        assertNull("no Settings directions for a page that is not there", dead.hint)
    }

    @Test
    fun `the plain-words reasons say skipped and never name an intent`() {
        for (text in listOf(
            SetupCeremonyMath.UNAVAILABLE_NO_PAGE,
            SetupCeremonyMath.UNAVAILABLE_LAUNCH_FAILED,
            SetupCeremonyMath.unavailableNotSettings("Chrome"),
            SetupCeremonyMath.unavailableNotSettings(null),
        )) {
            assertTrue(text, text.startsWith("Not available on this screen"))
            assertTrue(text, text.contains("Skipped"))
            assertFalse(text, text.contains("android.settings"))
            assertFalse(text, text.contains("ACTION_"))
        }
        assertTrue(SetupCeremonyMath.unavailableNotSettings("Chrome").contains("Chrome"))
    }

    @Test
    fun `an unavailable step does not count, so the card can still finish`() {
        // Every doable core step held, the rest impossible here: this screen
        // is DONE — not "Setup paused" forever over a page that is not there.
        val model = SetupCeremonyMath.buildModel(
            core.map {
                if (it == "batteryExemptPromptShown" || it == "homeSetupPromptShown") {
                    input(it, unavailable = SetupCeremonyMath.UNAVAILABLE_LAUNCH_FAILED)
                } else {
                    input(it, satisfied = true)
                }
            },
        )
        assertEquals(ChecklistMode.COMPLETE, model.mode)
        assertEquals("3 of 3 done", model.progress)
        assertNull(model.primaryKey)
        assertEquals(2, model.rows.count { it.status == RowStatus.UNAVAILABLE })
    }

    @Test
    fun `an impossible optional step is not counted as optional work outstanding`() {
        val model = SetupCeremonyMath.buildModel(
            listOf(
                input("installPromptShown", satisfied = true),
                input(
                    "deviceAdminPromptShown",
                    optional = true,
                    unavailable = SetupCeremonyMath.UNAVAILABLE_NO_PAGE,
                ),
            ),
        )
        assertEquals(0, model.optionalOutstanding)
    }

    // ─── 2. two reachable controls; Skip advances and the card stays ────

    @Test
    fun `an armed card offers the action AND Skip this step`() {
        val model = SetupCeremonyMath.buildModel(core.map { input(it) })
        assertNotNull(model.primaryLabel)
        assertEquals(SetupCeremonyMath.SKIP_LABEL, model.secondaryLabel)
    }

    @Test
    fun `skipping is offering — the next step arms and the card stays GRANTING`() {
        // What skipByOperator does to the facts: the armed step is marked
        // offered. The card then re-renders with the NEXT step armed.
        val before = SetupCeremonyMath.buildModel(core.map { input(it) })
        assertEquals("installPromptShown", before.primaryKey)
        val after = SetupCeremonyMath.buildModel(
            core.map { input(it, offered = it == "installPromptShown") },
        )
        assertEquals(ChecklistMode.GRANTING, after.mode)
        assertEquals("writeSettingsPromptShown", after.primaryKey)
        // The skipped row stays visible AND tappable — never re-armed on its
        // own, but the operator can always go back to it.
        val skipped = after.rows.first { it.key == "installPromptShown" }
        assertEquals(RowStatus.NEEDED, skipped.status)
        assertTrue(skipped.actionable)
    }

    @Test
    fun `skipping every step ends on Done with a reachable row, never a dead card`() {
        val model = SetupCeremonyMath.buildModel(core.map { input(it, offered = true) })
        assertEquals(ChecklistMode.PAUSED, model.mode)
        assertEquals(SetupCeremonyMath.PRIMARY_DONE, model.primaryLabel)
        assertTrue("PAUSED keeps at least one row the D-pad can reach", model.rows.any { it.actionable })
    }

    @Test
    fun `a skipped step is never armed again on its own — no loop`() {
        // The same facts, rendered again and again (every resume): the
        // skipped/offered step must not come back as the primary.
        val facts = core.map { input(it, offered = it == "writeSettingsPromptShown") }
        repeat(5) {
            val model = SetupCeremonyMath.buildModel(facts)
            assertFalse(model.primaryKey == "writeSettingsPromptShown")
        }
    }

    @Test
    fun `the post-update offer keeps Not now — an answer about one build`() {
        val model = SetupCeremonyMath.buildModel(
            listOf(input("overlayPromptShown")),
            secondaryOverride = SetupCeremonyMath.NOT_NOW_LABEL,
        )
        assertEquals(SetupCeremonyMath.NOT_NOW_LABEL, model.secondaryLabel)
    }

    @Test
    fun `the armed card tells the operator Back closes it`() {
        assertTrue(SetupCeremonyMath.FOOTNOTE_GRANTING.contains("Press Back"))
    }

    // ─── 3. Back holds until the screen restarts ─────────────────────────

    @Test
    fun `Back holds across a process restart in the same boot`() {
        assertTrue(SetupCeremonyMath.hiddenUntilReboot(7, 60_000L, 7, 3_600_000L))
    }

    @Test
    fun `a reboot brings the card back`() {
        // Different boot count.
        assertFalse(SetupCeremonyMath.hiddenUntilReboot(7, 60_000L, 8, 3_600_000L))
        // No boot count on this ROM: elapsedRealtime going backwards is a reboot.
        assertFalse(SetupCeremonyMath.hiddenUntilReboot(-1, 600_000L, -1, 30_000L))
        assertTrue(SetupCeremonyMath.hiddenUntilReboot(-1, 600_000L, -1, 900_000L))
    }

    @Test
    fun `never hidden is not hidden`() {
        assertFalse(SetupCeremonyMath.hiddenUntilReboot(-1, 0L, 3, 10_000L))
        assertFalse(SetupCeremonyMath.hiddenUntilReboot(3, 0L, 3, 10_000L))
    }

    // ─── 4. the player does not jump in front of the operator ───────────

    @Test
    fun `a relaunch yields while the operator is in a system screen from the card`() {
        val away = 1_000_000L
        assertTrue(SetupCeremonyMath.yieldRelaunchToSetup(away, away + 60_000L, emergencyHeld = false))
        assertTrue(
            SetupCeremonyMath.yieldRelaunchToSetup(
                away,
                away + SetupCeremonyMath.SETUP_AWAY_YIELD_MS - 1,
                emergencyHeld = false,
            ),
        )
    }

    @Test
    fun `the yield is bounded — the kiosk takes its screen back`() {
        val away = 1_000_000L
        assertFalse(
            SetupCeremonyMath.yieldRelaunchToSetup(
                away,
                away + SetupCeremonyMath.SETUP_AWAY_YIELD_MS,
                emergencyHeld = false,
            ),
        )
    }

    @Test
    fun `an alert never yields to setup`() {
        assertFalse(SetupCeremonyMath.yieldRelaunchToSetup(1_000L, 2_000L, emergencyHeld = true))
    }

    @Test
    fun `no card, or a clock that went backwards, never yields`() {
        assertFalse(SetupCeremonyMath.yieldRelaunchToSetup(0L, 2_000L, emergencyHeld = false))
        assertFalse(SetupCeremonyMath.yieldRelaunchToSetup(5_000L, 2_000L, emergencyHeld = false))
    }

    // ─── wiring: the source says what the tests above assume ─────────────

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
        val f = File(root, relative)
        Assume.assumeTrue("source not on disk: $relative", f.isFile)
        return f.readText()
    }

    private fun code(src: String): String = src
        .replace(Regex("/\\*[\\s\\S]*?\\*/"), "")
        .replace(Regex("//[^\\n]*"), "")

    private fun body(src: String, signature: String): String {
        val start = src.indexOf(signature)
        assertTrue("missing: $signature", start >= 0)
        var depth = 0
        var i = src.indexOf('{', start)
        val open = i
        while (i < src.length) {
            when (src[i]) {
                '{' -> depth++
                '}' -> {
                    depth--
                    if (depth == 0) return src.substring(open, i + 1)
                }
            }
            i++
        }
        return src.substring(open)
    }

    private val ceremony by lazy { code(require("src/main/java/com/educms/player/setup/SetupCeremony.kt")) }

    @Test
    fun `a failed launch never clears the marker — the 1·1·22 re-arm loop`() {
        assertFalse(
            "clearOffered re-armed a step whose page would not open on the very next render",
            ceremony.contains("clearOffered("),
        )
        val fire = body(ceremony, "private fun fire(")
        assertTrue(
            "a page that will not open here must mark the step unavailable for this firmware",
            fire.contains("markUnavailableOnThisFirmware("),
        )
    }

    @Test
    fun `every page the card opens is opened explicitly, never as an implicit intent`() {
        val starts = Regex("startActivity\\(([^)]*)\\)").findAll(ceremony).map { it.groupValues[1] }.toList()
        assertTrue("no startActivity found — the launch moved", starts.isNotEmpty())
        for (arg in starts) {
            assertTrue(
                "SetupCeremony.startActivity($arg) is not aimed at a vetted component — a ROM " +
                    "can hand an implicit Settings intent to a browser (the X80 Google page)",
                arg.trim().startsWith("explicit("),
            )
        }
        assertTrue(ceremony.contains("setClassName(handler.packageName, handler.activityName)"))
        assertTrue(ceremony.contains("SettingsPagePolicy.decide("))
    }

    @Test
    fun `a click is answered from the facts the card was drawn from — no binder call on the key path`() {
        val fire = body(ceremony, "private fun fire(")
        assertFalse("fire() must not read a grant live on the main thread", fire.contains("isSatisfied("))
        assertFalse("fire() must not resolve intents on the main thread", fire.contains("SetupFactsReader.resolve("))
        assertTrue(fire.contains("latestFacts"))
        assertTrue(
            "facts are read on the setup-facts thread",
            ceremony.contains("factsExecutor.execute"),
        )
    }

    @Test
    fun `the card keeps the D-pad, shows a ring, and only closes on a Back it saw begin`() {
        val view = code(require("src/main/java/com/educms/player/setup/SetupChecklistView.kt"))
        assertTrue(
            "the focus search must stay inside the card",
            view.contains("override fun focusSearch(") &&
                view.contains("FocusFinder.getInstance().findNextFocus(this, focused, direction)"),
        )
        assertTrue("a visible selection ring", view.contains("foreground = ringDrawable"))
        assertTrue("Back needs the DOWN the card saw", view.contains("backDownSeen && !event.isCanceled"))
        assertTrue("Done closes the card", view.contains("if (key == null) onDone() else onGrant(key)"))
        // A selection stranded on the card root: the D-pad moves it onto a
        // real control, and OK never fires an action nobody saw selected
        // (1.1.22 pressed the primary — Enter → Google, every time).
        assertTrue(view.contains("if (!isControl(focused)) return firstControl() ?: focused"))
        assertFalse(
            "OK on the root must not press the primary",
            view.contains("primaryButton.performClick()"),
        )
        // Focus that leaves the card while it is up is taken back — a view
        // behind the scrim can never keep the remote.
        val watcher = body(view, "private val focusWatcher")
        assertTrue(watcher.contains("!contains(newFocus)"))
        assertTrue(watcher.contains("reclaimFocus()"))
        assertTrue(view.contains("addOnGlobalFocusChangeListener(focusWatcher)"))
        assertTrue(view.contains("removeOnGlobalFocusChangeListener(focusWatcher)"))
    }

    @Test
    fun `MainActivity closes the card on Back and never lets a site view steal the remote`() {
        val main = code(require("src/main/java/com/educms/player/MainActivity.kt"))
        val back = body(main, "override fun handleOnBackPressed()")
        val close = back.indexOf("closeFromActivityBack(")
        val gate = back.indexOf("managerGateShown && readManagerVersion() == null")
        assertTrue("Back must close the setup card", close >= 0)
        assertTrue("…before anything else gets the press", gate < 0 || close < gate)
        assertTrue(
            "a website slide must not take focus from a native card",
            main.contains("if (!nativeCardOwnsRemote()) urlOverlayView.requestFocus()"),
        )
        assertTrue(main.contains("SetupCeremony.noteHostPaused()"))
        assertTrue(main.contains("SetupCeremony.noteHostResumed()"))
    }

    @Test
    fun `the background relaunch paths yield to a person working in Settings`() {
        val watchdog = code(require("src/main/java/com/educms/player/watchdog/Watchdog.kt"))
        val tick = watchdog.indexOf("relaunchShouldYield(")
        val launch = watchdog.indexOf("ctx.startActivity(launch)")
        assertTrue("the Watchdog must ask before it relaunches", tick in 0 until launch)
        val escalation = code(require("src/main/java/com/educms/player/ota/RelaunchEscalation.kt"))
        val attempt = body(escalation, "fun attempt(")
        assertTrue(attempt.contains("relaunchShouldYield("))
    }

    @Test
    fun `the manifest lets a release build see every page the card opens`() {
        val manifest = require("src/main/AndroidManifest.xml")
        for (action in listOf(
            "android.settings.MANAGE_UNKNOWN_APP_SOURCES",
            "android.settings.action.MANAGE_WRITE_SETTINGS",
            "android.settings.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS",
            "android.settings.IGNORE_BATTERY_OPTIMIZATION_SETTINGS",
            "android.settings.action.MANAGE_OVERLAY_PERMISSION",
            "android.app.action.ADD_DEVICE_ADMIN",
            "android.settings.SECURITY_SETTINGS",
            "android.settings.MANAGE_APPLICATIONS_SETTINGS",
            "android.settings.HOME_SETTINGS",
            "android.settings.SETTINGS",
        )) {
            assertTrue("<queries> is missing $action", manifest.contains("\"$action\""))
        }
        assertTrue(
            "browsers must be visible to be recognised",
            manifest.contains("android.intent.category.BROWSABLE"),
        )
    }
}
