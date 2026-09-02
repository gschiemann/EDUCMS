package com.educms.player.boot

import com.educms.player.BuildConfig
import com.educms.player.logging.PlayerLogger
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/**
 * Ship one boot diagnostic to the fleet (2026-09-02, P0-2).
 *
 * Endpoint: `POST /api/v1/screens/status/:deviceFingerprint/boot-diagnostic`,
 * modelled on the existing anonymous `crash-report` sibling and anonymous
 * for the same reason: a screen that never registered has NO device
 * credential to authenticate with, and requiring one would take the
 * diagnostic dark in exactly the case it exists for.
 *
 * ⚠️ CALLED AT MOST ONCE PER 30 MINUTES PER PROCESS (see
 * [BootDiagnostics.REPORT_COOLDOWN_MS]) — a screen wedged in a boot loop
 * must not become a write storm against the fleet's Screen rows.
 *
 * Never throws, blocks for at most ~12 s, and is called only from
 * BootDiagnostics' worker thread.
 */
internal object BootDiagnosticsReporter {

    private const val TAG = "BootDiagnostics"

    fun post(apiRoot: String, fingerprint: String, reason: String, detail: JSONObject) {
        if (fingerprint.startsWith("preview-")) return
        var conn: HttpURLConnection? = null
        try {
            val body = JSONObject().apply {
                put("reason", reason)
                put("versionName", BuildConfig.VERSION_NAME)
                put("versionCode", BuildConfig.VERSION_CODE)
                put("detail", detail)
            }.toString()
            val url = URL("$apiRoot/api/v1/screens/status/$fingerprint/boot-diagnostic")
            conn = (url.openConnection() as HttpURLConnection).apply {
                requestMethod = "POST"
                setRequestProperty("Content-Type", "application/json")
                doOutput = true
                connectTimeout = 6_000
                readTimeout = 6_000
            }
            conn.outputStream.use { it.write(body.toByteArray()) }
            val rc = conn.responseCode
            if (rc in 200..299) {
                PlayerLogger.i(TAG, "boot diagnostic reported to the fleet (reason=$reason)")
            } else {
                // A 404 here is the EXPECTED shape on a deploy whose API
                // predates this endpoint. Warn, never retry: the card on the
                // glass is the primary artefact, the fleet row is a bonus.
                PlayerLogger.w(TAG, "boot diagnostic report returned HTTP $rc")
            }
        } catch (t: Throwable) {
            PlayerLogger.w(TAG, "boot diagnostic report failed: ${t.javaClass.simpleName}")
        } finally {
            try { conn?.disconnect() } catch (_: Throwable) { /* diagnostics only */ }
        }
    }
}
