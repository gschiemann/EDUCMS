package com.educms.player.settings

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.media.AudioManager
import android.net.wifi.WifiManager
import android.os.Build
import android.provider.Settings
import com.educms.player.display.Capability
import com.educms.player.display.DisplayControlRegistry
import com.educms.player.display.SettingsBrightnessProvider
import com.educms.player.display.SysfsBacklightProvider
import com.educms.player.led.LedCanvasHost
import com.educms.player.logging.PlayerLogger

/**
 * READ-ONLY: the Android facts behind [DeviceSettingsFacts] (2026-10-18).
 * Runs on every native heartbeat, so every read is a cheap provider query or
 * a permission check, and each one is guarded on its own — an odd ROM costs
 * one fact, never the report.
 *
 * Same discipline as `display.DisplayCapabilityProbe`: nothing here writes.
 * The writes live in [DeviceSettingsAppliers], behind [DeviceSettingsPolicy].
 */
object DeviceSettingsProbe {

    private const val TAG = "DeviceSettings"

    /**
     * `Settings.Global.NTP_SERVER` is a hidden constant; the key string is the
     * one `adb shell settings put global ntp_server …` uses and Android's NTP
     * client reads as its server override.
     */
    const val NTP_SERVER_KEY = "ntp_server"

    /** `Settings.Secure.ATTENTIVE_TIMEOUT` is hidden too; this is its key (ms; ≤ 0 = off). */
    const val ATTENTIVE_TIMEOUT_KEY = "attentive_timeout"

    fun capabilities(ctx: Context): Map<DeviceSettingKey, String> {
        val app = ctx.applicationContext
        return DeviceSettingsFacts.capabilities(
            DeviceSettingsFacts.Capability(
                sdk = Build.VERSION.SDK_INT,
                posterClass = safe { LedCanvasHost.isPosterClass(app) } ?: false,
                brightnessProvider = brightnessProvider(app),
                canWriteSettings = SettingsBrightnessProvider.canWrite(app),
                hasSecureSettings = granted(app, Manifest.permission.WRITE_SECURE_SETTINGS),
                hasAudio = audio(app) != null,
                volumeFixed = safe { audio(app)?.isVolumeFixed } ?: false,
                hasWifi = safe { app.packageManager.hasSystemFeature(PackageManager.FEATURE_WIFI) } == true &&
                    wifi(app) != null,
                canChangeWifi = granted(app, Manifest.permission.CHANGE_WIFI_STATE),
                wifiApproval = wifiApproval(app),
            ),
        )
    }

    /**
     * The registry's BRIGHTNESS provider. The registry caches its answer and
     * re-resolves on `MainActivity.onResume`; a WRITE_SETTINGS grant made by
     * the install command while the player stays in front would otherwise be
     * invisible until the next resume. So a cached "software dim" on a unit
     * that CAN now write settings is re-resolved once — it changes nothing on
     * the glass, it re-reads what the box can do.
     */
    private fun brightnessProvider(app: Context): String? = safe {
        var id = DisplayControlRegistry.providerFor(app, Capability.BRIGHTNESS)?.id
        if (id == "software-dim" && SettingsBrightnessProvider.canWrite(app)) {
            DisplayControlRegistry.invalidate()
            id = DisplayControlRegistry.providerFor(app, Capability.BRIGHTNESS)?.id
            PlayerLogger.i(TAG, "WRITE_SETTINGS is now allowed — brightness re-resolved to $id")
        }
        id
    }

    fun observe(ctx: Context): DeviceSettingsFacts.Observation {
        val app = ctx.applicationContext
        val cr = app.contentResolver
        var o = DeviceSettingsFacts.Observation()

        when (safe { DisplayControlRegistry.providerFor(app, Capability.BRIGHTNESS)?.id }) {
            "settings" -> o = o.copy(
                brightnessVia = "settings",
                brightnessRaw = safe { Settings.System.getInt(cr, Settings.System.SCREEN_BRIGHTNESS) },
                brightnessMax = SETTINGS_BRIGHTNESS_MAX,
                brightnessManual = safe {
                    Settings.System.getInt(cr, Settings.System.SCREEN_BRIGHTNESS_MODE) ==
                        Settings.System.SCREEN_BRIGHTNESS_MODE_MANUAL
                },
            )
            "sysfs-backlight" -> o = o.copy(
                brightnessVia = "sysfs-backlight",
                brightnessRaw = safe { SysfsBacklightProvider.currentRaw() },
                // The node's own max: the raw value its provider writes for 100%.
                brightnessMax = safe { SysfsBacklightProvider.targetRaw(100) },
            )
        }

        audio(app)?.let { am ->
            o = o.copy(
                volumeIndex = safe { am.getStreamVolume(AudioManager.STREAM_MUSIC) },
                volumeMax = safe { am.getStreamMaxVolume(AudioManager.STREAM_MUSIC) },
            )
        }

        o = o.copy(
            screenOffTimeoutMs = safe { Settings.System.getInt(cr, Settings.System.SCREEN_OFF_TIMEOUT) }
                ?.takeIf { it > 0 },
            // Unset (SettingNotFound) = the build's own default, reported as unreadable.
            attentiveTimeoutMs = safe { Settings.Secure.getInt(cr, ATTENTIVE_TIMEOUT_KEY) },
            rotationLocked = safe { Settings.System.getInt(cr, Settings.System.ACCELEROMETER_ROTATION) }
                ?.let { if (it == 0) true else if (it == 1) false else null },
            autoTime = safe { Settings.Global.getInt(cr, Settings.Global.AUTO_TIME) }?.let { it == 1 },
            autoTimeZone = safe { Settings.Global.getInt(cr, Settings.Global.AUTO_TIME_ZONE) }?.let { it == 1 },
            // Unset = Android's own server, reported as "".
            ntpServer = safe { Settings.Global.getString(cr, NTP_SERVER_KEY) ?: "" },
        )

        if (Build.VERSION.SDK_INT >= DeviceSettingsFacts.MIN_SDK && wifi(app) != null) {
            o = o.copy(
                wifi = DeviceSettingsWire.WifiObserved(
                    ssid = safe { Api33WifiSuggestions.ourSsid(app) },
                    approval = wifiApproval(app),
                ),
            )
        }
        return o
    }

    /** Android's `SCREEN_BRIGHTNESS` scale (same constant as SettingsBrightnessProvider's). */
    const val SETTINGS_BRIGHTNESS_MAX = 255

    private fun wifiApproval(app: Context): String =
        if (Build.VERSION.SDK_INT >= DeviceSettingsFacts.MIN_SDK) {
            safe { Api33WifiSuggestions.approval(app) } ?: DeviceSettingsFacts.WIFI_UNKNOWN
        } else {
            DeviceSettingsFacts.WIFI_UNKNOWN
        }

    internal fun audio(app: Context): AudioManager? =
        safe { app.getSystemService(Context.AUDIO_SERVICE) as? AudioManager }

    internal fun wifi(app: Context): WifiManager? =
        safe { app.getSystemService(Context.WIFI_SERVICE) as? WifiManager }

    private fun granted(app: Context, permission: String): Boolean =
        safe { app.checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED } ?: false

    private inline fun <T> safe(body: () -> T): T? = try {
        body()
    } catch (t: Throwable) {
        null
    }
}
