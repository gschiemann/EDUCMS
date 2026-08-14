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

    fun isHeld(ctx: Context): Boolean = DisplayPrefs.emergencyHold(ctx.applicationContext)

    fun heldSinceMs(ctx: Context): Long = DisplayPrefs.emergencyHoldSince(ctx.applicationContext)

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
    fun setHold(ctx: Context, active: Boolean): Boolean {
        val app = ctx.applicationContext
        val was = isHeld(app)
        return if (active) engage(app, was) else release(app, was)
    }

    private fun engage(app: Context, alreadyHeld: Boolean): Boolean {
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
            enforceNow(app, quiet = true)
            return true
        }

        // Capture what the operator had configured BEFORE we drive to
        // full, so the release path can put it back.
        DisplayPrefs.setPreHoldBrightnessPercent(app, DisplayPrefs.brightnessPercent(app))
        PlayerLogger.e(
            TAG,
            "EMERGENCY HOLD ENGAGED — blank/dim/reboot are refused until all-clear",
        )
        val persisted = DisplayPrefs.commitEmergencyHold(app, true, System.currentTimeMillis())
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

    private fun release(app: Context, wasHeld: Boolean): Boolean {
        if (!wasHeld) return true
        val persisted = DisplayPrefs.commitEmergencyHold(app, false, 0L)
        PlayerLogger.i(TAG, "emergency hold RELEASED — restoring configured brightness + schedule")

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
