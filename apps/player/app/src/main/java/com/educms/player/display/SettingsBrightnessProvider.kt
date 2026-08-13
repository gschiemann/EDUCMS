package com.educms.player.display

import android.content.Context
import android.provider.Settings
import com.educms.player.logging.PlayerLogger

/**
 * Brightness via `Settings.System.SCREEN_BRIGHTNESS`.
 *
 * Two independent unknowns, and only the first is answerable from here:
 *
 *  1. **Can we write it?** Needs the WRITE_SETTINGS appop, which needs
 *     the manifest permission (now declared) AND an operator tap through
 *     `Settings.ACTION_MANAGE_WRITE_SETTINGS`. `Settings.System.canWrite`
 *     is the exact gate, and it is what [supports] returns on.
 *  2. **Does writing it move the panel?** Vendor-dependent and NOT
 *     answerable by reading — a stripped signage ROM can accept the
 *     write and ignore it. That is why this sits BELOW sysfs in the
 *     chain and ABOVE the software floor: it is more likely than
 *     software dim to be real, and less certain than a writable
 *     backlight node.
 *
 * Android's scale is 0..255. We map percent onto 1..255 (never 0) unless
 * the action explicitly allows black — a 0 here is indistinguishable
 * from "off" on hardware nobody can reach.
 */
object SettingsBrightnessProvider : DisplayControlProvider {

    private const val TAG = "SettingsBrightness"

    /** Android's `Settings.System.SCREEN_BRIGHTNESS` range. */
    private const val ANDROID_MAX = 255

    override val id: String = "settings"

    override fun supports(ctx: Context): Set<Capability> = try {
        if (Settings.System.canWrite(ctx.applicationContext)) setOf(Capability.BRIGHTNESS) else emptySet()
    } catch (t: Throwable) {
        emptySet()
    }

    override fun apply(ctx: Context, action: DisplayAction): ActionResult {
        if (action !is DisplayAction.SetBrightness) {
            return ActionResult.Unsupported("settings provider only handles brightness")
        }
        val app = ctx.applicationContext
        if (!canWrite(app)) {
            return ActionResult.Unsupported("WRITE_SETTINGS not granted — operator must allow it in Settings")
        }
        val floor = if (action.allowBlack) 0 else 1
        val target = DisplayLimits.scale(action.percent, 0, ANDROID_MAX).coerceAtLeast(floor)
        return try {
            // Manual mode first: an auto-brightness ROM would otherwise
            // overwrite our value on the next ambient-sensor tick.
            runCatching {
                Settings.System.putInt(
                    app.contentResolver,
                    Settings.System.SCREEN_BRIGHTNESS_MODE,
                    Settings.System.SCREEN_BRIGHTNESS_MODE_MANUAL,
                )
            }.onFailure { PlayerLogger.w(TAG, "could not force manual brightness mode: ${it.message}") }

            val wrote = Settings.System.putInt(app.contentResolver, Settings.System.SCREEN_BRIGHTNESS, target)
            if (!wrote) return ActionResult.Failed("Settings.System.putInt returned false", id)
            PlayerLogger.i(TAG, "brightness ${action.percent}% → $target/$ANDROID_MAX via $id")
            ActionResult.Ok(id, "$target/$ANDROID_MAX")
        } catch (t: Throwable) {
            PlayerLogger.w(TAG, "putInt failed: ${t.message}")
            ActionResult.Failed(t.message ?: t.javaClass.simpleName, id)
        }
    }

    fun canWrite(ctx: Context): Boolean = try {
        Settings.System.canWrite(ctx.applicationContext)
    } catch (t: Throwable) {
        false
    }
}
