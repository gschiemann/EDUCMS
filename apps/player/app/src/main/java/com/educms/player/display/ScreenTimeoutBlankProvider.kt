package com.educms.player.display

import android.content.Context
import android.provider.Settings
import com.educms.player.logging.PlayerLogger

/**
 * A REAL screen-off blank that needs no device admin and no device
 * owner — only the WRITE_SETTINGS appop.
 *
 * ═════════════════════════════════════════════════════════════════════
 * WHY THIS PROVIDER EXISTS (the 2026-08-13 no-device-owner pivot)
 * ═════════════════════════════════════════════════════════════════════
 * The product decision is that we do NOT provision this app as Android
 * device owner. That leaves the BLANK chain with a real gap:
 *
 *   * [VendorRecipeProvider] — only on a box we have a recipe for;
 *   * [DeviceAdminBlankProvider] — reachable (the operator taps through
 *     ACTION_ADD_DEVICE_ADMIN; `lockNow()` needs only
 *     USES_POLICY_FORCE_LOCK) but requires that enrolment;
 *   * [SoftwareDimProvider] — always works, but on an LCD it draws a
 *     black rectangle while the backlight stays lit. No power saved,
 *     and it is the thing that hid a lockdown alert (see
 *     [DisplayEmergency]).
 *
 * This sits between the last two. Releasing FLAG_KEEP_SCREEN_ON and
 * shortening `Settings.System.SCREEN_OFF_TIMEOUT` makes the OS itself
 * turn the panel off — a genuine display-off, on any box where the
 * operator has allowed WRITE_SETTINGS, with no admin enrolment at all.
 * WRITE_SETTINGS is grantable two ways, neither of which needs a
 * factory reset: `Settings.ACTION_MANAGE_WRITE_SETTINGS` (an operator
 * tap) or a one-shot `adb shell appops set <pkg> WRITE_SETTINGS allow`.
 *
 * ─────────────────────────────────────────────────────────────────────
 * ⚠️  THE PROMISE THAT MAKES THIS SAFE
 * ─────────────────────────────────────────────────────────────────────
 * We are mutating a GLOBAL device setting that the operator (or the
 * vendor CMS) may care about. So:
 *
 *   1. the prior timeout is snapshotted to prefs with `commit()` BEFORE
 *      it is shortened, and only when we have not already snapshotted
 *      one — a second blank must never overwrite the real prior value
 *      with our own short one;
 *   2. every wake/revert restores it and clears the snapshot;
 *   3. the snapshot survives a process death, so the dead-man revert and
 *      the boot-path replay both put it back.
 *
 * WAKING FROM THIS STATE. Once the OS has slept the display the Activity
 * is stopped, and FLAG_TURN_SCREEN_ON only acts through a window that is
 * actually being shown — so the window hooks alone cannot bring the
 * panel back. [ScreenWakeLock.pokeScreen] is what actually does it, and
 * it is the same call the emergency interlock makes.
 */
object ScreenTimeoutBlankProvider : DisplayControlProvider {

    private const val TAG = "ScreenTimeoutBlank"

    override val id: String = "screen-timeout"

    /**
     * How long the OS waits before sleeping the panel once we let go.
     * Deliberately not the minimum: some ROMs treat a very small value
     * as invalid, and 15 s is short enough that "blank" reads as
     * immediate to an operator watching a hallway screen.
     */
    internal const val BLANK_TIMEOUT_MS = 15_000

    /** Used when a wake finds no snapshot (we never blanked, or it was lost). */
    internal const val FALLBACK_TIMEOUT_MS = 30 * 60 * 1000

    override fun supports(ctx: Context): Set<Capability> =
        if (SettingsBrightnessProvider.canWrite(ctx)) {
            setOf(Capability.BLANK, Capability.WAKE)
        } else {
            emptySet()
        }

    override fun apply(ctx: Context, action: DisplayAction): ActionResult = when (action) {
        DisplayAction.Blank -> blank(ctx)
        DisplayAction.Wake -> wake(ctx)
        else -> ActionResult.Unsupported("screen-timeout only handles blank/wake")
    }

    private fun blank(ctx: Context): ActionResult {
        val app = ctx.applicationContext
        if (!SettingsBrightnessProvider.canWrite(app)) {
            return ActionResult.Unsupported("WRITE_SETTINGS not granted — operator must allow it in Settings")
        }
        return try {
            val current = Settings.System.getInt(
                app.contentResolver,
                Settings.System.SCREEN_OFF_TIMEOUT,
                -1,
            )
            // Snapshot ONCE. A second blank while one is already in force
            // must not record our own 15 s as "the prior value" — that is
            // how a device ends up permanently sleeping after 15 s.
            if (DisplayPrefs.priorScreenOffTimeoutMs(app) == null && current > 0 && current != BLANK_TIMEOUT_MS) {
                DisplayPrefs.setPriorScreenOffTimeoutMs(app, current)
            }
            // The window flag must go first — a window holding
            // KEEP_SCREEN_ON pins the panel lit no matter what the
            // timeout says, which reads as "the vendor blocked it".
            DisplayWindowBridge.withHooks { it.setKeepScreenOn(false) }
            val wrote = Settings.System.putInt(
                app.contentResolver,
                Settings.System.SCREEN_OFF_TIMEOUT,
                BLANK_TIMEOUT_MS,
            )
            if (!wrote) {
                // Put the flag back — we changed state and did not get the
                // blank, so leaving KEEP_SCREEN_ON off would let the panel
                // sleep on the OS's own schedule with nothing tracking it.
                DisplayWindowBridge.withHooks { it.setKeepScreenOn(true) }
                return ActionResult.Failed("Settings.System.putInt(SCREEN_OFF_TIMEOUT) returned false", id)
            }
            PlayerLogger.i(TAG, "blank — screen-off timeout ${BLANK_TIMEOUT_MS}ms (was ${current}ms)")
            ActionResult.Ok(id, "screen off in ${BLANK_TIMEOUT_MS / 1000}s")
        } catch (t: Throwable) {
            DisplayWindowBridge.withHooks { it.setKeepScreenOn(true) }
            PlayerLogger.w(TAG, "blank failed: ${t.message}")
            ActionResult.Failed(t.message ?: t.javaClass.simpleName, id)
        }
    }

    private fun wake(ctx: Context): ActionResult {
        val app = ctx.applicationContext
        // Restore the timeout FIRST. Waking the panel while the OS still
        // holds a 15 s timeout would drop it straight back off before the
        // Activity has resumed far enough to re-assert KEEP_SCREEN_ON.
        val restored = restoreTimeout(app)
        DisplayWindowBridge.withHooks { h ->
            h.setBlackout(false)
            h.setKeepScreenOn(true)
            h.requestWake()
        }
        // The panel may already be OFF, in which case there is no live
        // window for FLAG_TURN_SCREEN_ON to act through. This is the call
        // that actually turns it back on.
        ScreenWakeLock.pokeScreen(app)
        PlayerLogger.i(TAG, "wake — screen-off timeout restored to ${restored}ms")
        return ActionResult.Ok(id, "timeout restored to ${restored}ms")
    }

    /**
     * Put `SCREEN_OFF_TIMEOUT` back and clear the snapshot. Also called
     * on the boot/replay path, where the snapshot may be the only record
     * that we ever shortened it.
     *
     * Returns the value now in force.
     */
    internal fun restoreTimeout(ctx: Context): Int {
        val app = ctx.applicationContext
        val saved = DisplayPrefs.priorScreenOffTimeoutMs(app)
        if (!SettingsBrightnessProvider.canWrite(app)) {
            // Nothing we can do; keep the snapshot so a later wake, after
            // the operator grants the appop, can still put it back.
            return saved ?: -1
        }
        val target = saved ?: run {
            val current = Settings.System.getInt(
                app.contentResolver,
                Settings.System.SCREEN_OFF_TIMEOUT,
                -1,
            )
            // No snapshot. Only intervene if the CURRENT value is our own
            // short one — otherwise this is a device we never blanked and
            // it is not ours to change.
            if (current == BLANK_TIMEOUT_MS) FALLBACK_TIMEOUT_MS else return current
        }
        return try {
            Settings.System.putInt(app.contentResolver, Settings.System.SCREEN_OFF_TIMEOUT, target)
            DisplayPrefs.setPriorScreenOffTimeoutMs(app, null)
            target
        } catch (t: Throwable) {
            PlayerLogger.w(TAG, "could not restore SCREEN_OFF_TIMEOUT: ${t.message}")
            -1
        }
    }
}
