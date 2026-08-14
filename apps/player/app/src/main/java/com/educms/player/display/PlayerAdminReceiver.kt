package com.educms.player.display

import android.app.admin.DeviceAdminReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import com.educms.player.R
import com.educms.player.logging.PlayerLogger

/**
 * The Player's OWN `DeviceAdminReceiver` — the missing piece that makes
 * [DeviceAdminBlankProvider] a reachable tier instead of dead code.
 *
 * ═════════════════════════════════════════════════════════════════════
 * DEVICE **ADMIN** IS NOT DEVICE **OWNER**. READ THIS FIRST.
 * ═════════════════════════════════════════════════════════════════════
 * The product decision (2026-08-13) is that we do NOT provision this app
 * as Android device OWNER: that needs a factory-reset box with no
 * accounts, it is a one-way door, and on a vendor-CMS signage panel it
 * would wipe the vendor's own config. None of that applies here.
 *
 * Device ADMIN is the lighter, older role:
 *
 *   * no factory reset, no adb, no accounts constraint;
 *   * granted by the operator tapping through one system dialog
 *     (`ACTION_ADD_DEVICE_ADMIN`) or one toggle in
 *     Settings → Security → Device admin apps;
 *   * revocable at any time from that same Settings screen;
 *   * many admins can coexist — a vendor CMS holding its own admin does
 *     NOT block ours (device owner is the singleton, admin is not).
 *
 * `DevicePolicyManager.lockNow()` needs only USES_POLICY_FORCE_LOCK,
 * which any ACTIVE admin that declares it holds. That is the whole
 * unlock, and `res/xml/player_device_admin.xml` declares force-lock and
 * nothing else.
 *
 * ═════════════════════════════════════════════════════════════════════
 * WHY IT MATTERS ON THIS FLEET
 * ═════════════════════════════════════════════════════════════════════
 * Without it, BLANK falls through to [ScreenTimeoutBlankProvider] (which
 * needs the WRITE_SETTINGS appop — grantable, but in practice via adb)
 * and then to [SoftwareDimProvider], a black overlay that saves no power
 * and does not turn the panel off. On a fleet with no device owner and
 * no adb, that means "blank" did not really work. This receiver is what
 * makes a real panel-off blank reachable by one operator tap.
 *
 * ═════════════════════════════════════════════════════════════════════
 * ⚠️ WHAT THIS CLASS DOES **NOT** DO
 * ═════════════════════════════════════════════════════════════════════
 *   * It NEVER enrols itself. Enrolment is always operator-initiated —
 *     see [DeviceAdminEnrollment], which is the only thing that fires
 *     the system dialog, and is called only from explicit operator
 *     actions. Nothing on the boot path, the schedule path or the
 *     manifest path may ever call it: a signage box that pops a system
 *     security dialog on a wall in front of customers is worse than a
 *     screen that dims in software.
 *   * It declares NO policy beyond force-lock, and calls no DPM mutator
 *     of its own. The one `lockNow()` in the codebase lives in
 *     [DeviceAdminBlankProvider] and is gated by the emergency
 *     interlock like every other darkening action.
 *
 * ═════════════════════════════════════════════════════════════════════
 * SIDE EFFECT WORTH KNOWING (field ops)
 * ═════════════════════════════════════════════════════════════════════
 * While this admin is ACTIVE, Android refuses to UNINSTALL the Player
 * until it is deactivated in Settings → Security → Device admin apps.
 * APK *updates* are unaffected (a replace is not an uninstall), so OTA
 * keeps working exactly as before. If a tech needs to remove the app,
 * deactivate the admin first.
 *
 * API LEVEL: `DeviceAdminReceiver`, `onEnabled`, `onDisabled`,
 * `onDisableRequested`, `isAdminActive` and `lockNow` are all API 8.
 * Nothing here is API 28+, so there is no @RequiresApi isolation object
 * to build and no risk of ART resolving a too-new symbol at class-load
 * on the Android 7.1.2 (API 25) RK3288 in the pilot fleet.
 */
class PlayerAdminReceiver : DeviceAdminReceiver() {

    /**
     * Fires the moment the admin goes ACTIVE — whichever way it got
     * there: our `ACTION_ADD_DEVICE_ADMIN` dialog, the operator toggling
     * it in Settings, or an `adb shell dpm set-active-admin`.
     *
     * ⚠️ THIS IS THE "resolves the moment enrolment completes" HOOK.
     * [DisplayControlRegistry] caches its capability→provider resolution
     * for the life of the process, so without an invalidate here the box
     * would keep reporting `BLANK=software-dim` until the process next
     * died — which on a healthy kiosk is days. `MainActivity.onResume`
     * also invalidates (that is the belt for the appop case), but this
     * is the braces: the Settings-toggle path may not bring our Activity
     * back at all.
     */
    override fun onEnabled(context: Context, intent: Intent) {
        super.onEnabled(context, intent)
        PlayerLogger.i(
            TAG,
            "device ADMIN active for ${context.packageName} — real panel-off blank via lockNow() is now available",
        )
        DeviceAdminEnrollment.onAdminEnabled(context)
    }

    /**
     * Deactivated. Same invalidate, opposite direction: BLANK has to drop
     * back down the chain to [ScreenTimeoutBlankProvider] /
     * [SoftwareDimProvider] IMMEDIATELY, or the dashboard keeps offering
     * a real blank this box can no longer perform and every attempt
     * throws SecurityException.
     */
    override fun onDisabled(context: Context, intent: Intent) {
        super.onDisabled(context, intent)
        PlayerLogger.w(
            TAG,
            "device ADMIN deactivated — BLANK falls back to the screen-timeout / software-dim tiers",
        )
        DeviceAdminEnrollment.onAdminDisabled(context)
    }

    /**
     * Shown in the system's "deactivate?" confirmation. Honest about the
     * consequence and nothing more — this is not the place to argue.
     */
    override fun onDisableRequested(context: Context, intent: Intent): CharSequence =
        try {
            context.getString(R.string.device_admin_disable_warning)
        } catch (t: Throwable) {
            "Scheduled screen off will stop working."
        }

    companion object {
        private const val TAG = "PlayerAdmin"

        /**
         * The ComponentName every DPM call needs.
         *
         * Built from the RUNTIME context, never a hardcoded string:
         * the debug build carries `applicationIdSuffix = ".debug"`
         * (see `app/build.gradle.kts`), so a literal
         * "com.educms.player/.display.PlayerAdminReceiver" would name a
         * component that does not exist on a debug kiosk — and
         * `isAdminActive` on a non-existent component silently answers
         * false, which is the quietest possible version of this bug.
         */
        fun componentName(ctx: Context): ComponentName =
            ComponentName(ctx.applicationContext, PlayerAdminReceiver::class.java)
    }
}
