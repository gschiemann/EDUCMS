package com.educms.player.settings

import android.content.Context
import android.net.wifi.WifiManager
import android.net.wifi.WifiNetworkSuggestion
import android.os.Build
import androidx.annotation.RequiresApi
import com.educms.player.logging.PlayerLogger

/**
 * Wi-Fi network SUGGESTIONS, the one Wi-Fi path open to a normal app
 * (2026-10-18). Every symbol here is API 29–33, so it lives in its own
 * object that is only loaded on Android 13+ — the class-load `VerifyError`
 * this codebase has paid for twice (see `Api31SilentInstall`).
 *
 * WHAT A SUGGESTION IS — and is not:
 *   • Android joins it when it is in range and judges it the better network;
 *     it never replaces a network the user saved, and it never turns Wi-Fi on.
 *   • The FIRST suggestion from VenueOS needs one approval on the glass
 *     (Android's own prompt); later ones from the same app do not.
 *   • Android keeps it across reboots; it is removed when VenueOS is
 *     uninstalled.
 *
 * ONE network per unit. A new one is ADDED FIRST and only then are VenueOS's
 * other suggestions removed (with LINGER, so a connection on the old one is
 * not dropped mid-flight) — a failed add therefore leaves the unit exactly as
 * it was, never without the network it reached the server on.
 *
 * ⚠️ The passphrase is used here and nowhere else, and never logged.
 */
@RequiresApi(Build.VERSION_CODES.TIRAMISU)
internal object Api33WifiSuggestions {

    private const val TAG = "DeviceSettings"

    @Volatile private var approval: String? = null
    @Volatile private var watching = false

    private fun manager(ctx: Context): WifiManager? =
        ctx.applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager

    /** The SSID of VenueOS's current suggestion, or null when there is none. */
    fun ourSsid(ctx: Context): String? = manager(ctx)?.networkSuggestions?.firstOrNull()?.ssid

    /**
     * Android's approval of VenueOS's suggestions. Read through the API 31+
     * listener, which reports the current status as soon as it is registered;
     * registered once per process and kept, so the heartbeat reads a field.
     */
    fun approval(ctx: Context): String {
        ensureWatching(ctx)
        return approval ?: DeviceSettingsFacts.WIFI_UNKNOWN
    }

    private fun ensureWatching(ctx: Context) {
        if (watching) return
        synchronized(this) {
            if (watching) return
            val wm = manager(ctx) ?: return
            runCatching {
                wm.addSuggestionUserApprovalStatusListener(ctx.applicationContext.mainExecutor) { status ->
                    approval = when (status) {
                        WifiManager.STATUS_SUGGESTION_APPROVAL_APPROVED_BY_USER,
                        WifiManager.STATUS_SUGGESTION_APPROVAL_APPROVED_BY_CARRIER_PRIVILEGE,
                        -> DeviceSettingsFacts.WIFI_APPROVED
                        WifiManager.STATUS_SUGGESTION_APPROVAL_PENDING -> DeviceSettingsFacts.WIFI_PENDING
                        WifiManager.STATUS_SUGGESTION_APPROVAL_REJECTED_BY_USER -> DeviceSettingsFacts.WIFI_REJECTED
                        else -> DeviceSettingsFacts.WIFI_UNKNOWN
                    }
                }
                watching = true
            }.onFailure { PlayerLogger.w(TAG, "wifi approval listener unavailable: ${it.message}") }
        }
    }

    fun replace(ctx: Context, value: DesiredValue.WifiValue): DeviceSettingsPolicy.Outcome {
        val wm = manager(ctx) ?: return DeviceSettingsPolicy.Outcome.Error(DeviceSettingCodes.WIFI_ERROR)
        val builder = WifiNetworkSuggestion.Builder()
            .setSsid(value.ssid)
            .setIsHiddenSsid(value.hidden)
        val passphrase = value.passphrase
        when (value.security) {
            "wpa2" -> builder.setWpa2Passphrase(passphrase ?: return needsSecret())
            "wpa3" -> builder.setWpa3Passphrase(passphrase ?: return needsSecret())
            "open" -> Unit
            else -> return DeviceSettingsPolicy.Outcome.Error(DeviceSettingCodes.INVALID_VALUE)
        }
        val suggestion = try {
            builder.build()
        } catch (e: IllegalArgumentException) {
            return DeviceSettingsPolicy.Outcome.Error(DeviceSettingCodes.WIFI_INVALID)
        }
        val status = wm.addNetworkSuggestions(listOf(suggestion))
        val outcome = when (status) {
            WifiManager.STATUS_NETWORK_SUGGESTIONS_SUCCESS,
            WifiManager.STATUS_NETWORK_SUGGESTIONS_ERROR_ADD_DUPLICATE,
            -> DeviceSettingsPolicy.Outcome.Done
            WifiManager.STATUS_NETWORK_SUGGESTIONS_ERROR_APP_DISALLOWED ->
                DeviceSettingsPolicy.Outcome.Error(DeviceSettingCodes.WIFI_REJECTED)
            WifiManager.STATUS_NETWORK_SUGGESTIONS_ERROR_ADD_EXCEEDS_MAX_PER_APP ->
                DeviceSettingsPolicy.Outcome.Error(DeviceSettingCodes.WIFI_LIMIT)
            WifiManager.STATUS_NETWORK_SUGGESTIONS_ERROR_ADD_INVALID ->
                DeviceSettingsPolicy.Outcome.Error(DeviceSettingCodes.WIFI_INVALID)
            WifiManager.STATUS_NETWORK_SUGGESTIONS_ERROR_ADD_NOT_ALLOWED,
            WifiManager.STATUS_NETWORK_SUGGESTIONS_ERROR_RESTRICTED_BY_ADMIN,
            -> DeviceSettingsPolicy.Outcome.Error(DeviceSettingCodes.WIFI_RESTRICTED)
            else -> DeviceSettingsPolicy.Outcome.Error(DeviceSettingCodes.WIFI_ERROR)
        }
        if (outcome == DeviceSettingsPolicy.Outcome.Done) {
            // Only now: the new network is in place, so the old ones may go.
            runCatching {
                val others = wm.networkSuggestions.filter { it != suggestion }
                if (others.isNotEmpty()) {
                    wm.removeNetworkSuggestions(others, WifiManager.ACTION_REMOVE_SUGGESTION_LINGER)
                }
            }.onFailure { PlayerLogger.w(TAG, "older wifi suggestions not removed: ${it.message}") }
        }
        PlayerLogger.i(TAG, "wifi suggestion (${value.security}${if (value.hidden) ", hidden" else ""}) → status $status")
        return outcome
    }

    private fun needsSecret() = DeviceSettingsPolicy.Outcome.Error(DeviceSettingCodes.NEEDS_SECRET)
}
