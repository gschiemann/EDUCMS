package com.educms.player.display

import android.content.Context
import android.os.PowerManager
import com.educms.player.logging.PlayerLogger

/**
 * ═════════════════════════════════════════════════════════════════════
 * ⚠️  THE EMERGENCY INTERLOCK — THE MOST IMPORTANT FILE IN THIS PACKAGE
 * ═════════════════════════════════════════════════════════════════════
 *
 * VenueOS screens show LOCKDOWN, EVACUATION and severe-weather alerts.
 * Everything else in `com.educms.player.display` exists to make a screen
 * darker; this file exists to guarantee that none of it can hide an
 * active alert.
 *
 * THE BUG THIS PREVENTS (found in adversarial review, 2026-08-13):
 * the software floor's blackout View is added to the root FrameLayout
 * ABOVE the WebView, so the React emergency overlay renders BEHIND an
 * opaque black rectangle. A hallway screen blanked by its 22:00 schedule
 * stayed black through a 02:14 lockdown. Nothing in this package
 * consulted emergency state at all.
 *
 * ─────────────────────────────────────────────────────────────────────
 * THE CONTRACT
 * ─────────────────────────────────────────────────────────────────────
 *  a) The web player calls `displayEmergencyHold(active)` whenever
 *     emergency state changes — on the WS OVERRIDE / ALL_CLEAR handlers
 *     AND on every manifest poll that carries an `emergency` field, so a
 *     WS-less screen riding the HTTP polling backstop is covered too.
 *  b) While the hold is ACTIVE we synchronously remove the blackout,
 *     restore window brightness to full, re-assert KEEP_SCREEN_ON and
 *     issue a Wake ([enforceNow]).
 *  c) While the hold is ACTIVE every BLANK, every brightness-LOWERING
 *     action and every REBOOT is REFUSED and LOGGED — from the bridge,
 *     from the scheduler and from the dead-man revert alike, because
 *     the check lives at [DisplayControlRegistry.apply], the single
 *     entry point all three go through.
 *  d) The hold is PERSISTED with `commit()`, so a process restart
 *     mid-emergency does not come back blanked ([DisplayControlApi
 *     .onWindowAttached] re-asserts it before it would re-apply a
 *     blank).
 *  e) Releasing the hold RE-EVALUATES the schedule, so a blank window
 *     that was suppressed during the alert takes effect immediately
 *     rather than being silently skipped until the next day.
 *
 * ─────────────────────────────────────────────────────────────────────
 * FAIL-OPEN FOR RECOVERY, FAIL-CLOSED FOR RISK
 * ─────────────────────────────────────────────────────────────────────
 * Every ambiguity here resolves toward "the screen is visible, and the
 * operator can always get it back". A hold that is set when there is no
 * real emergency costs electricity. A hold that is missed costs someone
 * their safety. A hold that can never be LIFTED costs the operator the
 * whole feature, permanently, on a screen they cannot reach. So:
 *
 *   * `setHold(true)` is accepted from ANY transport, including the
 *     legacy every-frame bridge — it can only ever make a dark screen
 *     visible.
 *   * `setHold(false)` is ALSO accepted from any transport, and that is
 *     a deliberate 2026-08-14 reversal — see [DisplayControlApi
 *     .emergencyHoldJson] for the full argument. Short version: RELEASE
 *     is recovery-direction. It cannot darken anything by itself; it
 *     only returns the layer to normal operation, where every darkening
 *     action is STILL trusted-only on that transport. Refusing it meant
 *     that on a Chromium-83/87 NovaStar Taurus — where the origin-scoped
 *     channel cannot attach at all, and which is in the pilot fleet —
 *     the FIRST alert engaged a hold nothing could ever lift: screen
 *     pinned at 100% forever, all display control dead, no operator
 *     recovery.
 *   * A hold NEVER auto-expires. A screen that stays lit because the
 *     page died mid-alert is a power bill; one that blanks because a
 *     timer decided the emergency was over is not recoverable.
 *
 * ─────────────────────────────────────────────────────────────────────
 * ⚠️ THE GATE IS CHECK-THEN-ACT ACROSS THREADS — READ BEFORE EDITING
 * ─────────────────────────────────────────────────────────────────────
 * [refusalReason] is read on one thread and the panel is driven on
 * another, so a blank can pass the gate and land AFTER the hold engages.
 * Three independent mechanisms close that window; all three must stay:
 *
 *   1. **UI-thread re-check.** Every window mutation marshals through
 *      `runOnUiThread`, so the main looper serialises them. MainActivity's
 *      `setBlackout`/`setWindowBrightness` hooks re-read the hold ON that
 *      looper ([blocksBlackout] / [blocksWindowDim]) and no-op while it is
 *      held. The hold is `commit()`ed BEFORE [enforceNow] posts anything,
 *      so any darkening post enqueued after the commit sees held=true, and
 *      any enqueued before it is followed by the enforce posts.
 *   2. **Post-apply re-assert.** [DisplayControlRegistry.apply] re-checks
 *      the hold AFTER the provider returns and calls [enforceNow] when a
 *      darkening action raced it. That covers the mechanisms the looper
 *      cannot gate — a device-admin `lockNow()`, a shortened screen-off
 *      timeout, a vendor power broadcast.
 *   3. **Re-raise re-enforces.** A forced re-raise of an already-held
 *      hold no longer short-circuits; it re-runs [enforceNow]. That is
 *      what makes the web player's per-poll re-report an actual recovery
 *      instead of a no-op, so the worst case self-heals within one poll.
 */
object DisplayEmergency {

    private const val TAG = "DisplayEmergency"

    /** Brightness we drive to while an alert is up. */
    private const val EMERGENCY_BRIGHTNESS = 100

    /** The Activity's own pane. A single-sided screen is always this. */
    const val PRIMARY_FACE = 0

    /**
     * Sanity bound when PARSING a persisted face set. Deliberately larger
     * than `FaceDisplayMap.MAX_FACES` and deliberately not a reference to
     * it: this package must not depend on `face`, and the bound's only job
     * is to refuse a corrupt value, not to define how many faces exist.
     */
    private const val MAX_FACE_INDEX = 8

    /**
     * ⚠️ HELD WHILE **ANY** FACE HOLDS (2026-09-16, double-sided displays).
     *
     * THE BUG THIS CLOSES. The hold used to be one process-wide persisted
     * boolean, while the web side's dedup latch (`emergencyHold.ts`
     * `lastSent`) is per-JS-context. A second face is a second JS realm, so
     * two latches wrote one boolean — and FACE B'S ROUTINE ALL-CLEAR
     * RELEASED FACE A'S LIVE LOCKDOWN. Side B polls its own manifest, sees
     * no emergency, and sends `displayEmergencyHold(false)` on every poll;
     * the front could be in a real lockdown and the interlock would drop
     * within seconds.
     *
     * Two prefs reads, both from SharedPreferences' in-memory map, so this
     * stays cheap enough for `DisplayControlRegistry.apply` to call on
     * every action. The legacy boolean is consulted as well as the set
     * because either write can fail independently and HELD is the
     * fail-safe answer.
     */
    fun isHeld(ctx: Context): Boolean {
        val app = ctx.applicationContext
        return heldFrom(
            parseHoldFaces(DisplayPrefs.emergencyHoldFacesRaw(app)),
            DisplayPrefs.emergencyHold(app),
        )
    }

    fun heldSinceMs(ctx: Context): Long = DisplayPrefs.emergencyHoldSince(ctx.applicationContext)

    /** Which faces are holding right now. Empty when nothing is. */
    fun holdingFaces(ctx: Context): Set<Int> {
        val app = ctx.applicationContext
        return currentHoldFaces(
            parseHoldFaces(DisplayPrefs.emergencyHoldFacesRaw(app)),
            DisplayPrefs.emergencyHold(app),
        )
    }

    // ─── the refcount, as pure math ──────────────────────────────────
    //
    // Same discipline as [refusalReasonFor]: a life-safety rule must have
    // a test that cannot be skipped for want of an emulator. See
    // FaceEmergencyHoldTest.

    /**
     * Is the hold engaged?
     *
     * `legacyHold` alone is enough, and that is the FAIL-SAFE direction:
     * an APK that upgraded mid-alert has the boolean set and no face set
     * at all, and it must come back HELD.
     */
    internal fun heldFrom(faces: Set<Int>?, legacyHold: Boolean): Boolean =
        legacyHold || (faces != null && faces.isNotEmpty())

    /**
     * Decode the persisted membership.
     *
     * @return the set, or NULL when the value is absent or unreadable —
     *   which are both "we do not know", and the caller then falls back to
     *   the legacy boolean. Any malformed token invalidates the whole
     *   value rather than being skipped: silently dropping a face index we
     *   could not parse would silently drop a holder.
     */
    internal fun parseHoldFaces(raw: String?): Set<Int>? {
        if (raw == null) return null
        val trimmed = raw.trim()
        if (trimmed.isEmpty()) return emptySet()
        val out = sortedSetOf<Int>()
        for (part in trimmed.split(',')) {
            val n = part.trim().toIntOrNull() ?: return null
            if (n < 0 || n > MAX_FACE_INDEX) return null
            out.add(n)
        }
        return out
    }

    /** Stable, sorted encoding so the persisted value never churns. */
    internal fun encodeHoldFaces(faces: Set<Int>): String = faces.sorted().joinToString(",")

    /**
     * Who is holding, reconciling the set with the legacy boolean.
     *
     * ⚠️ THE UPGRADE CASE IS THE POINT. A device that upgrades mid-alert
     * has `display_emergency_hold = true` and NO face set. Reading that as
     * "nobody is holding" would let face 1's very first routine all-clear
     * clear a live lockdown the primary raised. The pre-face world had
     * exactly one holder, so an unattributable hold is attributed to the
     * primary — and a face's release then correctly leaves it standing.
     */
    internal fun currentHoldFaces(parsed: Set<Int>?, legacyHold: Boolean): Set<Int> = when {
        parsed != null && parsed.isNotEmpty() -> parsed
        legacyHold -> setOf(PRIMARY_FACE)
        else -> emptySet()
    }

    /** Membership after this face reports [active]. */
    internal fun nextHoldFaces(current: Set<Int>, faceIndex: Int, active: Boolean): Set<Int> =
        if (active) (current + faceIndex).toSortedSet() else (current - faceIndex).toSortedSet()

    // ─── who may hold: only a face this process is HOSTING ───────────
    //
    // ⚠️ THE FIX FOR "ANY FRAME CAN PIN THE HOLD FOREVER" (2026-09-19; the
    // 1.1.18 verifier's finding 1, severity high).
    //
    // The first cut CLAMPED an out-of-range index into 0..8 and recorded it.
    // Nothing bound a member to a face that exists, so a hold credited to
    // "face 1" on a single-sided box had no face 1 to release it: the
    // primary's all-clear narrowed {0,1} to {1}, the hold stayed engaged —
    // brightness pinned, blank/dim/reboot refused — and only wiping app data
    // lifted it. Exactly the failure this file's header warns about.
    //
    // Two rules close it, and a third makes it unreachable to begin with:
    //   1. A member must be a face native is HOSTING ([liveFaces]). An index
    //      that is not live is credited to the PRIMARY — never dropped,
    //      because a bad number must not be able to make a RAISE disappear,
    //      and never recorded as itself, because nothing could ever lift it.
    //      Credited to the primary it round-trips with the primary's own
    //      release, which is exactly how the pre-face hold behaved.
    //   2. When a hosted face goes away, its membership is TRANSFERRED to the
    //      primary rather than deleted. Fail-safe direction (the box stays
    //      held), and liftable: the primary's page sends its state on every
    //      load and every alert transition, and REFRESH_WEB forces one.
    //   3. The face index NEVER CROSSES THE JS BOUNDARY. Each bridge instance
    //      is built by the host that owns it and supplies its own index; the
    //      page cannot name a face at all (WebAppBridge / NativeBridgeChannel
    //      carry no face argument). So rule 1's "not live" case is reachable
    //      only by a race with a detach — not by a hostile frame.

    /** Faces this process is hosting right now. The primary is ALWAYS one. */
    @Volatile
    private var liveFaces: Set<Int> = setOf(PRIMARY_FACE)

    /** The face a report is credited to: itself when hosted, else the primary. */
    internal fun creditedFace(faceIndex: Int, live: Set<Int>): Int =
        if (faceIndex in live) faceIndex else PRIMARY_FACE

    /** Members that are no longer hosted collapse onto the primary. */
    internal fun reconcileHoldFaces(current: Set<Int>, live: Set<Int>): Set<Int> =
        current.map { creditedFace(it, live) }.toSortedSet()

    /**
     * One lock for the hold's whole read → decide → commit.
     *
     * Finding 3: the membership is a read-modify-write over two prefs, and on
     * the legacy `addJavascriptInterface` transport each WebView calls in on
     * its OWN JS thread. Unlocked, face A's raise (reads {}, computes {0})
     * and face B's release (reads {}, computes {}) interleave, B commits
     * last, and A's LIVE RAISE is erased. The panel drive in `engage` /
     * `release` runs under it too, deliberately: two holds must not reorder.
     */
    private val holdLock = Any()

    /**
     * The face host reports which faces it is hosting. Called on every attach
     * and detach; idempotent. A face that vanished keeps the box HELD if it was
     * holding — see rule 2 above — so this never releases anything.
     */
    fun setLiveFaces(ctx: Context, hosted: Set<Int>) {
        val app = ctx.applicationContext
        synchronized(holdLock) {
            val next = (hosted.filter { it in 0..MAX_FACE_INDEX } + PRIMARY_FACE).toSortedSet()
            if (next == liveFaces) return
            liveFaces = next
            val current = currentHoldFaces(
                parseHoldFaces(DisplayPrefs.emergencyHoldFacesRaw(app)),
                DisplayPrefs.emergencyHold(app),
            )
            val reconciled = reconcileHoldFaces(current, next)
            if (reconciled != current) {
                PlayerLogger.w(
                    TAG,
                    "hosted faces are now ${encodeHoldFaces(next)} — hold membership " +
                        "${encodeHoldFaces(current)} → ${encodeHoldFaces(reconciled)} (a face that " +
                        "went away while holding is credited to the primary; the hold STAYS engaged)",
                )
                DisplayPrefs.commitEmergencyHoldFaces(app, encodeHoldFaces(reconciled))
            }
        }
    }

    /**
     * Why this action is refused right now, or null when it may proceed.
     *
     * Called from [DisplayControlRegistry.apply] BEFORE the provider is
     * resolved and BEFORE the dead-man guard is armed, so a refused
     * action leaves no pending record behind.
     *
     * The comparison for "lowering" is against the mirrored brightness
     * rather than a constant: [enforceNow] drives the panel to
     * [EMERGENCY_BRIGHTNESS] and mirrors it, so during a hold anything
     * below full is a lowering. Equal-or-higher is allowed, which is
     * what lets [enforceNow]'s own SetBrightness through.
     */
    fun refusalReason(ctx: Context, action: DisplayAction): String? {
        val app = ctx.applicationContext
        return refusalReasonFor(isHeld(app), DisplayPrefs.brightnessPercent(app), action)
    }

    /**
     * The refusal decision, as pure math.
     *
     * Deliberately free of any `android.*` reference so it is unit-
     * testable on a plain JVM — the same discipline [DisplayLimits] and
     * [DisplayScheduleMath] follow, and for the same reason: this is a
     * life-safety rule and it must have a test that cannot be skipped
     * for want of an emulator.
     *
     * @param currentPercent the mirrored brightness. [enforceNow] drives
     *        the panel to full and mirrors it, so during a hold anything
     *        below that is a lowering — and an equal-or-higher request
     *        (including [enforceNow]'s own) passes.
     */
    internal fun refusalReasonFor(
        held: Boolean,
        currentPercent: Int,
        action: DisplayAction,
    ): String? {
        if (!held) return null
        return when (action) {
            DisplayAction.Blank ->
                "emergency alert is active — BLANK refused (a blanked screen hides the alert)"
            DisplayAction.Reboot ->
                "emergency alert is active — REBOOT refused (the screen would be dark while it boots)"
            is DisplayAction.SetBrightness -> when {
                action.allowBlack ->
                    "emergency alert is active — allowBlack brightness refused"
                action.percent < currentPercent ->
                    "emergency alert is active — brightness may not be lowered " +
                        "(${action.percent}% < $currentPercent%)"
                else -> null
            }
            // Wake and SetVolume can only ever make the alert MORE
            // perceivable, so they are never refused.
            DisplayAction.Wake, is DisplayAction.SetVolume -> null
        }
    }

    /**
     * Would this action darken the screen, if a hold were active?
     *
     * The SAME predicate as [refusalReasonFor], asked in the other
     * direction, so the post-apply re-assert in
     * [DisplayControlRegistry.apply] can never drift from the gate that
     * is supposed to have refused it. Pure, for the same reason.
     *
     * @param currentPercent the mirrored brightness BEFORE the action was
     *        applied — after the apply the mirror already holds the new
     *        value and every request would compare equal.
     */
    internal fun isDarkeningAction(currentPercent: Int, action: DisplayAction): Boolean =
        refusalReasonFor(held = true, currentPercent = currentPercent, action = action) != null

    /**
     * ⚠️ UI-THREAD GUARD (pure half). True when the blackout overlay must
     * NOT be raised right now.
     *
     * MainActivity's `setBlackout` hook calls this from inside its
     * `runOnUiThread` body, which is what makes it a real fix rather than
     * a second copy of the same race: the main looper serialises every
     * window mutation, and the hold is persisted before the enforce path
     * posts anything, so a blank that passed the registry gate and lands
     * here after the hold engaged is stopped at the last possible moment.
     */
    internal fun blocksBlackout(held: Boolean, visible: Boolean): Boolean = held && visible

    /**
     * ⚠️ UI-THREAD GUARD (pure half). True when a window-brightness write
     * must NOT be honoured right now.
     *
     * Anything below full is a dim while an alert is up. Negative values
     * (BRIGHTNESS_OVERRIDE_NONE — "hand brightness back to the system")
     * count as a dim too: the system level is whatever the ROM last set,
     * which on a signage box can be very low.
     */
    internal fun blocksWindowDim(held: Boolean, fraction: Float): Boolean = held && fraction < 1f

    /**
     * ⚠️ UI-THREAD GUARD (pure half). True when FLAG_KEEP_SCREEN_ON must
     * NOT be dropped right now.
     *
     * Every blank mechanism clears KEEP_SCREEN_ON as its FIRST step —
     * a window holding it pins the panel lit no matter what the vendor
     * broadcast or the screen-off timeout says. So a blank that lost the
     * race still got THIS far even when its blackout and its dim were
     * refused, and the panel was then free to sleep on the OS timeout
     * with a lockdown alert on it. Nothing legitimately drops the flag
     * during a hold: every caller that would is refused at the registry.
     */
    internal fun blocksKeepScreenOff(held: Boolean, on: Boolean): Boolean = held && !on

    /**
     * Engage or release the hold.
     *
     * The persisted flag is written BEFORE the screen is driven, so a
     * kill in between comes back HELD (visible) rather than blanked.
     *
     * @return true when the state was persisted.
     */
    fun setHold(ctx: Context, active: Boolean): Boolean = setHold(ctx, PRIMARY_FACE, active)

    /**
     * Engage or release the hold ON BEHALF OF ONE FACE.
     *
     * ⚠️ A RELEASE FROM ONE FACE NEVER RELEASES ANOTHER'S. The hold stands
     * while any face holds; only the last one out turns it off. Everything
     * else about the posture is unchanged — `active = true` and
     * `active = false` are BOTH still accepted from any transport, because
     * refusing a release on a Chromium-83 panel is what once pinned a
     * Taurus lit forever (see [DisplayControlApi.emergencyHoldJson]).
     *
     * An index that is not a HOSTED face is credited to the primary rather
     * than refused or recorded as itself — see [creditedFace]: a bad number
     * must not make a RAISE disappear, and must not create a member nothing
     * can ever release.
     */
    fun setHold(ctx: Context, faceIndex: Int, active: Boolean): Boolean {
        val app = ctx.applicationContext
        synchronized(holdLock) {
            val live = liveFaces
            val face = creditedFace(faceIndex, live)
            if (face != faceIndex) {
                PlayerLogger.w(
                    TAG,
                    "hold(${if (active) "raise" else "release"}) named face $faceIndex, which is not hosted " +
                        "(hosted: ${encodeHoldFaces(live)}) — credited to the primary",
                )
            }
            val legacy = DisplayPrefs.emergencyHold(app)
            val current = reconcileHoldFaces(
                currentHoldFaces(parseHoldFaces(DisplayPrefs.emergencyHoldFacesRaw(app)), legacy),
                live,
            )
            val next = nextHoldFaces(current, face, active)
            val wasHeld = current.isNotEmpty()

            if (active) return engage(app, wasHeld, next, face)
            // Somebody else is still in an alert. Narrow the membership and
            // leave the screen exactly as it is.
            if (next.isNotEmpty()) return narrowHold(app, next, face)
            return release(app, wasHeld, face)
        }
    }

    /**
     * One face stood down; at least one other has not.
     *
     * THIS IS THE WHOLE POINT OF THE REFCOUNT. Before it, this path called
     * `release()` and took the other face's live lockdown down with it.
     * Nothing about the screen changes here — the panel is already being
     * held visible — so there is no enforce and no restore; only the
     * membership moves.
     */
    private fun narrowHold(app: Context, remaining: Set<Int>, face: Int): Boolean {
        PlayerLogger.i(
            TAG,
            "face $face reports all-clear, but face(s) ${encodeHoldFaces(remaining)} are still in an " +
                "alert — the emergency hold STAYS engaged",
        )
        return DisplayPrefs.commitEmergencyHoldFaces(app, encodeHoldFaces(remaining))
    }

    private fun engage(app: Context, alreadyHeld: Boolean, faces: Set<Int>, face: Int): Boolean {
        // ⚠️ A RE-RAISE RE-ENFORCES. It used to `return true` here, and
        // that was the hole in the interlock: the ONLY thing that could
        // recover a blank which won the check-then-act race was a re-raise,
        // and a re-raise did nothing. The web player re-reports the hold on
        // every emergency poll precisely so a native process that missed
        // the transition re-arms — a promise the short-circuit quietly
        // broke, leaving the panel black for the whole alert.
        //
        // What is still skipped on a re-raise, and why:
        //   * the pre-hold brightness snapshot — re-taking it after we
        //     drove the panel to 100% would record 100% as "what the
        //     operator configured", so the all-clear would never restore
        //     their real level;
        //   * the `heldSince` stamp — re-stamping destroys the one signal
        //     ops has for "this screen has been held for six hours because
        //     the page died mid-alert";
        //   * the loud ENGAGED log — [enforceNow] logs loudly by itself
        //     whenever it actually had to correct something, so a healthy
        //     per-poll re-raise stays quiet and a raced one is shouted.
        if (alreadyHeld) {
            // The MEMBERSHIP still has to be recorded, even though nothing
            // else about the hold moves: a face that joined an existing
            // alert without being written down would, on its own later
            // all-clear, be computed out of a set it was never in — and
            // the set would empty while the other face was still holding.
            val persisted = DisplayPrefs.commitEmergencyHoldFaces(app, encodeHoldFaces(faces))
            enforceNow(app, quiet = true)
            return persisted
        }

        // Capture what the operator had configured BEFORE we drive to
        // full, so the release path can put it back.
        DisplayPrefs.setPreHoldBrightnessPercent(app, DisplayPrefs.brightnessPercent(app))
        PlayerLogger.e(
            TAG,
            "EMERGENCY HOLD ENGAGED by face $face — blank/dim/reboot are refused until all-clear",
        )
        val persisted = DisplayPrefs.commitEmergencyHold(
            app,
            active = true,
            sinceMs = System.currentTimeMillis(),
            facesRaw = encodeHoldFaces(faces),
        )
        if (!persisted) {
            // Do NOT bail: an un-persisted hold still has to un-blank the
            // screen right now. Losing it to a later process death is bad;
            // leaving the screen black during a lockdown is worse. The
            // next poll retries, because isHeld() is still false.
            PlayerLogger.e(TAG, "emergency hold could not be persisted — enforcing anyway")
        }
        enforceNow(app)
        return persisted
    }

    private fun release(app: Context, wasHeld: Boolean, face: Int): Boolean {
        if (!wasHeld) return true
        val persisted = DisplayPrefs.commitEmergencyHold(
            app,
            active = false,
            sinceMs = 0L,
            facesRaw = null,
        )
        PlayerLogger.i(
            TAG,
            "emergency hold RELEASED by face $face (no face is holding any more) — " +
                "restoring configured brightness + schedule",
        )

        val pre = DisplayPrefs.preHoldBrightnessPercent(app)
        DisplayPrefs.setPreHoldBrightnessPercent(app, null)
        if (pre != null && pre != DisplayPrefs.brightnessPercent(app)) {
            runCatching {
                DisplayControlRegistry.apply(app, DisplayAction.SetBrightness(pre), revertAfterMs = null)
            }.onFailure { PlayerLogger.w(TAG, "post-release brightness restore failed: ${it.message}") }
        }

        // Any dead-man revert that came due DURING the alert was deferred
        // rather than burned (see DisplayGuard.fireDue) — this is what
        // finally lets it restore the operator's pre-test state.
        runCatching { DisplayGuard.replayPending(app) }
            .onFailure { PlayerLogger.w(TAG, "post-release revert replay failed: ${it.message}") }

        // (e) — a blank window suppressed during the alert must take
        // effect NOW, not silently wait until tomorrow's boundary.
        runCatching { DisplayScheduler.armAndApply(app) }
            .onFailure { PlayerLogger.w(TAG, "post-release schedule re-evaluation failed: ${it.message}") }
        return persisted
    }

    /**
     * Make the alert visible, right now, by every mechanism we have.
     *
     * The window hooks are driven DIRECTLY first rather than only
     * through the registry: the blackout View is the thing covering the
     * alert, and lifting it must not depend on which provider happens to
     * have won the BLANK chain or on that provider succeeding.
     *
     * IDEMPOTENT AND CHEAP BY DESIGN, because it now runs on every
     * re-raise (see [engage]) and on every post-apply re-assert (see
     * [DisplayControlRegistry.apply]). Every step is a set-to-a-known-
     * value, never a toggle: hiding an already-hidden overlay, re-flagging
     * an already-flagged window, re-acquiring a non-ref-counted timed wake
     * lock (which just re-arms its timeout) and re-applying Wake +
     * SetBrightness(100) all no-op on a screen that is already correct.
     *
     * @param quiet suppress the routine "screen driven visible" line. A
     *        correction — i.e. the mirror said the screen was blanked or
     *        dimmed, which is exactly the raced-blank signature — is
     *        logged at ERROR either way, because that is the event ops
     *        needs to see.
     */
    fun enforceNow(ctx: Context, quiet: Boolean = false) {
        val app = ctx.applicationContext
        // Read the mirror BEFORE we correct it: this is the only place
        // that can tell "routine re-assert" from "a blank raced the hold
        // and won", and the two want very different log levels.
        val wasBlanked = DisplayPrefs.blanked(app)
        val wasDimmed = DisplayPrefs.brightnessPercent(app) < EMERGENCY_BRIGHTNESS
        val corrected = wasBlanked || wasDimmed

        val attached = DisplayWindowBridge.withHooks { h ->
            h.setBlackout(false)
            h.setWindowBrightness(1f)
            h.setKeepScreenOn(true)
            h.requestWake()
        }
        // A screen already asleep (screen-timeout blank, device-admin
        // lockNow) has no window to re-flag — this is what actually turns
        // the panel back on from a Context.
        ScreenWakeLock.pokeScreen(app)

        runCatching {
            DisplayControlRegistry.apply(app, DisplayAction.Wake, revertAfterMs = null)
            DisplayControlRegistry.apply(
                app,
                DisplayAction.SetBrightness(EMERGENCY_BRIGHTNESS),
                revertAfterMs = null,
            )
        }.onFailure { PlayerLogger.e(TAG, "emergency wake through the registry failed", it) }

        DisplayPrefs.setBlanked(app, false)
        val where = if (attached) "attached" else "detached"
        when {
            corrected -> PlayerLogger.e(
                TAG,
                "emergency enforce CORRECTED a darkened screen during an active alert " +
                    "(blanked=$wasBlanked dimmed=$wasDimmed) — screen driven visible (window $where)",
            )
            !quiet -> PlayerLogger.i(TAG, "emergency enforce — screen driven visible (window $where)")
        }
    }

    /** Re-assert on process start / window attach. No-op when not held. */
    fun enforceIfHeld(ctx: Context) {
        if (isHeld(ctx)) {
            PlayerLogger.i(TAG, "emergency hold is still active — re-asserting a visible screen")
            enforceNow(ctx)
        }
    }
}

/**
 * Turns the panel back on from a plain Context.
 *
 * `FLAG_TURN_SCREEN_ON` only works through a window that is actually
 * being shown; once the OS has slept the display (a screen-timeout
 * blank, a device-admin `lockNow()`) the Activity is stopped and there
 * is no window to flag. A short `ACQUIRE_CAUSES_WAKEUP` wake lock is the
 * one mechanism that works in that state without device-owner
 * privileges — which is why the emergency path and every WAKE provider
 * calls it.
 *
 * `SCREEN_BRIGHT_WAKE_LOCK` is deprecated (API 17) and still functional
 * on every Android we ship to; the modern replacement (`setTurnScreenOn`
 * + `KeyguardManager.requestDismissKeyguard`) has the same
 * needs-a-live-window limitation. The lock is acquired WITH A TIMEOUT so
 * it can never be leaked — if the Activity comes back it re-asserts
 * FLAG_KEEP_SCREEN_ON and the lock's expiry is irrelevant.
 */
internal object ScreenWakeLock {

    private const val TAG = "ScreenWakeLock"

    /** Long enough for the Activity to resume and re-assert KEEP_SCREEN_ON. */
    private const val HOLD_MS = 30_000L

    @Suppress("DEPRECATION")
    fun pokeScreen(ctx: Context) {
        runCatching {
            val pm = ctx.applicationContext.getSystemService(Context.POWER_SERVICE) as? PowerManager
                ?: return@runCatching
            val lock = pm.newWakeLock(
                PowerManager.SCREEN_BRIGHT_WAKE_LOCK or PowerManager.ACQUIRE_CAUSES_WAKEUP,
                "educms:display-wake",
            )
            lock.setReferenceCounted(false)
            // Timed acquire — never a leak, even if nothing releases it.
            lock.acquire(HOLD_MS)
            PlayerLogger.i(TAG, "screen wake lock acquired for ${HOLD_MS}ms")
        }.onFailure { PlayerLogger.w(TAG, "could not poke the screen awake: ${it.message}") }
    }
}
