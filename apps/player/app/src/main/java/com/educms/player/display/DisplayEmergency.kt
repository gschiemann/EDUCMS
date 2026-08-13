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
 * Every ambiguity here resolves toward "the screen is visible". A hold
 * that is set when there is no real emergency costs electricity. A hold
 * that is missed costs someone their safety. So:
 *
 *   * `setHold(true)` is accepted from ANY transport, including the
 *     legacy every-frame bridge — it can only ever make a dark screen
 *     visible.
 *   * `setHold(false)` is treated as a mutating, risk-direction action
 *     and is refused on the untrusted transport (see `WebAppBridge`).
 *   * A hold NEVER auto-expires. A screen that stays lit because the
 *     page died mid-alert is a power bill; one that blanks because a
 *     timer decided the emergency was over is not recoverable.
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
        // TRULY idempotent. The web player calls this on EVERY manifest
        // poll that carries an `emergency` field — every ~10-30 s — so
        // re-doing the work here would churn a wake lock and flood the
        // log, and re-stamping `heldSince` would destroy the one signal
        // ops has for "this screen has been held for six hours because
        // the page died mid-alert". Re-enforcement after a window or
        // process restart is [enforceIfHeld]'s job, wired into
        // MainActivity.onResume and DisplayControlApi.onWindowAttached.
        if (alreadyHeld) return true

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
     */
    fun enforceNow(ctx: Context) {
        val app = ctx.applicationContext
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
        PlayerLogger.i(TAG, "emergency enforce — screen driven visible (window ${if (attached) "attached" else "detached"})")
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
