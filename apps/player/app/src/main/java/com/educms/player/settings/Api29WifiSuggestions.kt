package com.educms.player.settings

import android.content.Context
import android.net.wifi.WifiManager
import android.net.wifi.WifiNetworkSuggestion
import android.os.Build
import androidx.annotation.RequiresApi
import com.educms.player.logging.PlayerLogger

/**
 * Wi-Fi network SUGGESTIONS on Android 10, 11 and 12 (API 29–32), and the
 * suggestion builder every Android 10+ path shares (2026-10-23). API-29
 * symbols only, in their own object, loaded only on Android 10+ — the same
 * class-load discipline as [Api33WifiSuggestions] and `Api31SilentInstall`.
 * The few API-30 calls below are guarded by `SDK_INT` at the call.
 *
 * Differences from Android 13+ that change what VenueOS may do:
 *   • no LINGER removal: removing a suggestion the screen is connected
 *     through drops the connection at once, and Android does not let an app
 *     see which network it is on — so VenueOS's OLDER suggestions are removed
 *     only while Wi-Fi is not carrying the screen's traffic at all
 *     ([WifiSetupPolicy.mayRemoveOlderSuggestions]); until then they stay;
 *   • Android 10 has no list of an app's own suggestions (so nothing is ever
 *     removed there), and Android 10 and 11 never say whether someone allowed
 *     them ([WifiSetupPolicy.suggestionLanded]).
 *
 * ⚠️ The passphrase is used in [build] and nowhere else, and never logged.
 */
@RequiresApi(Build.VERSION_CODES.Q)
internal object Api29WifiSuggestions {

    private const val TAG = "DeviceSettings"

    sealed class Added {
        object Accepted : Added()
        data class Refused(val code: String) : Added()
    }

    private fun manager(ctx: Context): WifiManager? =
        ctx.applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager

    /** The suggestion for [value]; a code instead when it cannot be built. */
    fun build(value: DesiredValue.WifiValue): Pair<WifiNetworkSuggestion?, String?> {
        val builder = WifiNetworkSuggestion.Builder()
            .setSsid(value.ssid)
            .setIsHiddenSsid(value.hidden)
        val passphrase = value.passphrase
        when (value.security) {
            "wpa2" -> builder.setWpa2Passphrase(passphrase ?: return null to DeviceSettingCodes.NEEDS_SECRET)
            "wpa3" -> builder.setWpa3Passphrase(passphrase ?: return null to DeviceSettingCodes.NEEDS_SECRET)
            "open" -> Unit
            else -> return null to DeviceSettingCodes.INVALID_VALUE
        }
        return try {
            builder.build() to null
        } catch (e: IllegalArgumentException) {
            null to DeviceSettingCodes.WIFI_INVALID
        }
    }

    /** Android 10–12: add first; remove VenueOS's older ones only where that cannot drop the screen. */
    fun add(ctx: Context, value: DesiredValue.WifiValue, defaultIsWifi: Boolean?): Added {
        val wm = manager(ctx) ?: return Added.Refused(DeviceSettingCodes.WIFI_ERROR)
        val (suggestion, problem) = build(value)
        if (suggestion == null) return Added.Refused(problem ?: DeviceSettingCodes.WIFI_ERROR)
        val status = wm.addNetworkSuggestions(listOf(suggestion))
        val refusal = WifiSetupPolicy.suggestionRefusal(status)
        PlayerLogger.i(TAG, "wifi suggestion (${value.security}${if (value.hidden) ", hidden" else ""}) → status $status")
        if (refusal != null) return Added.Refused(refusal)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R &&
            WifiSetupPolicy.mayRemoveOlderSuggestions(Build.VERSION.SDK_INT, defaultIsWifi)
        ) {
            runCatching {
                val others = wm.networkSuggestions.filter { it != suggestion }
                if (others.isNotEmpty()) wm.removeNetworkSuggestions(others)
            }.onFailure { PlayerLogger.w(TAG, "older wifi suggestions not removed: ${it.message}") }
        }
        return Added.Accepted
    }

    /** The SSID of VenueOS's suggestion (Android 11+ only), or null. */
    fun ourSsid(ctx: Context): String? =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            runCatching { manager(ctx)?.networkSuggestions?.lastOrNull()?.ssid }.getOrNull()
        } else {
            null
        }

    /** Android reports WPA3-Personal (SAE) support on this hardware. */
    fun wpa3Supported(ctx: Context): Boolean = runCatching { manager(ctx)?.isWpa3SaeSupported }.getOrNull() == true
}
