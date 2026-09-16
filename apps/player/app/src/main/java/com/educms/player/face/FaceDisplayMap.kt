package com.educms.player.face

/**
 * WHICH PANEL IS FACE N — the whole of §1 of the double-sided contract
 * (`docs/research/2026-09-16-double-sided-build/01-NATIVE-PRESENTATION-CONTRACT.md`).
 *
 * THE HARDWARE. The first double-sided unit (Goodview DH43) is ONE rk3288
 * board running Android 7.1.2 with TWO real Android displays:
 *
 *   display 0 — "Built-in Screen", 1080×1920, isPresentation FALSE
 *   display 1 — "HDMI Screen",     1920×1080, isPresentation TRUE, isPrivate FALSE
 *
 * Face 0 is ALWAYS the Activity's own display and is therefore never looked
 * up here — that is why display 0 not being "eligible" is correct rather
 * than a bug. Face N ≥ 1 maps to the (N-1)th ELIGIBLE display, ordered by
 * `Display.getDisplayId()` ASCENDING.
 *
 * ELIGIBLE = `FLAG_PRESENTATION` set AND `FLAG_PRIVATE` clear. That is
 * byte-for-byte the predicate `DisplayCapabilityProbe.displaySurface`
 * already derives (see its `isPresentation` / `isPrivate` keys) and the one
 * the server's `reportsSecondDisplay()` reads out of the stored inventory.
 * The two MUST agree: the contract's §1 requirement is that the dashboard
 * and the device never disagree about whether a second panel exists, and a
 * second copy of the rule is how they would drift. FLAG_PRIVATE is what
 * tells a real second output from a screen recorder, a vendor mirror or any
 * other virtual/overlay surface.
 *
 * WHY ORDERING, NOT IDENTITY. Display ids are not stable across reboots on
 * every OEM, but their RELATIVE ORDER is. An operator who assigned "Back =
 * the street-facing menu" must not have that swap after a power cut, so the
 * mapping is positional and deterministic.
 *
 * NEVER SILENTLY REASSIGN. If there are fewer eligible panels than
 * requested faces, the faces we cannot host are reported as a SHORTFALL
 * ([shortfall] / [shortfallReason]) and left unhosted. Sliding face 2 onto
 * the panel face 1 is already using would put the wrong content on a piece
 * of glass and tell nobody.
 *
 * PURE — no `android.*` import, so it unit-tests on a plain JVM in
 * microseconds. Same discipline as `TokenResolution.kt`,
 * `ContentWatchdogPolicy.kt` and `DisplayEmergency.refusalReasonFor`: the
 * rules that decide what appears on a piece of glass must have tests that
 * cannot be skipped for want of an emulator. The `android.view.Display`
 * reading lives at the one call site that owns it, [FaceHostController].
 */
object FaceDisplayMap {

    /**
     * `android.view.Display.FLAG_PRESENTATION` (1 shl 3).
     *
     * Declared here as a plain Int ONLY so this file can stay free of
     * `android.*` and remain JVM-testable. `FaceDisplayMapTest` asserts it
     * equals the platform constant, so a future platform change cannot let
     * these drift quietly — that assertion is the whole reason the literal
     * is allowed to exist.
     */
    const val FLAG_PRESENTATION: Int = 1 shl 3

    /** `android.view.Display.FLAG_PRIVATE` (1 shl 2). Same contract as above. */
    const val FLAG_PRIVATE: Int = 1 shl 2

    /**
     * Ceiling on faces per physical unit, primary included — mirrors the
     * server's `MAX_FACES_PER_UNIT`. A bound, not an expectation: today's
     * hardware has two.
     */
    const val MAX_FACES: Int = 4

    /** No eligible panel at all — the single-sided case, and the default. */
    const val REASON_NO_SECOND_DISPLAY = "no-eligible-second-display"

    /** At least one eligible panel, but fewer than the faces asked for. */
    const val REASON_FEWER_PANELS = "fewer-panels-than-faces"

    /**
     * A real second output, or a mirror/virtual surface?
     *
     * @param isPresentation `FLAG_PRESENTATION` — "an app may present here".
     * @param isPrivate `FLAG_PRIVATE` — a virtual / overlay display. A
     *   software mirror looks exactly like this, which is the distinction
     *   the 2026-09-02 probe was added to make.
     */
    fun isEligible(d: FaceDisplay): Boolean = d.isPresentation && !d.isPrivate

    /**
     * Derive the two booleans from a raw `Display.getFlags()` bitmask.
     *
     * The ONLY place the masks are applied, so the native predicate cannot
     * drift from the probe's.
     */
    fun eligibleFromFlags(flags: Int): Boolean =
        (flags and FLAG_PRESENTATION) != 0 && (flags and FLAG_PRIVATE) == 0

    /**
     * Every eligible panel, in the deterministic order faces are assigned
     * from. Ascending `displayId`, always — a `DisplayManager` that hands
     * them back in some other order must not change which face lands where.
     */
    fun eligibleInOrder(all: List<FaceDisplay>): List<FaceDisplay> =
        all.filter { isEligible(it) }.sortedBy { it.displayId }

    /**
     * The panel that should host [faceIndex], or null when there is none.
     *
     * Face 0 answers null BY DESIGN: it is the Activity's own display, it is
     * not hosted in a `Presentation`, and it is never looked up in the
     * eligible list. A caller that asks for face 0 here has a bug, and
     * answering "the first eligible panel" would hide it by putting the
     * front's content on the back.
     */
    fun displayForFace(all: List<FaceDisplay>, faceIndex: Int): FaceDisplay? {
        if (faceIndex < 1 || faceIndex >= MAX_FACES) return null
        return eligibleInOrder(all).getOrNull(faceIndex - 1)
    }

    /**
     * Faces that were asked for and have no panel to live on.
     *
     * Returned sorted and de-duplicated so the reported state is stable
     * across ticks — a shortfall that reorders itself every hot-plug would
     * look like a changing fault to whoever reads it.
     */
    fun shortfall(all: List<FaceDisplay>, requestedFaces: List<Int>): List<Int> =
        requestedFaces
            .filter { it >= 1 && it < MAX_FACES }
            .distinct()
            .sorted()
            .filter { displayForFace(all, it) == null }

    /**
     * Why a face could not be hosted, in words an operator surface can show.
     *
     * Per the contract's §6 a shortfall must surface as a NAMED, honest
     * state — never as an offline screen and never as silence.
     */
    fun shortfallReason(all: List<FaceDisplay>): String =
        if (eligibleInOrder(all).isEmpty()) REASON_NO_SECOND_DISPLAY else REASON_FEWER_PANELS
}

/**
 * One `android.view.Display`, reduced to the facts the mapping needs.
 *
 * Deliberately a plain data class rather than the platform type: the
 * decision is pure, and a `Display` cannot be constructed in a JVM test.
 * [FaceHostController] builds these from the real `DisplayManager`.
 */
data class FaceDisplay(
    val displayId: Int,
    val name: String = "",
    val widthPx: Int = 0,
    val heightPx: Int = 0,
    val isPresentation: Boolean = false,
    val isPrivate: Boolean = false,
    /**
     * `Display.getState() == STATE_ON`. Reported, never used as an
     * eligibility input: a panel that is asleep is still the panel this
     * face belongs to, and the emergency interlock's whole job is to wake
     * it. Treating "off" as "not there" would hand face 1's content to
     * face 2 the moment someone blanked a screen — exactly the silent
     * reassignment §1 forbids.
     */
    val stateOn: Boolean = true,
)
