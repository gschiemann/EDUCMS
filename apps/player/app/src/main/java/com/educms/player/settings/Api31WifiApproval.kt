package com.educms.player.settings

import android.content.Context
import android.net.wifi.WifiManager
import android.os.Build
import androidx.annotation.RequiresApi
import com.educms.player.logging.PlayerLogger

/**
 * Android's approval of VenueOS's network suggestions, read through the
 * Android 12 (API 31) listener — which reports the current status as soon as
 * it is registered. Registered once per process and kept, so the heartbeat
 * reads a field. Its own object so the API-31 symbols are only ever loaded
 * on Android 12+ (the `VerifyError` trap — see `Api31SilentInstall`).
 *
 * Moved here unchanged from `Api33WifiSuggestions` (2026-10-23) so Android 12
 * reads it too.
 */
@RequiresApi(Build.VERSION_CODES.S)
internal object Api31WifiApproval {

    private const val TAG = "DeviceSettings"

    @Volatile private var approval: String? = null
    @Volatile private var watching = false

    fun approval(ctx: Context): String {
        ensureWatching(ctx)
        return approval ?: DeviceSettingsFacts.WIFI_UNKNOWN
    }

    private fun ensureWatching(ctx: Context) {
        if (watching) return
        synchronized(this) {
            if (watching) return
            val wm = ctx.applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager ?: return
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
}
