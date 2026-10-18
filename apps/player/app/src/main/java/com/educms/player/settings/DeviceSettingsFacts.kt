package com.educms.player.settings

import com.educms.player.display.DisplayLimits
import kotlin.math.abs

/**
 * The pure half of the probe (2026-10-18): what this unit CAN set, and
 * whether what Android reads back IS the desired value. Every input is a
 * plain fact read by [DeviceSettingsProbe]; nothing here touches Android, so
 * `DeviceSettingsFactsTest` pins each verdict on a JVM.
 */
object DeviceSettingsFacts {

    /** Android 13. The feature is qualified on 13+ only; older units report `api-level`. */
    const val MIN_SDK = 33

    /** The brightness mechanisms whose level this unit can READ BACK. */
    val READABLE_BRIGHTNESS = setOf("settings", "sysfs-backlight")

    /** The raw facts behind the capability verdicts. */
    data class Capability(
        val sdk: Int,
        /** NovaStar TB / Taurus LED poster — its brightness is not Android's. */
        val posterClass: Boolean,
        /** `DisplayControlRegistry`'s resolved BRIGHTNESS provider id, or null. */
        val brightnessProvider: String?,
        /** The WRITE_SETTINGS app-op ("Modify system settings"). */
        val canWriteSettings: Boolean,
        /** WRITE_SECURE_SETTINGS, granted only by the install command. */
        val hasSecureSettings: Boolean,
        val hasAudio: Boolean,
        val volumeFixed: Boolean,
        val hasWifi: Boolean,
        val canChangeWifi: Boolean,
        /** `approved` | `pending` | `rejected` | `unknown`. */
        val wifiApproval: String,
    )

    fun capabilities(f: Capability): Map<DeviceSettingKey, String> {
        if (f.sdk < MIN_SDK) return DeviceSettingKey.values().associateWith { DeviceSettingCodes.API_LEVEL }
        val writeSettings = if (f.canWriteSettings) DeviceSettingCodes.OK else DeviceSettingCodes.NO_WRITE_SETTINGS
        val secure = if (f.hasSecureSettings) DeviceSettingCodes.OK else DeviceSettingCodes.NO_SECURE_SETTINGS
        return linkedMapOf(
            DeviceSettingKey.BRIGHTNESS to brightness(f),
            DeviceSettingKey.VOLUME to when {
                !f.hasAudio -> DeviceSettingCodes.UNSUPPORTED
                f.volumeFixed -> DeviceSettingCodes.VOLUME_FIXED
                else -> DeviceSettingCodes.OK
            },
            DeviceSettingKey.SCREEN_OFF_TIMEOUT to writeSettings,
            DeviceSettingKey.ROTATION_LOCK to writeSettings,
            DeviceSettingKey.AUTO_TIME to secure,
            DeviceSettingKey.AUTO_TIME_ZONE to secure,
            DeviceSettingKey.NTP_SERVER to secure,
            DeviceSettingKey.WIFI to when {
                !f.hasWifi -> DeviceSettingCodes.NO_WIFI
                !f.canChangeWifi -> DeviceSettingCodes.UNSUPPORTED
                f.wifiApproval == WIFI_REJECTED -> DeviceSettingCodes.WIFI_DISALLOWED
                else -> DeviceSettingCodes.OK
            },
        )
    }

    /**
     * Brightness is offered only through a mechanism whose level Android lets
     * us read back — the Android setting itself or a writable backlight node
     * — because a stored setting is reported by what is READ, never by what
     * was sent. The software dimmer and the vendor mechanisms stay with the
     * live Brightness slider.
     */
    private fun brightness(f: Capability): String = when {
        f.posterClass -> DeviceSettingCodes.VENDOR_BRIGHTNESS
        f.brightnessProvider in READABLE_BRIGHTNESS -> DeviceSettingCodes.OK
        f.brightnessProvider == null || f.brightnessProvider == "software-dim" ->
            if (f.canWriteSettings) DeviceSettingCodes.PICTURE_ONLY else DeviceSettingCodes.NO_WRITE_SETTINGS
        else -> DeviceSettingCodes.VENDOR_BRIGHTNESS
    }

    const val WIFI_APPROVED = "approved"
    const val WIFI_PENDING = "pending"
    const val WIFI_REJECTED = "rejected"
    const val WIFI_UNKNOWN = "unknown"

    /** What Android reads back right now. null = it will not say. */
    data class Observation(
        /** Which mechanism the brightness below was read through (`settings` | `sysfs-backlight`). */
        val brightnessVia: String? = null,
        val brightnessRaw: Int? = null,
        val brightnessMax: Int? = null,
        /** `SCREEN_BRIGHTNESS_MODE` is manual (adaptive brightness off). Settings mechanism only. */
        val brightnessManual: Boolean? = null,
        val volumeIndex: Int? = null,
        val volumeMax: Int? = null,
        val screenOffTimeoutMs: Int? = null,
        val rotationLocked: Boolean? = null,
        val autoTime: Boolean? = null,
        val autoTimeZone: Boolean? = null,
        /** `""` = no override (Android's own server). */
        val ntpServer: String? = null,
        val wifi: DeviceSettingsWire.WifiObserved? = null,
    )

    /** The perceptual brightness raw value our providers write for [percent]. */
    fun expectedBrightnessRaw(percent: Int, max: Int): Int =
        DisplayLimits.scaleBrightnessPerceptual(percent, 0, max).coerceAtLeast(1)

    /** The inverse of the perceptual map — a raw value as the slider percent it corresponds to. */
    fun percentFromRaw(raw: Int, max: Int): Int {
        if (max <= 0) return 0
        val r = raw.coerceIn(0, max).toDouble() / max
        return Math.round(100.0 * Math.pow(r, 1.0 / DisplayLimits.BRIGHTNESS_GAMMA)).toInt().coerceIn(0, 100)
    }

    fun expectedVolumeIndex(percent: Int, max: Int): Int = DisplayLimits.scale(percent, 0, max)

    fun volumePercent(index: Int, max: Int): Int =
        if (max <= 0) 0 else Math.round(index.coerceIn(0, max) * 100f / max).coerceIn(0, 100)

    /**
     * Does Android read back exactly [item]'s value? null = it cannot tell
     * (no read-back for this mechanism, or Wi-Fi — a passphrase is never
     * readable).
     */
    fun matches(item: DesiredItem, o: Observation): Boolean? {
        val v = item.value
        return when (item.key) {
            DeviceSettingKey.BRIGHTNESS -> {
                val p = (v as? DesiredValue.IntValue)?.value ?: return null
                val raw = o.brightnessRaw ?: return null
                val max = o.brightnessMax?.takeIf { it > 0 } ?: return null
                // ±1: a scale the panel itself rounds still counts as in place.
                val levelOk = abs(raw - expectedBrightnessRaw(p, max)) <= 1
                // An adaptive-brightness ROM would move the value on its own.
                levelOk && (o.brightnessVia != "settings" || o.brightnessManual == true)
            }
            DeviceSettingKey.VOLUME -> {
                val p = (v as? DesiredValue.IntValue)?.value ?: return null
                val index = o.volumeIndex ?: return null
                val max = o.volumeMax?.takeIf { it > 0 } ?: return null
                index == expectedVolumeIndex(p, max)
            }
            DeviceSettingKey.SCREEN_OFF_TIMEOUT ->
                o.screenOffTimeoutMs?.let { it == (v as? DesiredValue.IntValue)?.value }
            DeviceSettingKey.ROTATION_LOCK ->
                o.rotationLocked?.let { it == (v as? DesiredValue.BoolValue)?.value }
            DeviceSettingKey.AUTO_TIME ->
                o.autoTime?.let { it == (v as? DesiredValue.BoolValue)?.value }
            DeviceSettingKey.AUTO_TIME_ZONE ->
                o.autoTimeZone?.let { it == (v as? DesiredValue.BoolValue)?.value }
            DeviceSettingKey.NTP_SERVER ->
                o.ntpServer?.let { it.equals((v as? DesiredValue.TextValue)?.value ?: return null, ignoreCase = true) }
            DeviceSettingKey.WIFI -> null
        }
    }

    /** The observed values as the report carries them (percent for levels). */
    fun forReport(o: Observation): Map<DeviceSettingKey, Any> {
        val out = linkedMapOf<DeviceSettingKey, Any>()
        val bMax = o.brightnessMax
        if (o.brightnessRaw != null && bMax != null && bMax > 0) {
            out[DeviceSettingKey.BRIGHTNESS] = percentFromRaw(o.brightnessRaw, bMax)
        }
        val vMax = o.volumeMax
        if (o.volumeIndex != null && vMax != null && vMax > 0) {
            out[DeviceSettingKey.VOLUME] = volumePercent(o.volumeIndex, vMax)
        }
        o.screenOffTimeoutMs?.let { out[DeviceSettingKey.SCREEN_OFF_TIMEOUT] = it }
        o.rotationLocked?.let { out[DeviceSettingKey.ROTATION_LOCK] = it }
        o.autoTime?.let { out[DeviceSettingKey.AUTO_TIME] = it }
        o.autoTimeZone?.let { out[DeviceSettingKey.AUTO_TIME_ZONE] = it }
        o.ntpServer?.let { out[DeviceSettingKey.NTP_SERVER] = it.take(253) }
        o.wifi?.let { out[DeviceSettingKey.WIFI] = it }
        return out
    }
}
