package com.educms.player.setup

import com.educms.player.setup.SetupCeremonyMath.ChecklistInput
import com.educms.player.setup.SetupCeremonyMath.ChecklistMode
import com.educms.player.setup.SetupCeremonyMath.RelaunchGrantFacts
import com.educms.player.setup.SetupCeremonyMath.RowStatus
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assume
import org.junit.Test
import java.io.File

/**
 * ── THE RELAUNCH GRANT ("Display over other apps"), 2026-09-01 ───────────
 *
 * WHY IT EXISTS. Two Goodview panels — one Android 11 carrying a VENDOR
 * device owner, one Android 13 with none — installed an OTA and the app
 * never relaunched; the operator walked to each one. Android 10+ silently
 * drops a background `startActivity` unless the app is the default HOME,
 * is / has a device owner, or holds this grant. On this fleet the
 * device-owner slot belongs to the vendor and HOME is the guest step we ask
 * for LAST, so this grant is the one route that is both available and cheap.
 *
 * It ships two ways, and both are pinned here:
 *
 *  1. AS A CEREMONY STEP, core, immediately BEFORE the HOME step (HOME stays
 *     last for the reason its own comment gives).
 *  2. AS A ONE-TIME POST-UPGRADE OFFER, because a screen that finished its
 *     ceremony BEFORE this shipped will never meet the new step in a flow it
 *     already completed — and that is exactly the fleet with the problem.
 *
 * ⚠️ THE OFFER'S TWO FAILURE DIRECTIONS, which is what most of this suite
 * is about. Too eager and it becomes a full-screen card over a customer's
 * live board on every boot; too shy and the panels that need it never hear
 * about it. The predicate below is the whole of that decision.
 */
class RelaunchGrantOfferTest {

    private val overlayKey = "overlayPromptShown"

    // ─── 1. the post-upgrade offer predicate ────────────────────────

    private fun facts(
        lastHandledVc: Long = 118L,
        currentVc: Long = 119L,
        previouslyProvisioned: Boolean = true,
        overlayGranted: Boolean = false,
        isHomeApp: Boolean = false,
        declinedVc: Long = 0L,
    ) = RelaunchGrantFacts(
        lastHandledVc,
        currentVc,
        previouslyProvisioned,
        overlayGranted,
        isHomeApp,
        declinedVc,
    )

    @Test
    fun `a real upgrade on an ungranted panel is offered`() {
        // THE TWO PANELS: the version changed, no overlay grant, not HOME.
        assertTrue(SetupCeremonyMath.shouldOfferRelaunchGrant(facts()))
    }

    @Test
    fun `a FRESH install is never offered — the ceremony owns that screen`() {
        // No marker AND never been through setup = a first install, not an
        // upgrade. Without this guard every first boot would read as "the
        // version changed" and this card would race the real first-boot
        // checklist — two drivers on one screen, the exact stacking the
        // checklist shell was built to end.
        assertFalse(
            SetupCeremonyMath.shouldOfferRelaunchGrant(
                facts(lastHandledVc = 0L, previouslyProvisioned = false),
            ),
        )
    }

    @Test
    fun `the OTA that introduces the marker still reaches the deployed fleet`() {
        // ⚠️ THE HALF THAT IS EASY TO MISS. On the update that ships this
        // feature, EVERY already-deployed panel reads lastHandledVc == 0 —
        // and those are exactly the screens with the problem. A guard of
        // "marker > 0" alone would offer nothing to anybody on the one boot
        // that matters, and the feature would look like it worked.
        assertTrue(
            SetupCeremonyMath.shouldOfferRelaunchGrant(
                facts(lastHandledVc = 0L, previouslyProvisioned = true),
            ),
        )
    }

    @Test
    fun `the same build is only ever asked once`() {
        assertFalse(
            "a reboot is not an upgrade — this is what stops it appearing on every boot",
            SetupCeremonyMath.shouldOfferRelaunchGrant(facts(lastHandledVc = 119L, currentVc = 119L)),
        )
    }

    @Test
    fun `a panel that can already relaunch itself is never asked`() {
        assertFalse(
            "it holds the grant — asking for it again is a card over live signage for nothing",
            SetupCeremonyMath.shouldOfferRelaunchGrant(facts(overlayGranted = true)),
        )
        assertFalse(
            "the OS relaunches HOME by itself, so a HOME-default panel has nothing to gain",
            SetupCeremonyMath.shouldOfferRelaunchGrant(facts(isHomeApp = true)),
        )
    }

    @Test
    fun `a decline holds for that build and lifts at the next upgrade`() {
        assertFalse(
            "\"Not now\" must mean not now, for this build",
            SetupCeremonyMath.shouldOfferRelaunchGrant(facts(declinedVc = 119L)),
        )
        assertTrue(
            "a decline about v119 says nothing about v120 — the question is worth re-asking " +
                "once per update, and never more often",
            SetupCeremonyMath.shouldOfferRelaunchGrant(
                facts(lastHandledVc = 119L, currentVc = 120L, declinedVc = 119L),
            ),
        )
    }

    // ─── 2. the offer card ──────────────────────────────────────────

    private fun overlayInput(satisfied: Boolean = false) = ChecklistInput(
        state = StepState(overlayKey, applies = true, satisfied = satisfied, offered = false),
        name = "Relaunch itself after updates",
        why = "why",
        hint = "hint",
    )

    @Test
    fun `the offer is one step, armed, with a way out and a countdown`() {
        val model = SetupCeremonyMath.buildModel(
            listOf(overlayInput()),
            headingOverride = SetupCeremonyMath.HEADING_AFTER_UPDATE,
            footnoteOverride = SetupCeremonyMath.FOOTNOTE_AFTER_UPDATE,
            countdown = SetupCeremonyMath.countdownLine(30),
        )
        assertEquals(ChecklistMode.GRANTING, model.mode)
        assertEquals(SetupCeremonyMath.HEADING_AFTER_UPDATE, model.heading)
        assertEquals(1, model.rows.size)
        assertEquals(RowStatus.CURRENT, model.rows.first().status)
        assertEquals(overlayKey, model.primaryKey)
        // ⚠️ REMOTE-OPERABLE: a wall-mounted panel's only input is a D-pad,
        // so the card MUST offer a real armed control AND a real escape.
        // "Not now" is that escape; a card with only one button traps the
        // installer exactly the way the connecting screen did.
        assertEquals("Not now", model.secondaryLabel)
        assertTrue(model.primaryLabel!!.contains("Relaunch itself after updates"))
        assertTrue(model.countdown!!.contains("30s"))
    }

    @Test
    fun `the countdown copy claims nothing about the glass`() {
        val line = SetupCeremonyMath.countdownLine(12)
        assertTrue("says it closes itself", line.contains("Closing in 12s"))
        assertTrue(
            "the checklist is a scrim over a LIVE WebView and always has been — never imply " +
                "content is paused or waiting on this card",
            line.contains("keeps playing"),
        )
    }

    @Test
    fun `the offer card names the way back before it disappears`() {
        // It auto-continues, so this line is the only thing that tells the
        // operator how to return — the same lesson as the completion card.
        assertTrue(SetupCeremonyMath.FOOTNOTE_AFTER_UPDATE.contains("Screens"))
        assertTrue(SetupCeremonyMath.FOOTNOTE_AFTER_UPDATE.contains("TOP-LEFT"))
        assertTrue(
            "and is honest that skipping costs a walk to the panel, not a broken screen",
            SetupCeremonyMath.FOOTNOTE_AFTER_UPDATE.contains("keeps playing"),
        )
    }

    @Test
    fun `an interrupted card leaves the row armed, an expired one does not`() {
        // THE CONSEQUENCE of moving the marker off paint (v1.1.12), in pure
        // model terms. Both halves matter and they pull opposite ways:
        //
        //  * INTERRUPTED — the card was destroyed before anybody could
        //    answer (a relaunch actor recreating the Activity, an emergency
        //    hold, a process death). Nothing was written, so the ordinary
        //    checklist arms the row on a later boot and the operator finally
        //    gets asked. This is the panel that most needs the grant.
        //  * EXPIRED — the card stood its full 30 seconds and nobody was
        //    there. The marker IS written, so nothing re-arms: one ask per
        //    upgrade, which is the anti-nag invariant the whole file rests
        //    on (see SetupCeremonyMath.nextKey).
        val interrupted = listOf(
            StepState(overlayKey, applies = true, satisfied = false, offered = false),
        )
        assertEquals(
            "a card nobody met must not count as an offer",
            overlayKey,
            SetupCeremonyMath.nextKey(interrupted),
        )

        val expired = listOf(
            StepState(overlayKey, applies = true, satisfied = false, offered = true),
        )
        assertNull(
            "a fuse that burned out in front of an empty room IS the one ask",
            SetupCeremonyMath.nextKey(expired),
        )
    }

    @Test
    fun `every other card is byte-for-byte what it was`() {
        // The overrides default to null, so no existing caller can drift.
        val plain = SetupCeremonyMath.buildModel(listOf(overlayInput()))
        assertEquals(SetupCeremonyMath.HEADING_GRANTING, plain.heading)
        assertEquals(SetupCeremonyMath.FOOTNOTE_GRANTING, plain.footnote)
        assertNull("only the self-closing offer carries a countdown", plain.countdown)

        val complete = SetupCeremonyMath.buildModel(listOf(overlayInput(satisfied = true)))
        assertEquals(ChecklistMode.COMPLETE, complete.mode)
        assertEquals(SetupCeremonyMath.HEADING_COMPLETE, complete.heading)
        assertNull(complete.countdown)
    }

    // ─── 3. the step itself, in the real ceremony ───────────────────

    private fun ceremonySource(): String? {
        var dir: File? = File("").absoluteFile
        while (dir != null) {
            val direct = File(dir, "src/main/java/com/educms/player/setup/SetupCeremony.kt")
            if (direct.isFile) return direct.readText()
            val nested = File(dir, "app/src/main/java/com/educms/player/setup/SetupCeremony.kt")
            if (nested.isFile) return nested.readText()
            dir = dir.parentFile
        }
        return null
    }

    @Test
    fun `the relaunch grant is a CORE step, ordered before HOME`() {
        val src = ceremonySource()
        Assume.assumeTrue("SetupCeremony.kt not on disk", src != null)
        val body = src!!

        val overlayAt = body.indexOf("prefKey = \"$overlayKey\"")
        val homeAt = body.indexOf("prefKey = \"homeSetupPromptShown\"")
        assertTrue("the relaunch-grant step must exist", overlayAt > 0)
        assertTrue("the HOME step must exist", homeAt > 0)
        assertTrue(
            "HOME is LAST by product decision — it registers us as a launcher candidate on a " +
                "box where the vendor's CMS is the host, and everything cheaper runs first. " +
                "The relaunch grant goes BEFORE it, never after.",
            overlayAt < homeAt,
        )

        val block = body.substring(overlayAt, homeAt)
        assertFalse(
            "this grant is what makes a hands-free OTA come back on screen without HOME — " +
                "demoting it to ADVANCED would hide the fix from every install",
            block.contains("optional = true"),
        )
        assertTrue(
            "auto-skip when the grant is already held",
            block.contains("canDrawOverlays"),
        )
        assertTrue(
            "auto-skip on a ROM that ships no overlay page — the step would otherwise " +
                "dead-end at its final tap, on every panel of a wide rollout",
            block.contains("overlayPageResolves"),
        )
        assertTrue(
            "the row has to say WHY in operator language, not name an Android appop",
            block.contains("bring itself back on screen after updates"),
        )
    }

    @Test
    fun `the offer is driven from resume only, and stands down like every other card`() {
        val src = ceremonySource()
        Assume.assumeTrue("SetupCeremony.kt not on disk", src != null)
        val body = src!!
        assertTrue(
            "resume() is the only driver — the explicit re-open must always show the full list",
            body.contains("if (maybeOfferRelaunchGrant(activity, decorate)) return"),
        )
        assertTrue(
            "the emergency / lock-task refusals are shared, so an alert never has to be " +
                "defended twice in two places",
            body.contains("if (mustStandDown(activity)) return false"),
        )
        // ── v1.1.12 — PAINTING THE CARD IS NOT OFFERING THE STEP ─────────
        //
        // The marker used to be written in renderRelaunchOffer, before the
        // card was on screen. This card is painted into the loudest 60
        // seconds a panel ever has — five relaunch actors fire in that
        // window (TC22) — so a card destroyed in under a second still
        // counted as asked, and the panel that most needed the grant was the
        // one that never got to answer. The marker moved to where a decision
        // happens; the fuse expiry is the unattended one.
        val renderAt = body.indexOf("private fun renderRelaunchOffer(")
        val tickAt = body.indexOf("private val offerTick")
        val endOfferAt = body.indexOf("private fun endOfferMode")
        assertTrue("renderRelaunchOffer must exist", renderAt > 0)
        assertTrue("offerTick must exist, and after it", tickAt > renderAt)
        assertTrue("endOfferMode must exist, after offerTick", endOfferAt > tickAt)
        assertFalse(
            "painting the card must NOT spend the step — an offer is what an operator " +
                "MEETS, and a card torn down by a relaunch storm was never met",
            body.substring(renderAt, tickAt).contains("markOffered("),
        )
        assertTrue(
            "the 30-second fuse burning out IS the offer being spent — without this the " +
                "next boot opens the full checklist over live signage with this row armed, " +
                "turning a one-time offer into a nag",
            body.substring(tickAt, endOfferAt).contains("markOffered(activity, KEY_OVERLAY_STEP)"),
        )
        assertTrue(
            "the offer must yield to OTHER armed work but not to itself — otherwise the " +
                "only screens it exists for get a full checklist on a 10-minute fuse instead",
            body.contains("armed != null && armed != KEY_OVERLAY_STEP"),
        )
        assertTrue(
            "\"previously provisioned\" must be read off the ceremony's own offered markers, " +
                "never off a grant an adb script could have satisfied on a virgin screen",
            body.contains("it.key != KEY_OVERLAY_STEP && it.offered"),
        )
    }
}
