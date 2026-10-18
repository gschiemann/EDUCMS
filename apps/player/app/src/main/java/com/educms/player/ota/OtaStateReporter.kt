package com.educms.player.ota

import android.content.Context
import com.educms.player.logging.PlayerLogger
import com.educms.player.security.HostAllowlist
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/**
 * POST /api/v1/screens/status/:fp/ota-state — one place for every OTA report
 * the Player makes (the worker, the install receiver, the Manager hand-off
 * answer).
 *
 * 2026-10-17 — now carries the device token. While a pending push waits for a
 * tap (`NEEDS_TAP`), the server ignores ANONYMOUS CHECKING / UP_TO_DATE reports
 * — the companion Manager 1.0.24 still sends both every 30 minutes and would
 * otherwise tell the dashboard a screen that is behind is current — so the
 * Player's own reports must prove they are the Player's. Absent token →
 * header omitted → exactly the report this route always took.
 *
 * Best-effort and blocking: call it off the main thread. Never throws.
 */
object OtaStateReporter {
    private const val TAG = "OtaStateReporter"

    fun report(
        ctx: Context,
        state: String,
        progress: Int? = null,
        message: String? = null,
        apiRootOverride: String? = null,
        fingerprintOverride: String? = null,
    ) {
        try {
            val prefs = ctx.getSharedPreferences("edu_player", Context.MODE_PRIVATE)
            val apiRoot = apiRootOverride ?: prefs.getString("api_root", null) ?: return
            // AND-001: never send telemetry (or the token) to a host we would
            // not take an APK from.
            if (!HostAllowlist.isAllowed(apiRoot)) return
            val fp = fingerprintOverride ?: prefs.getString("device_fingerprint", null) ?: return
            val payload = JSONObject().apply {
                put("state", state)
                if (progress != null) put("progress", progress)
                if (message != null) put("message", message.take(400))
            }
            val conn = (URL("$apiRoot/api/v1/screens/status/$fp/ota-state").openConnection() as HttpURLConnection).apply {
                requestMethod = "POST"
                setRequestProperty("Content-Type", "application/json")
                doOutput = true
                connectTimeout = 5_000
                readTimeout = 5_000
            }
            prefs.getString("device_token", null)?.trim()?.takeIf { it.isNotEmpty() }?.let {
                conn.setRequestProperty("Authorization", "Bearer $it")
            }
            try {
                conn.outputStream.use { it.write(payload.toString().toByteArray()) }
                val rc = conn.responseCode
                if (rc !in 200..299) {
                    PlayerLogger.w(TAG, "OTA state report HTTP $rc (state=$state)")
                } else {
                    PlayerLogger.i(TAG, "OTA state report → $state${progress?.let { " ($it%)" } ?: ""}")
                }
            } finally {
                conn.disconnect()
            }
        } catch (t: Throwable) {
            PlayerLogger.w(TAG, "OTA state report failed (state=$state): ${t.message}")
        }
    }
}
