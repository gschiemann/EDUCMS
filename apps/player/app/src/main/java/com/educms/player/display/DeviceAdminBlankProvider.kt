package com.educms.player.display

import android.app.KeyguardManager
import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import com.educms.player.logging.PlayerLogger

/**
 * Real screen blank via `DevicePolicyManager.lockNow()`, and wake via
 * the FLAG_TURN_SCREEN_ON / FLAG_DISMISS_KEYGUARD path MainActivity
 * already owns.
 *
 * ═════════════════════════════════════════════════════════════════════
 * ⚠️  REACHABLE — ONE OPERATOR TAP AWAY (2026-08-14)
 * ═════════════════════════════════════════════════════════════════════
 * Product decision 2026-08-13: no device OWNER. Device ADMIN is a
 * different, much cheaper thing and IS reachable — no factory reset, no
 * adb, no accounts constraint — and `lockNow()` needs only
 * USES_POLICY_FORCE_LOCK, which any active admin declaring it holds.
 *
 * This file used to carry a long note saying the tier could never
 * resolve because `com.educms.player` declared no `DeviceAdminReceiver`
 * of its own, so there was nothing for the operator to enrol. THAT GAP
 * IS CLOSED. As of 2026-08-14 the Player ships:
 *
 *   * `display/PlayerAdminReceiver` — our own receiver, declared in the
 *     PLAYER manifest with BIND_DEVICE_ADMIN;
 *   * `res/xml/player_device_admin.xml` — force-lock ONLY (contrast the
 *     Manager's, which also declares wipe-data purely to be
 *     device-owner-eligible; we are not doing that here);
 *   * `DeviceAdminEnrollment` — the operator-initiated
 *     `ACTION_ADD_DEVICE_ADMIN` prompt, plus the Settings →
 *     Security → Device admin apps toggle, which needs no code at all.
 *
 * So [supports] now genuinely lights up in the field. When it does NOT,
 * BLANK still falls through to [ScreenTimeoutBlankProvider] (a real
 * display-off on the WRITE_SETTINGS appop alone) and then to
 * [SoftwareDimProvider], which always works.
 *
 * ⚠️ THE MIS-READING THIS FILE EXISTS TO PREVENT, still true: the
 * force-lock policy is scoped to the CALLING PACKAGE. "Any active admin"
 * is NOT enough — a vendor CMS's admin (which is what the probe's
 * `activeAdminCount > 0` counts) grants us exactly nothing. [ourAdmin]
 * therefore asks `isAdminActive(OUR component)` and nothing else.
 *
 * Note also that if the manufacturer ever ships us preinstalled and
 * platform-signed (the strictly-more-capable end state this fleet is
 * heading for), nothing in this file changes.
 */
object DeviceAdminBlankProvider : DisplayControlProvider {

    private const val TAG = "DeviceAdminBlank"

    override val id: String = "device-admin"

    override fun supports(ctx: Context): Set<Capability> = when {
        ourAdmin(ctx) == null -> emptySet()
        // ⚠️ SEE [secureKeyguardBlocks]. Being enrolled is necessary but
        // not sufficient — on a box with a real screen lock this tier
        // would blank fine and then be unable to come back.
        secureKeyguardBlocks(ctx) -> emptySet()
        else -> setOf(Capability.BLANK, Capability.WAKE)
    }

    override fun apply(ctx: Context, action: DisplayAction): ActionResult = when (action) {
        DisplayAction.Blank -> blank(ctx)
        DisplayAction.Wake -> wake(ctx)
        else -> ActionResult.Unsupported("device-admin only handles blank/wake")
    }

    /**
     * ⚠️ THE ONE-WAY-BLANK TRAP.
     *
     * `lockNow()` does exactly what it says: it sleeps the panel AND
     * engages the keyguard. On a signage box that is harmless, because
     * these boxes ship with no screen lock — the keyguard is the
     * swipe/none variant and `MainActivity`'s FLAG_DISMISS_KEYGUARD +
     * `showWhenLocked` walk straight through it, which is what makes
     * [wake] work at all.
     *
     * If somebody HAS set a PIN/pattern/password on the box, none of
     * that applies: FLAG_DISMISS_KEYGUARD does not dismiss a SECURE
     * keyguard (since API 26 that needs `requestDismissKeyguard` plus a
     * live user authentication), so the screen would wake to a lock
     * screen instead of to the content, with no remote way past it. A
     * blank nobody can undo without a ladder is the single worst outcome
     * this package has, and it is the reason [DisplayControlProvider
     * .supports] is required to be honest rather than optimistic.
     *
     * So we decline the whole tier there and let BLANK/WAKE fall through
     * to [ScreenTimeoutBlankProvider] / [SoftwareDimProvider], both of
     * which recover from anything.
     *
     * `isDeviceSecure()` is API 23 (minSdk is 24), so no @RequiresApi
     * isolation object and no ART class-load risk on the Android 7.1.2
     * RK3288 in the pilot fleet. It answers false for swipe/none, true
     * for PIN/pattern/password — exactly the distinction that matters.
     * Unknown (no KeyguardManager, a throwing ROM) is treated as
     * BLOCKED: guessing wrong toward "safe to blank" is the truck roll.
     */
    internal fun secureKeyguardBlocks(ctx: Context): Boolean = try {
        val km = ctx.applicationContext.getSystemService(Context.KEYGUARD_SERVICE) as? KeyguardManager
        if (km == null) {
            PlayerLogger.w(TAG, "no KeyguardManager — declining the device-admin blank tier")
            true
        } else {
            km.isDeviceSecure.also {
                if (it) {
                    PlayerLogger.w(
                        TAG,
                        "a SECURE screen lock is set on this box — declining the device-admin blank tier, " +
                            "because lockNow() would wake to a keyguard nothing can dismiss remotely",
                    )
                }
            }
        }
    } catch (t: Throwable) {
        PlayerLogger.w(TAG, "keyguard check threw (${t.message}) — declining the device-admin blank tier")
        true
    }

    private fun blank(ctx: Context): ActionResult {
        val dpm = dpm(ctx) ?: return ActionResult.Unsupported("no DevicePolicyManager")
        if (ourAdmin(ctx) == null) {
            return ActionResult.Unsupported("this package holds no active device admin — cannot lockNow()")
        }
        // Re-checked at APPLY time, not just at resolution time: the
        // registry caches its resolution, and an operator can set a
        // screen lock at any moment after that cache was filled.
        if (secureKeyguardBlocks(ctx)) {
            return ActionResult.Unsupported(
                "a secure screen lock is set — lockNow() would wake to a keyguard we cannot dismiss remotely",
            )
        }
        return try {
            // FLAG_KEEP_SCREEN_ON is set in MainActivity.onCreate AND on
            // the root FrameLayout in activity_main.xml. Leaving either
            // in place makes lockNow() a no-op that re-wakes on most
            // ROMs, which reads as "the vendor blocked it".
            DisplayWindowBridge.withHooks { it.setKeepScreenOn(false) }
            dpm.lockNow()
            PlayerLogger.i(TAG, "lockNow() — screen blanked via $id")
            ActionResult.Ok(id)
        } catch (t: Throwable) {
            PlayerLogger.w(TAG, "lockNow() failed: ${t.message}")
            ActionResult.Failed(t.message ?: t.javaClass.simpleName, id)
        }
    }

    private fun wake(ctx: Context): ActionResult {
        val attached = DisplayWindowBridge.withHooks { h ->
            h.setBlackout(false)
            h.setKeepScreenOn(true)
            h.requestWake()
        }
        // lockNow() genuinely SLEEPS the display, so by the time a wake
        // arrives the Activity is stopped and FLAG_TURN_SCREEN_ON has no
        // live window to act through. This is the call that turns the
        // panel back on from a plain Context.
        ScreenWakeLock.pokeScreen(ctx)
        return if (attached) {
            PlayerLogger.i(TAG, "wake via window flags")
            ActionResult.Ok(id)
        } else {
            // No window to wake through. Not a hard failure — the
            // Activity re-applies persisted state when it attaches.
            ActionResult.Ok(id, "deferred — no window attached")
        }
    }

    private fun dpm(ctx: Context): DevicePolicyManager? =
        ctx.applicationContext.getSystemService(Context.DEVICE_POLICY_SERVICE) as? DevicePolicyManager

    /**
     * An active admin component belonging to THIS package — the only
     * thing that makes `lockNow()` legal for us. Deliberately NOT
     * "any active admin": another app's admin grants us nothing, and
     * treating it as ours is exactly the mis-reading that would have
     * shipped a blank button that always throws SecurityException.
     *
     * Asked EXACTLY of [PlayerAdminReceiver] via `isAdminActive`, rather
     * than by scanning `activeAdmins` for our package name. Both answer
     * the same today, but the direct question is the one that stays
     * correct if a second Player-owned receiver is ever added (only the
     * one declaring force-lock may drive `lockNow`), and it is the same
     * component `DeviceAdminEnrollment` enrols — so the thing we test
     * and the thing the operator activated can never be two different
     * components.
     */
    private fun ourAdmin(ctx: Context): ComponentName? = try {
        val app = ctx.applicationContext
        val component = PlayerAdminReceiver.componentName(app)
        if (dpm(app)?.isAdminActive(component) == true) component else null
    } catch (t: Throwable) {
        null
    }

    /** Exposed for [DeviceOwnerRebootProvider], which needs the same component. */
    internal fun adminComponent(ctx: Context): ComponentName? = ourAdmin(ctx)
}
