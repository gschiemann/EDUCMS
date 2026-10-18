package com.educms.player.settings

import android.content.Context
import android.hardware.display.DisplayManager
import android.os.Build
import android.provider.Settings
import android.view.Display
import com.educms.player.display.ActionResult
import com.educms.player.display.DisplayAction
import com.educms.player.display.DisplayControlRegistry
import com.educms.player.display.ScreenTimeoutBlankProvider

/**
 * The WRITE half (2026-10-18). Called only by [DeviceSettings] after
 * [DeviceSettingsPolicy] said `Apply` and the attempt was persisted.
 *
 * Brightness and volume go through `DisplayControlRegistry.apply` — THE
 * single entry point for anything that drives the panel — so the emergency
 * gate, the brightness floor, the brightness mirror the after-alert restore
 * reads, and the forensic log line all hold for a stored setting exactly as
 * for the live slider. Brightness is restricted to the two mechanisms whose
 * level can be read back (`allowProvider`); the software dimmer and the
 * vendor mechanisms are never used here.
 *
 * The screen-off timeout goes through `ScreenTimeoutBlankProvider`, which
 * owns that setting during a blank — it refuses while its 15 s is in force.
 */
object DeviceSettingsAppliers {

    fun apply(ctx: Context, item: DesiredItem): DeviceSettingsPolicy.Outcome {
        val app = ctx.applicationContext
        return try {
            when (item.key) {
                DeviceSettingKey.BRIGHTNESS -> registry(
                    DisplayControlRegistry.apply(
                        app,
                        DisplayAction.SetBrightness(int(item)),
                        revertAfterMs = null,
                        allowProvider = { it in DeviceSettingsFacts.READABLE_BRIGHTNESS },
                    ),
                )
                DeviceSettingKey.VOLUME -> registry(
                    DisplayControlRegistry.apply(app, DisplayAction.SetVolume(int(item), showUi = false), revertAfterMs = null),
                )
                DeviceSettingKey.SCREEN_OFF_TIMEOUT -> when (ScreenTimeoutBlankProvider.writeBaselineTimeout(app, int(item))) {
                    ScreenTimeoutBlankProvider.BaselineWrite.WRITTEN -> DeviceSettingsPolicy.Outcome.Done
                    // Not an attempt that failed: the next heartbeat sees the
                    // blank through the policy and waits for the wake.
                    ScreenTimeoutBlankProvider.BaselineWrite.BLANK_IN_FORCE ->
                        DeviceSettingsPolicy.Outcome.Error(DeviceSettingCodes.WAIT_BLANKED)
                    ScreenTimeoutBlankProvider.BaselineWrite.REFUSED ->
                        DeviceSettingsPolicy.Outcome.Error(DeviceSettingCodes.WRITE_REFUSED)
                }
                DeviceSettingKey.ROTATION_LOCK -> rotationLock(app, bool(item))
                DeviceSettingKey.AUTO_TIME ->
                    wrote(Settings.Global.putInt(app.contentResolver, Settings.Global.AUTO_TIME, if (bool(item)) 1 else 0))
                DeviceSettingKey.AUTO_TIME_ZONE ->
                    wrote(Settings.Global.putInt(app.contentResolver, Settings.Global.AUTO_TIME_ZONE, if (bool(item)) 1 else 0))
                DeviceSettingKey.NTP_SERVER -> {
                    val host = (item.value as DesiredValue.TextValue).value
                    // "" removes the override: Android's own time server again.
                    wrote(Settings.Global.putString(app.contentResolver, DeviceSettingsProbe.NTP_SERVER_KEY, host.ifEmpty { null }))
                }
                DeviceSettingKey.WIFI ->
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                        Api33WifiSuggestions.replace(app, item.value as DesiredValue.WifiValue)
                    } else {
                        DeviceSettingsPolicy.Outcome.Error(DeviceSettingCodes.API_LEVEL)
                    }
            }
        } catch (e: SecurityException) {
            DeviceSettingsPolicy.Outcome.Error(DeviceSettingCodes.WRITE_REFUSED)
        } catch (t: Throwable) {
            DeviceSettingsPolicy.Outcome.Error(DeviceSettingCodes.ERROR)
        }
    }

    /**
     * Lock rotation AT THE ROTATION ON THE GLASS NOW. `USER_ROTATION` is
     * written first, to the current rotation, so turning auto-rotate off can
     * never snap the panel to a stale stored rotation. Our own Activity keeps
     * the orientation the operator set for it either way; this governs
     * Android's own screens and other apps.
     */
    private fun rotationLock(app: Context, lock: Boolean): DeviceSettingsPolicy.Outcome {
        val cr = app.contentResolver
        if (lock) {
            val rotation = (app.getSystemService(Context.DISPLAY_SERVICE) as? DisplayManager)
                ?.getDisplay(Display.DEFAULT_DISPLAY)?.rotation
                ?: return DeviceSettingsPolicy.Outcome.Error(DeviceSettingCodes.ERROR)
            if (!Settings.System.putInt(cr, Settings.System.USER_ROTATION, rotation)) {
                return DeviceSettingsPolicy.Outcome.Error(DeviceSettingCodes.WRITE_REFUSED)
            }
        }
        return wrote(Settings.System.putInt(cr, Settings.System.ACCELEROMETER_ROTATION, if (lock) 0 else 1))
    }

    private fun registry(result: ActionResult): DeviceSettingsPolicy.Outcome =
        if (result.ok) DeviceSettingsPolicy.Outcome.Done
        else DeviceSettingsPolicy.Outcome.Error(DeviceSettingCodes.WRITE_REFUSED)

    private fun wrote(ok: Boolean): DeviceSettingsPolicy.Outcome =
        if (ok) DeviceSettingsPolicy.Outcome.Done else DeviceSettingsPolicy.Outcome.Error(DeviceSettingCodes.WRITE_REFUSED)

    private fun int(item: DesiredItem) = (item.value as DesiredValue.IntValue).value
    private fun bool(item: DesiredItem) = (item.value as DesiredValue.BoolValue).value
}
