package com.educms.player.display

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
 * ⚠️  OBJECTION ON RECORD — THIS PROVIDER IS INERT IN TODAY'S PLAYER
 * ═════════════════════════════════════════════════════════════════════
 * `lockNow()` requires the CALLING PACKAGE to be an active device admin.
 * As of this commit `com.educms.player` is neither an active admin nor
 * the device owner:
 *
 *   * the only `DeviceAdminReceiver` in the repo is
 *     `com.educms.manager.AdminReceiver`, declared in the MANAGER
 *     manifest;
 *   * `device_admin.xml` with `<force-lock/>` is a MANAGER resource;
 *   * every device-owner check in the Player asks about MANAGER's
 *     package (`MainActivity.managerIsDeviceOwner`,
 *     `PlayerApp.maybeEnableKioskHomeAlias`, `LockTaskController`), never
 *     `ctx.packageName`.
 *
 * The architecture assumed "any active admin with force-lock" would do.
 * It will not: the policy is scoped to the calling package, so a vendor
 * CMS's admin (which is what the probe's `activeAdminCount > 0` and its
 * `screenBlank: "device-admin"` verdict actually count) grants us
 * nothing. Implemented as specified, with an HONEST [supports] so the
 * dashboard never renders a blank button this box cannot perform — the
 * chain then falls through to [SoftwareDimProvider], which always works.
 *
 * THE PATH THAT WORKS, for whoever picks this up: route BLANK (and
 * REBOOT) to MANAGER over the existing signature-gated cross-app
 * broadcast — `PlayerApp.triggerManagerOtaCheck` (an explicit
 * `setPackage` intent sent with `com.educms.manager.HEALTH_PERMISSION`)
 * → `OtaTriggerReceiver` is the template, and Manager is already the
 * device owner on provisioned boxes, already declares `<force-lock/>`,
 * and already holds the admin ComponentName. That is a Manager-module
 * change, outside this commit's file domain. Note also that
 * `AdminReceiver.kt`'s "this class never calls dpm.lockNow()" comment
 * goes stale the day that lands.
 *
 * [supports] lights up automatically the moment a Player-owned admin
 * component exists, so no code here changes if the Player is ever
 * provisioned directly.
 */
object DeviceAdminBlankProvider : DisplayControlProvider {

    private const val TAG = "DeviceAdminBlank"

    override val id: String = "device-admin"

    override fun supports(ctx: Context): Set<Capability> =
        if (ourAdmin(ctx) != null) setOf(Capability.BLANK, Capability.WAKE) else emptySet()

    override fun apply(ctx: Context, action: DisplayAction): ActionResult = when (action) {
        DisplayAction.Blank -> blank(ctx)
        DisplayAction.Wake -> wake()
        else -> ActionResult.Unsupported("device-admin only handles blank/wake")
    }

    private fun blank(ctx: Context): ActionResult {
        val dpm = dpm(ctx) ?: return ActionResult.Unsupported("no DevicePolicyManager")
        if (ourAdmin(ctx) == null) {
            return ActionResult.Unsupported("this package holds no active device admin — cannot lockNow()")
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

    private fun wake(): ActionResult {
        val attached = DisplayWindowBridge.withHooks { h ->
            h.setBlackout(false)
            h.setKeepScreenOn(true)
            h.requestWake()
        }
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
     */
    private fun ourAdmin(ctx: Context): ComponentName? = try {
        val app = ctx.applicationContext
        val manager = dpm(app)
        manager?.activeAdmins?.firstOrNull { it.packageName == app.packageName }
    } catch (t: Throwable) {
        null
    }

    /** Exposed for [DeviceOwnerRebootProvider], which needs the same component. */
    internal fun adminComponent(ctx: Context): ComponentName? = ourAdmin(ctx)
}
