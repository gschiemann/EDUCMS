package com.educms.player.settings

import android.content.Context
import android.net.wifi.WifiManager
import android.os.Build
import androidx.annotation.RequiresApi
import com.educms.player.logging.PlayerLogger

/**
 * Wi-Fi network SUGGESTIONS on Android 13+ (2026-10-18). Every symbol here
 * that is newer than Android 10 is API 33, so it lives in its own object that
 * is only loaded on Android 13+ — the class-load `VerifyError` this codebase
 * has paid for twice (see `Api31SilentInstall`).
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
 * 2026-10-23: the suggestion itself is built by [Api29WifiSuggestions.build]
 * (shared with Android 10–12) and the approval is read by [Api31WifiApproval]
 * (shared with Android 12); what an accepted suggestion MEANS is
 * [WifiSetupPolicy.suggestionLanded]. The add-first-then-LINGER-remove path
 * is unchanged.
 *
 * ⚠️ The passphrase is used in the builder and nowhere else, and never logged.
 */
@RequiresApi(Build.VERSION_CODES.TIRAMISU)
internal object Api33WifiSuggestions {

    private const val TAG = "DeviceSettings"

    private fun manager(ctx: Context): WifiManager? =
        ctx.applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager

    /** The SSID of VenueOS's current suggestion, or null when there is none. */
    fun ourSsid(ctx: Context): String? = manager(ctx)?.networkSuggestions?.firstOrNull()?.ssid

    /** Android's approval of VenueOS's suggestions. */
    fun approval(ctx: Context): String = Api31WifiApproval.approval(ctx)

    fun replace(ctx: Context, value: DesiredValue.WifiValue): Api29WifiSuggestions.Added {
        val wm = manager(ctx) ?: return Api29WifiSuggestions.Added.Refused(DeviceSettingCodes.WIFI_ERROR)
        val (suggestion, problem) = Api29WifiSuggestions.build(value)
        if (suggestion == null) return Api29WifiSuggestions.Added.Refused(problem ?: DeviceSettingCodes.WIFI_ERROR)
        val status = wm.addNetworkSuggestions(listOf(suggestion))
        val refusal = WifiSetupPolicy.suggestionRefusal(status)
        if (refusal == null) {
            // Only now: the new network is in place, so the old ones may go.
            runCatching {
                val others = wm.networkSuggestions.filter { it != suggestion }
                if (others.isNotEmpty()) {
                    wm.removeNetworkSuggestions(others, WifiManager.ACTION_REMOVE_SUGGESTION_LINGER)
                }
            }.onFailure { PlayerLogger.w(TAG, "older wifi suggestions not removed: ${it.message}") }
        }
        PlayerLogger.i(TAG, "wifi suggestion (${value.security}${if (value.hidden) ", hidden" else ""}) → status $status")
        return if (refusal == null) Api29WifiSuggestions.Added.Accepted else Api29WifiSuggestions.Added.Refused(refusal)
    }
}
