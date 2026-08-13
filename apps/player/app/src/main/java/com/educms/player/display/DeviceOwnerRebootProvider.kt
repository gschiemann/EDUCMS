package com.educms.player.display

import android.app.admin.DevicePolicyManager
import android.content.Context
import com.educms.player.logging.PlayerLogger

/**
 * Reboot via `DevicePolicyManager.reboot(admin)`. Device owner ONLY —
 * no fallback exists at any privilege level, which is why the registry's
 * REBOOT chain has exactly one entry and why a box that cannot do it
 * reports the capability as absent rather than degraded.
 *
 * ⚠️ SAME OBJECTION AS [DeviceAdminBlankProvider], and it bites harder
 * here. `reboot()` needs BOTH (a) `ctx.packageName` to be the device
 * owner and (b) an admin ComponentName in this package to pass as the
 * argument. Today the Player has neither — MANAGER
 * (`com.educms.manager/.AdminReceiver`) is the provisioned device owner.
 * So [supports] returns an empty set on every real box, the dashboard
 * correctly hides the reboot button, and the typed-confirm flow never
 * gets a chance to fire something that would only throw. The fix is the
 * Manager-side broadcast receiver described in
 * [DeviceAdminBlankProvider]'s header.
 *
 * API note: `reboot(ComponentName)` is API 24 and minSdk is 24, so no
 * `@RequiresApi` isolation object is needed — nothing here can leak an
 * API-28+ symbol into a class ART loads on an Android-11 Taurus.
 *
 * The dashboard MUST keep reboot behind a typed confirm. This is the one
 * action with no dead-man revert: [DisplayGuard] refuses to arm one for
 * REBOOT because there is no prior state to restore, only a box that
 * comes back or does not.
 */
object DeviceOwnerRebootProvider : DisplayControlProvider {

    private const val TAG = "DeviceOwnerReboot"

    override val id: String = "device-owner"

    override fun supports(ctx: Context): Set<Capability> {
        val app = ctx.applicationContext
        val dpm = app.getSystemService(Context.DEVICE_POLICY_SERVICE) as? DevicePolicyManager
            ?: return emptySet()
        val isOwner = try {
            dpm.isDeviceOwnerApp(app.packageName)
        } catch (t: Throwable) {
            false
        }
        if (!isOwner) return emptySet()
        // Device owner without an admin component in our own package is
        // not a state Android produces, but reboot() needs the component
        // so we verify rather than assume.
        if (DeviceAdminBlankProvider.adminComponent(app) == null) return emptySet()
        return setOf(Capability.REBOOT)
    }

    override fun apply(ctx: Context, action: DisplayAction): ActionResult {
        if (action !is DisplayAction.Reboot) {
            return ActionResult.Unsupported("device-owner provider only handles reboot")
        }
        val app = ctx.applicationContext
        val dpm = app.getSystemService(Context.DEVICE_POLICY_SERVICE) as? DevicePolicyManager
            ?: return ActionResult.Unsupported("no DevicePolicyManager")
        val admin = DeviceAdminBlankProvider.adminComponent(app)
            ?: return ActionResult.Unsupported("this package holds no active device admin — cannot reboot()")
        return try {
            PlayerLogger.i(TAG, "REBOOT requested — dpm.reboot($admin)")
            dpm.reboot(admin)
            ActionResult.Ok(id)
        } catch (t: Throwable) {
            // IllegalStateException when a call is in progress, or
            // SecurityException when we are not actually the owner.
            PlayerLogger.w(TAG, "reboot() failed: ${t.message}")
            ActionResult.Failed(t.message ?: t.javaClass.simpleName, id)
        }
    }
}
