package com.educms.player.network

import com.educms.player.network.KeyboardNav.Dir
import com.educms.player.network.KeyboardNav.Pos
import com.educms.player.network.NetworkScreenPolicy.Fix
import com.educms.player.network.NetworkScreenPolicy.Health
import com.educms.player.network.NetworkScreenPolicy.HomeFocus
import com.educms.player.network.NetworkScreenPolicy.Outcome
import com.educms.player.network.NetworkScreenPolicy.Stage
import com.educms.player.network.NetworkScreenPolicy.Words
import com.educms.player.settings.NetworkStatusPolicy
import com.educms.player.settings.WifiScanPolicy
import com.educms.player.settings.WifiScanPolicy.Access
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assume
import org.junit.Test
import java.io.File

/**
 * The redesigned Network screen's FLOWS (2026-10-24), as pure facts — the
 * owner's bar was "the most user friendly workflows ever", so the rules that
 * decide where the remote lands, what the keyboard does and what each result
 * offers next are tested here, not left to a screenshot:
 *
 *  • opening it lands on the most likely next action, never an empty focus;
 *  • the list reads connected → saved → signal, plain words first;
 *  • the keyboard: one-letter Shift + caps lock, a cursor (a typo is fixed
 *    where it is), Connect on the keyboard, focus that wraps;
 *  • every result says what to do next, with the fix as the button;
 *  • an alert-interrupted screen comes back where it was — never the password;
 *  • 1080p and 4K are the same layout; a narrow LED column stays legible;
 *  • the overlay is opaque (the 1.1.53 Screen-options show-through).
 */
class NetworkScreenFlowTest {

    private fun net(ssid: String, rssi: Int, security: String, connected: Boolean = false, saved: Boolean = false) =
        WifiScanPolicy.Network(
            ssid = ssid,
            bars = WifiScanPolicy.bars(rssi),
            rssi = rssi,
            security = security,
            savedBy = if (saved) WifiScanPolicy.SAVED_VENUEOS else null,
            connected = connected,
        )

    // ── where the remote lands ─────────────────────────────────────────

    @Test fun openingLandsOnTheStrongestSecuredNetworkNotYetConnected() {
        val list = listOf(
            net("Lobby", -45, "wpa2", connected = true, saved = true),
            net("Guest", -40, "open"),
            net("Staff", -55, "wpa3"),
            net("Office", -70, "wpa2"),
            net("Corp", -38, "enterprise"),
        )
        assertEquals(HomeFocus.Network("Staff", "wpa3"), NetworkScreenPolicy.homeFocus(Access.GRANTED, list))
        // Only open networks left (besides the connected one): the strongest open one.
        val open = listOf(net("Lobby", -45, "wpa2", connected = true), net("Cafe", -60, "open"), net("Guest", -50, "open"))
        assertEquals(HomeFocus.Network("Guest", "open"), NetworkScreenPolicy.homeFocus(Access.GRANTED, open))
        // An enterprise network VenueOS cannot type a sign-in for is never the pick.
        assertNull(NetworkScreenPolicy.bestCandidate(listOf(net("Corp", -30, "enterprise"), net("Old", -40, "wep"))))
    }

    @Test fun neverAnEmptyFocus() {
        // Nothing found, or the first scan still running: Scan again.
        assertEquals(HomeFocus.ScanAgain, NetworkScreenPolicy.homeFocus(Access.GRANTED, emptyList()))
        assertEquals(HomeFocus.ScanAgain, NetworkScreenPolicy.homeFocus(null, emptyList()))
        assertEquals(HomeFocus.ScanAgain, NetworkScreenPolicy.homeFocus(Access.GRANTED, listOf(net("Lobby", -45, "wpa2", connected = true))))
        // An empty list for a reason: the button that fixes it.
        for (access in listOf(Access.NEEDS_PERMISSION, Access.DENIED, Access.LOCATION_OFF, Access.WIFI_OFF)) {
            assertEquals(access.name, HomeFocus.AccessFix, NetworkScreenPolicy.homeFocus(access, emptyList()))
        }
        // No Wi-Fi at all: Android's own network settings, still a real control.
        assertEquals(HomeFocus.AndroidSettings, NetworkScreenPolicy.homeFocus(Access.NO_WIFI, emptyList()))
    }

    @Test fun everyEmptyListReasonHasItsOwnFixButton() {
        assertEquals(Fix.OPEN_SETUP, NetworkScreenPolicy.accessFix(Access.NEEDS_PERMISSION))
        assertEquals(Fix.OPEN_SETUP, NetworkScreenPolicy.accessFix(Access.DENIED))
        assertEquals("Location off → Turn on Location", Fix.LOCATION_ON, NetworkScreenPolicy.accessFix(Access.LOCATION_OFF))
        assertEquals("Wi-Fi off → Turn on Wi-Fi", Fix.WIFI_ON, NetworkScreenPolicy.accessFix(Access.WIFI_OFF))
        assertNull(NetworkScreenPolicy.accessFix(Access.NO_WIFI))
        assertNull(NetworkScreenPolicy.accessFix(Access.GRANTED))
    }

    // ── what the list says ─────────────────────────────────────────────

    @Test fun theConnectedNetworkFirstThenSavedThenSignal() {
        val ordered = NetworkScreenPolicy.ordered(
            listOf(
                net("Strong", -40, "wpa2"),
                net("Saved", -80, "wpa2", saved = true),
                net("Weak", -85, "open"),
                net("Here", -70, "wpa2", connected = true, saved = true),
                net("Mid", -60, "wpa3"),
            ),
        )
        assertEquals(listOf("Here", "Saved", "Strong", "Mid", "Weak"), ordered.map { it.ssid })
    }

    @Test fun theConnectedRowFollowsTheLiveConnectionNotTheLastScan() {
        // A scan taken the moment Wi-Fi came up says nothing is connected; the status says "Lobby".
        val stale = listOf(net("Lobby", -45, "wpa2"), net("Guest", -60, "open"))
        val live = NetworkScreenPolicy.withLive(stale, NetworkStatusPolicy.T_WIFI, "Lobby")
        assertEquals(listOf(true, false), live.map { it.connected })
        // …so the remote is not parked on the network it is already on.
        assertEquals(HomeFocus.Network("Guest", "open"), NetworkScreenPolicy.homeFocus(Access.GRANTED, live))
        // On a cable (or offline) no Wi-Fi row is the connected one.
        val wasOn = listOf(net("Lobby", -45, "wpa2", connected = true))
        assertFalse(NetworkScreenPolicy.withLive(wasOn, NetworkStatusPolicy.T_ETHERNET, null).single().connected)
        // Android hides the name: the scan's own word stands; not read yet: unchanged.
        assertTrue(NetworkScreenPolicy.withLive(wasOn, NetworkStatusPolicy.T_WIFI, null).single().connected)
        assertEquals(wasOn, NetworkScreenPolicy.withLive(wasOn, null, null))
    }

    @Test fun plainWordsFirstTheProtocolOnlyAsSmallText() {
        assertEquals(NetworkScreenPolicy.Lock.OPEN, NetworkScreenPolicy.lockOf("open"))
        assertEquals(NetworkScreenPolicy.Lock.SECURED, NetworkScreenPolicy.lockOf("wpa2"))
        assertEquals(NetworkScreenPolicy.Lock.SECURED, NetworkScreenPolicy.lockOf("wpa3"))
        assertEquals(NetworkScreenPolicy.Lock.UNSUPPORTED, NetworkScreenPolicy.lockOf("enterprise"))
        assertEquals(NetworkScreenPolicy.Lock.UNSUPPORTED, NetworkScreenPolicy.lockOf("wep"))
        assertEquals("WPA2", NetworkScreenPolicy.protocolOf("wpa2"))
        assertEquals("WPA3", NetworkScreenPolicy.protocolOf("wpa3"))
        assertNull(NetworkScreenPolicy.protocolOf("open"))
        for (sec in listOf("open", "wpa2", "wpa3", "wep", "enterprise", "other")) {
            val p = NetworkScreenPolicy.protocolOf(sec).orEmpty()
            assertFalse("no PSK / SSID jargon: $p", p.contains("PSK") || p.contains("SSID"))
        }
    }

    @Test fun signalInWords() {
        assertEquals(NetworkScreenPolicy.Signal.EXCELLENT, NetworkScreenPolicy.signalOf(4))
        assertEquals(NetworkScreenPolicy.Signal.GOOD, NetworkScreenPolicy.signalOf(3))
        assertEquals(NetworkScreenPolicy.Signal.FAIR, NetworkScreenPolicy.signalOf(2))
        assertEquals(NetworkScreenPolicy.Signal.WEAK, NetworkScreenPolicy.signalOf(1))
        assertEquals(NetworkScreenPolicy.Signal.NONE, NetworkScreenPolicy.signalOf(0))
        assertEquals(NetworkScreenPolicy.Signal.EXCELLENT, NetworkScreenPolicy.signalOf(9))
    }

    @Test fun connectedToVenueOsOnlyOnVenueOsOwnAnswer() {
        assertEquals(Health.CHECKING, NetworkScreenPolicy.health(null, null))
        assertEquals(Health.OFFLINE, NetworkScreenPolicy.health(NetworkStatusPolicy.T_NONE, null))
        assertEquals(Health.CHECKING, NetworkScreenPolicy.health(NetworkStatusPolicy.T_WIFI, null))
        assertEquals(Health.VENUEOS, NetworkScreenPolicy.health(NetworkStatusPolicy.T_WIFI, true))
        assertEquals(Health.NO_VENUEOS, NetworkScreenPolicy.health(NetworkStatusPolicy.T_ETHERNET, false))
    }

    // ── the keyboard ───────────────────────────────────────────────────

    @Test fun shiftIsForOneLetterTwiceIsCapsLock() {
        var k = KeyboardModel().press(KeyboardModel.Key.Shift)
        assertEquals(KeyboardModel.ShiftState.ONCE, k.shift)
        k = k.press(KeyboardModel.Key.Char('V'))
        assertEquals("one capital, then lower case again", KeyboardModel.Layout.LOWER, k.layout)
        k = k.press(KeyboardModel.Key.Shift).press(KeyboardModel.Key.Shift)
        assertEquals(KeyboardModel.ShiftState.LOCKED, k.shift)
        k = k.press(KeyboardModel.Key.Char('O')).press(KeyboardModel.Key.Char('S'))
        assertEquals("caps lock stays", KeyboardModel.ShiftState.LOCKED, k.shift)
        assertEquals("VOS", k.text)
        k = k.press(KeyboardModel.Key.Shift)
        assertEquals("a third press turns it off", KeyboardModel.ShiftState.OFF, k.shift)
        // Symbols cancels Shift; back to letters is lower case.
        k = KeyboardModel().press(KeyboardModel.Key.Shift).press(KeyboardModel.Key.Symbols).press(KeyboardModel.Key.Symbols)
        assertEquals(KeyboardModel.Layout.LOWER, k.layout)
    }

    @Test fun aTypoInTheMiddleIsFixedWhereItIsNeverByRetypingTheTail() {
        var k = "correct horse".fold(KeyboardModel()) { m, c -> m.type(c) }
        // The person spots "horse" should be "house": back 2 (after the 'r'), delete it, type 'u'.
        k = k.moveCursor(-2).deleteBack().type('u')
        assertEquals("correct house", k.text)
        assertEquals("the cursor stays where the fix was made", 11, k.caret)
        // The cursor never leaves the text.
        assertEquals(0, k.moveCursor(-99).caret)
        assertEquals(k.text.length, k.moveCursor(99).caret)
        assertEquals("nothing before the start to delete", k.moveCursor(-99).text, k.moveCursor(-99).deleteBack().text)
        // Clear empties it and puts the cursor home; Done (Connect) never edits.
        assertEquals(0, k.press(KeyboardModel.Key.Clear).caret)
        assertEquals(k, k.press(KeyboardModel.Key.Done))
        assertEquals(k.text.length, k.moveCursor(-4).cursorToEnd().caret)
    }

    @Test fun connectIsAKeyOnTheKeyboardSoNobodyLeavesItToFinish() {
        for (layout in KeyboardModel.Layout.values()) {
            val bottom = KeyboardModel(layout = layout).rows().last()
            assertEquals(KeyboardModel.Key.Done, bottom.last())
            assertTrue(bottom.contains(KeyboardModel.Key.Delete) && bottom.contains(KeyboardModel.Key.Shift))
        }
    }

    @Test fun focusWrapsAroundEveryRowAndTheGridIsStraight() {
        val rows = KeyboardModel().rows().size
        for (r in 0 until rows) assertEquals("row $r spans the ruler", KeyboardNav.GRID, KeyboardNav.spans(r, rows).sum())
        assertEquals(Pos(1, 0), KeyboardNav.move(Pos(1, 9), Dir.RIGHT, rows))
        assertEquals(Pos(1, 9), KeyboardNav.move(Pos(1, 0), Dir.LEFT, rows))
        val last = rows - 1
        // Connect is one press from Shift (Left wraps) and from Delete (Right).
        assertEquals(Pos(last, 4), KeyboardNav.move(Pos(last, 0), Dir.LEFT, rows))
        assertEquals(Pos(last, 4), KeyboardNav.move(Pos(last, 3), Dir.RIGHT, rows))
        // Up from the top row leaves the keyboard for the field; Down at the bottom stays.
        assertNull(KeyboardNav.move(Pos(0, 4), Dir.UP, rows))
        assertEquals(Pos(last, 2), KeyboardNav.move(Pos(last, 2), Dir.DOWN, rows))
    }

    @Test fun downThroughTheWideSpaceBarAndBackUpReturnsToTheSameLetter() {
        val rows = KeyboardModel().rows().size
        val start = Pos(3, 5) // 'n'
        val anchor = KeyboardNav.centreUnit2(start, rows)
        val space = KeyboardNav.move(start, Dir.DOWN, rows, anchor)
        assertEquals(Pos(rows - 1, 2), space)
        assertEquals(start, KeyboardNav.move(space!!, Dir.UP, rows, anchor))
        // Without the anchor, Up from Space lands under its centre.
        assertEquals(Pos(3, 4), KeyboardNav.move(Pos(rows - 1, 2), Dir.UP, rows))
        // Every bottom key has a letter above it and back.
        for (c in 0 until KeyboardNav.BOTTOM_SPANS.size) assertNotNull(KeyboardNav.move(Pos(rows - 1, c), Dir.UP, rows))
    }

    @Test fun theFieldRowSitsOnTheSameRuler() {
        val spans = listOf(14, 3, 3) // field · Show · Clear
        assertEquals(0, KeyboardNav.fieldItemAt(spans, KeyboardNav.centreUnit2(Pos(0, 0), 5)))
        assertEquals(1, KeyboardNav.fieldItemAt(spans, KeyboardNav.centreUnit2(Pos(0, 7), 5)))
        assertEquals(2, KeyboardNav.fieldItemAt(spans, KeyboardNav.centreUnit2(Pos(0, 9), 5)))
        assertEquals(3, KeyboardNav.colAt(0, 5, KeyboardNav.fieldItemCentre2(spans, 0)))
    }

    @Test fun eachCharacterIsReadableForAMomentThenMasked() {
        assertEquals("•••", PasswordMask.render("abc", show = false, revealIndex = null))
        assertEquals("••c", PasswordMask.render("abc", show = false, revealIndex = 2))
        assertEquals("abc", PasswordMask.render("abc", show = true, revealIndex = null))
        assertEquals("", PasswordMask.render("", show = false, revealIndex = 0))
        assertTrue("about a second, like a phone", PasswordMask.REVEAL_MS in 700L..1_500L)
    }

    // ── connecting and results ─────────────────────────────────────────

    @Test fun stagesFollowWhatTheScreenCanSee() {
        assertEquals(Stage.JOINING, NetworkScreenPolicy.stage(onNetwork = false, hasAddress = false, venueos = null))
        assertEquals(Stage.JOINING, NetworkScreenPolicy.stage(onNetwork = null, hasAddress = true, venueos = true))
        assertEquals(Stage.ADDRESS, NetworkScreenPolicy.stage(onNetwork = true, hasAddress = false, venueos = null))
        assertEquals(Stage.CHECKING, NetworkScreenPolicy.stage(onNetwork = true, hasAddress = true, venueos = null))
        assertEquals(Stage.CHECKING, NetworkScreenPolicy.stage(onNetwork = true, hasAddress = true, venueos = false))
        assertEquals(Stage.DONE, NetworkScreenPolicy.stage(onNetwork = true, hasAddress = true, venueos = true))
        assertEquals(true, NetworkScreenPolicy.onNetwork(NetworkStatusPolicy.T_WIFI, "Staff", "Staff"))
        assertEquals(false, NetworkScreenPolicy.onNetwork(NetworkStatusPolicy.T_WIFI, "Lobby", "Staff"))
        assertNull("Android hides the name: unknown, not no", NetworkScreenPolicy.onNetwork(NetworkStatusPolicy.T_WIFI, null, "Staff"))
        assertEquals(false, NetworkScreenPolicy.onNetwork(NetworkStatusPolicy.T_ETHERNET, null, "Staff"))
    }

    @Test fun aWrongPasswordGoesStraightBackToThePassword() {
        assertEquals(Outcome.PASSWORD, NetworkScreenPolicy.outcome(Words.WRONG_PASSWORD))
        assertEquals(Fix.EDIT_PASSWORD, NetworkScreenPolicy.plan(Words.WRONG_PASSWORD, secured = true).primary)
        assertEquals(Fix.EDIT_PASSWORD, NetworkScreenPolicy.plan(Words.COULD_NOT_JOIN, secured = true).primary)
        assertEquals(Fix.TRY_AGAIN, NetworkScreenPolicy.plan(Words.COULD_NOT_JOIN, secured = false).primary)
        // An open network has no password to fix — never send a person to a password page for it.
        assertEquals(Fix.TRY_AGAIN, NetworkScreenPolicy.plan(Words.WRONG_PASSWORD, secured = false).primary)
        for (w in Words.values()) {
            assertTrue("$w on an open network", NetworkScreenPolicy.plan(w, secured = false).primary != Fix.EDIT_PASSWORD)
        }
    }

    @Test fun everyResultSaysWhatToDoNextWithTheFixAsTheButton() {
        for (w in Words.values()) {
            val plan = NetworkScreenPolicy.plan(w, secured = true)
            assertTrue("$w offers a different second step", plan.secondary == null || plan.secondary != plan.primary)
        }
        assertEquals(Outcome.SUCCESS, NetworkScreenPolicy.outcome(Words.CONNECTED))
        assertEquals(Fix.DONE, NetworkScreenPolicy.plan(Words.CONNECTED, secured = true).primary)
        assertEquals("not reachable → Scan again", Fix.SCAN_AGAIN, NetworkScreenPolicy.plan(Words.NO_SERVER, secured = true).primary)
        assertEquals(Fix.WIFI_ON, NetworkScreenPolicy.plan(Words.WIFI_OFF, secured = true).primary)
        assertEquals(Fix.ANDROID_SETTINGS, NetworkScreenPolicy.plan(Words.NOT_SUPPORTED, secured = false).primary)
        assertEquals(Fix.ANDROID_SETTINGS, NetworkScreenPolicy.plan(Words.NAME_TAKEN, secured = true).primary)
        assertEquals(Fix.TRY_AGAIN, NetworkScreenPolicy.plan(Words.DECLINED, secured = true).primary)
        // Android took it but decides when to move: watched, then "Saved" — never claimed as connected.
        assertEquals(Outcome.SAVED, NetworkScreenPolicy.outcome(Words.SAVED))
        assertEquals(Outcome.SAVED, NetworkScreenPolicy.outcome(Words.SUGGESTED))
        for (w in listOf(Words.WAITING_DIALOG, Words.WAITING_APPROVAL, Words.JOINING)) {
            assertEquals("$w is still in progress", Outcome.WAITING, NetworkScreenPolicy.outcome(w))
        }
        for (w in listOf(Words.COULD_NOT_JOIN, Words.NO_SERVER, Words.DECLINED, Words.WIFI_OFF, Words.NAME_TAKEN, Words.NOT_SUPPORTED, Words.FAILED, Words.ALERT)) {
            assertEquals(Outcome.FAILURE, NetworkScreenPolicy.outcome(w))
        }
    }

    @Test fun whatTheScreenSeesPromotesAQuietEngineButNeverUnderASystemDialog() {
        val p = NetworkScreenPolicy
        // Saved / approval-pending, and the screen is on it with VenueOS answering: success.
        assertEquals(NetworkScreenPolicy.Promotion.SUCCESS, p.promote(Words.SAVED, Stage.DONE, systemDialogUp = false, watchExpired = false))
        assertEquals(NetworkScreenPolicy.Promotion.SUCCESS, p.promote(Words.WAITING_APPROVAL, Stage.DONE, systemDialogUp = false, watchExpired = false))
        // Android's own prompt still on top: not yet.
        assertEquals(NetworkScreenPolicy.Promotion.NONE, p.promote(Words.WAITING_APPROVAL, Stage.DONE, systemDialogUp = true, watchExpired = false))
        assertEquals(NetworkScreenPolicy.Promotion.NONE, p.promote(Words.SAVED, Stage.DONE, systemDialogUp = true, watchExpired = false))
        // A save that never moves: "Not connected yet" when the watch runs out — never "Connected".
        assertEquals(NetworkScreenPolicy.Promotion.NOT_YET, p.promote(Words.SUGGESTED, Stage.JOINING, systemDialogUp = false, watchExpired = true))
        assertEquals(NetworkScreenPolicy.Promotion.NONE, p.promote(Words.SAVED, Stage.CHECKING, systemDialogUp = false, watchExpired = false))
        // An approval that never comes ends as "Not connected yet" when the watch runs out; a switch being proved ends with the engine's word.
        assertEquals(NetworkScreenPolicy.Promotion.NOT_YET, p.promote(Words.WAITING_APPROVAL, Stage.JOINING, systemDialogUp = false, watchExpired = true))
        assertEquals(NetworkScreenPolicy.Promotion.NONE, p.promote(Words.JOINING, Stage.DONE, systemDialogUp = false, watchExpired = true))
        assertEquals(NetworkScreenPolicy.Promotion.NONE, p.promote(Words.WAITING_DIALOG, Stage.DONE, systemDialogUp = false, watchExpired = true))
        assertEquals(NetworkScreenPolicy.Promotion.NONE, p.promote(null, Stage.DONE, systemDialogUp = false, watchExpired = true))
    }

    @Test fun successReturnsByItselfAfterAboutThreeSeconds() {
        assertTrue(NetworkScreenPolicy.SUCCESS_RETURN_MS in 2_000L..4_000L)
        assertTrue("never a frozen screen: the stages re-read at least every second", NetworkScreenPolicy.STAGE_POLL_MS <= 1_000L)
        assertTrue("a saved network is watched, then said", NetworkScreenPolicy.WATCH_JOIN_MS in 10_000L..60_000L)
    }

    // ── an alert interrupts ────────────────────────────────────────────

    @Test fun anAlertInterruptedStepComesBackForAFewMinutes() {
        val s = NetworkResume.Snapshot(NetworkResume.Step.PASSWORD, "Staff", "wpa3", hidden = false, savedAtElapsedMs = 1_000L)
        assertEquals(s, NetworkResume.restore(s, 1_000L + 60_000L))
        assertEquals(s, NetworkResume.restore(s, 1_000L + NetworkResume.WINDOW_MS))
        assertNull("too late", NetworkResume.restore(s, 1_001L + NetworkResume.WINDOW_MS))
        assertNull("a clock that went backwards is not fresh", NetworkResume.restore(s, 500L))
        assertNull(NetworkResume.restore(null, 1_000L))
    }

    @Test fun theRememberedStepNeverHoldsThePassword() {
        val fields = NetworkResume.Snapshot::class.java.declaredFields.map { it.name.lowercase() }
        for (f in fields) {
            assertFalse("Snapshot.$f looks like a secret", f.contains("pass") || f.contains("secret") || f.contains("key"))
        }
    }

    // ── sizes ──────────────────────────────────────────────────────────

    @Test fun fourKIsTheSameLayoutAsTenEightyNeverTiny() {
        val hd = NetworkLayout.metrics(1920, 1080)
        val uhd = NetworkLayout.metrics(3840, 2160)
        assertEquals(1f, hd.unit, 0.001f)
        assertEquals(2f, uhd.unit, 0.001f)
        assertEquals(hd.widthDu, uhd.widthDu, 0.01f)
        assertTrue(hd.wide && uhd.wide)
        assertTrue("1440×1080 still fits two columns", NetworkLayout.metrics(1440, 1080).wide)
        assertTrue("720p is the 1080p layout", NetworkLayout.metrics(1280, 720).wide)
    }

    @Test fun portraitAndNarrowLedGetOneLegibleColumn() {
        val portrait = NetworkLayout.metrics(1080, 1920)
        assertFalse(portrait.wide)
        assertEquals(1f, portrait.unit, 0.001f)
        val poster = NetworkLayout.metrics(320, 1080)
        assertFalse(poster.wide)
        assertEquals("a narrow LED column never shrinks below the floor", NetworkLayout.MIN_UNIT, poster.unit, 0.001f)
        assertTrue("…so it is laid out as a ~760-unit column", poster.widthDu in 700f..800f)
        assertFalse(NetworkLayout.metrics(1280, 1080).wide)
    }

    @Test fun theOverlayIsOpaqueSoNothingUnderneathShowsThrough() {
        for (c in listOf(NetTheme.BG_TOP, NetTheme.BG_MID, NetTheme.BG_BOTTOM)) {
            assertEquals("the base of the background is fully opaque", 0xFF, c ushr 24)
        }
    }

    // ── source facts ───────────────────────────────────────────────────

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

    @Test fun everyStringInAllThreeLanguagesAndNoJargon() {
        val keys = Regex("name=\"([a-z0-9_]+)\"")
        val files = listOf("values", "values-es", "values-zh").associateWith { read("src/main/res/$it/strings_network.xml") }
        val en = keys.findAll(files.getValue("values")).map { it.groupValues[1] }.toSet()
        for ((dir, xml) in files) {
            assertEquals("$dir has every Network-screen string", en, keys.findAll(xml).map { it.groupValues[1] }.toSet())
            val texts = Regex(">([^<]*)</string>").findAll(xml).map { it.groupValues[1] }
            for (t in texts) assertFalse("$dir: \"$t\" uses SSID / PSK jargon", t.contains("SSID") || t.contains("PSK"))
        }
    }

    @Test fun theDemoIsDebugOnlyAndTheReleaseBuildHasNone() {
        val release = read("src/release/java/com/educms/player/network/NetworkScreenDemo.kt")
        assertTrue(release.contains("fun scenario(ctx: Context): NetworkDemo? = null"))
        assertTrue(read("src/debug/java/com/educms/player/network/NetworkScreenDemo.kt").contains("internal object NetworkScreenDemo"))
        // The main source set never builds a scenario: only the debug source set does.
        val mainDir = File(moduleRoot!!, "src/main/java/com/educms/player")
        val builders = mainDir.walkTopDown().filter { it.isFile && it.extension == "kt" && it.name != "NetworkDemo.kt" }
            .filter { Regex("\\bNetworkDemo\\(").containsMatchIn(it.readText()) }.map { it.name }.toList()
        assertEquals("no main-source scenarios", emptyList<String>(), builders)
        // And the screen never calls the engine while a demo runs (every engine path checks it first).
        val screen = read("src/main/java/com/educms/player/network/NetworkScreen.kt")
        assertTrue(screen.contains("demo?.let { d ->"))
    }

    @Test fun theOverlayIsPinnedToTheLedCanvasAndPaintsItsOwnOpaqueGround() {
        val screen = read("src/main/java/com/educms/player/network/NetworkScreen.kt")
        val open = screen.substring(screen.indexOf("fun open("), screen.indexOf("fun back("))
        assertTrue("on a poster the screen lands on the LED, not centred off it", open.contains("LedCanvasHost.pin(view)"))
        assertTrue(screen.contains("background = LayerDrawable(arrayOf(base, glow, glow2))"))
        assertFalse("1.1.53's 95 % scrim let the Screen options menu show through", screen.contains("0xF20F172A"))
    }
}
