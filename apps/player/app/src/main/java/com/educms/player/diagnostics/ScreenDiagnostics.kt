package com.educms.player.diagnostics

import android.content.Context
import android.content.SharedPreferences
import android.os.SystemClock
import com.educms.player.BuildConfig
import com.educms.player.alertwatch.NativeAlertWatchPolicy
import com.educms.player.logging.PlayerLogger
import com.educms.player.security.HostAllowlist
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors
import java.util.concurrent.ThreadFactory

/**
 * SCREEN DIAGNOSTICS on the device (2026-11-08) — the native half of
 * "Run self-test" (#5 + #11) and all of "Get recent logs" (#4), plus the
 * low-frequency storage report (#6).
 *
 * Wired from the native heartbeat in TWO additive lines
 * (`HeartbeatService`): [storageHeaderIfDue] adds the `x-venueos-storage`
 * header at most every 30 minutes, and [accept] reads the reply's
 * `diagnostics: {id, kind, minutes?}`.
 *
 * ONE run at a time, on its own low-priority thread — never the main
 * thread, never the heartbeat's, never the WebView's — so playback and the
 * emergency path are never waited on. An id runs at most once (persisted:
 * `diag_done_id`), and the answer is POSTed for that id: acknowledgement by
 * VALUE. The server is the authority — a forged or stale id earns a 404/410
 * and is marked done.
 *
 * Device credential: READ, never written (player rule 3). Host: only the
 * pinned API root (`HostAllowlist.isApiHost`).
 */
object ScreenDiagnostics {

    private const val TAG = "ScreenDiagnostics"
    private const val KEY_DONE = "diag_done_id"
    private const val KEY_STARTED = "diag_started_id"
    private const val KEY_STARTED_N = "diag_started_n"
    private const val KEY_STORAGE_AT = "diag_storage_report_at"

    private val worker = Executors.newSingleThreadExecutor(ThreadFactory { r ->
        Thread(r, "diag-run").apply { isDaemon = true; priority = Thread.MIN_PRIORITY }
    })
    @Volatile private var running: String? = null

    /** The storage header body when one is due, else null. Cheap, bounded; never throws. */
    fun storageHeaderIfDue(ctx: Context, prefs: SharedPreferences): String? = runCatching {
        val now = System.currentTimeMillis()
        if (!DiagnosticsPolicy.storageReportDue(now, prefs.getLong(KEY_STORAGE_AT, 0L))) return null
        // A 1.5 s ceiling on the write test here: this runs inside the
        // heartbeat's request setup, whose 8 s wake lock it must never eat.
        val s = DiagnosticsProbes.storage(ctx, writeTest = true, timeoutMs = 1_500L) ?: return null
        prefs.edit().putLong(KEY_STORAGE_AT, now).apply()
        DiagnosticsPolicy.storageHeader(s.freeBytes, s.totalBytes, s.writeOk, s.writeMs)
    }.getOrNull()

    /** The heartbeat reply. Silence (no `diagnostics` key) changes nothing. */
    fun accept(ctx: Context, prefs: SharedPreferences, body: JSONObject) {
        val d = body.optJSONObject("diagnostics") ?: return
        val req = DiagnosticsPolicy.parse(
            d.optString("id", ""), d.optString("kind", ""),
            if (d.has("minutes")) d.optInt("minutes", 15) else null,
        ) ?: return
        val started = prefs.getString(KEY_STARTED, null)
        val n = if (started == req.id) prefs.getInt(KEY_STARTED_N, 0) else 0
        if (!DiagnosticsPolicy.shouldRun(req, prefs.getString(KEY_DONE, null), started, n)) return
        synchronized(this) {
            if (running != null) return
            running = req.id
        }
        prefs.edit().putString(KEY_STARTED, req.id).putInt(KEY_STARTED_N, n + 1).apply()
        val app = ctx.applicationContext
        worker.execute {
            try {
                run(app, prefs, req)
            } catch (t: Throwable) {
                PlayerLogger.w(TAG, "PLAYER_DIAGNOSTICS run ${req.id} failed: ${DiagnosticsPolicy.errorCode(t)}")
            } finally {
                synchronized(this) { running = null }
            }
        }
    }

    private fun run(ctx: Context, prefs: SharedPreferences, req: DiagnosticsPolicy.Request) {
        val apiRoot = prefs.getString("api_root", null)?.trim()
        val token = prefs.getString("device_token", null)?.trim()
        val screenId = NativeAlertWatchPolicy.screenIdOf(token)
        if (apiRoot.isNullOrBlank() || !HostAllowlist.isApiHost(apiRoot) || token.isNullOrBlank() || screenId == null) {
            PlayerLogger.w(TAG, "PLAYER_DIAGNOSTICS ${req.id} skipped — no allowed API root or device credential")
            return
        }
        PlayerLogger.i(TAG, "PLAYER_DIAGNOSTICS start id=${req.id} kind=${req.kind}")
        val base = "${apiRoot.trimEnd('/')}/api/v1/screens/$screenId/diagnostics/${req.id}"
        val code = when (req.kind) {
            DiagnosticsPolicy.Kind.SELF_TEST -> post("$base/native", token, selfTest(ctx, apiRoot).toString(), null)
            DiagnosticsPolicy.Kind.LOGS -> uploadLogs(ctx, base, token, req)
        }
        // 2xx = answered; 404/409/410 = the server will never take it — both are done.
        if (code in 200..299 || code == 404 || code == 409 || code == 410) {
            prefs.edit().putString(KEY_DONE, req.id).apply()
        }
        PlayerLogger.i(TAG, "PLAYER_DIAGNOSTICS done id=${req.id} kind=${req.kind} http=$code")
    }

    fun selfTest(ctx: Context, apiRoot: String): JSONObject {
        val t0 = SystemClock.elapsedRealtime()
        val out = JSONObject().put("schema", 1)
        out.put("app", JSONObject().put("versionName", BuildConfig.VERSION_NAME).put("versionCode", BuildConfig.VERSION_CODE))
        DiagnosticsProbes.storage(ctx)?.let { s ->
            out.put("storage", JSONObject().put("freeBytes", s.freeBytes).put("totalBytes", s.totalBytes)
                .apply { s.writeOk?.let { put("writeOk", it) }; s.writeMs?.let { put("writeMs", it) } })
        }
        val (api, tls) = DiagnosticsProbes.apiAndTls(apiRoot)
        out.put("clock", api.optJSONObject("clock") ?: JSONObject())
        api.remove("clock")
        out.put("api", api).put("tls", tls)
        out.put("dns", DiagnosticsProbes.dns(apiRoot))
        out.put("net", DiagnosticsProbes.network(ctx))
        out.put("webview", DiagnosticsProbes.webview(ctx))
        out.put("durationMs", SystemClock.elapsedRealtime() - t0)
        return out
    }

    private fun uploadLogs(ctx: Context, base: String, token: String, req: DiagnosticsPolicy.Request): Int {
        val ticketReply = StringBuilder()
        val tCode = post("$base/upload-ticket", token, "{}", null, ticketReply)
        if (tCode !in 200..299) return tCode
        val ticket = runCatching { JSONObject(ticketReply.toString()).optString("ticket", "") }.getOrDefault("")
        if (ticket.isEmpty()) return -1
        val bundle = runCatching { LogCollector.collect(ctx, req.minutes) }.getOrNull()
        if (bundle == null) {
            return post("$base/native", token, JSONObject().put("kind", "LOGS").put("error", "collect-failed").toString(), null)
        }
        val body = JSONObject()
            .put("player", bundle.player)
            .put("manager", bundle.manager)
            .put("managerStatus", bundle.managerStatus)
            .put("minutes", req.minutes)
        return post("$base/logs", token, body.toString(), ticket)
    }

    /** POST JSON with the device credential; bounded across the body read. Returns the HTTP code, -1 on a network failure. */
    private fun post(url: String, token: String, json: String, ticket: String?, reply: StringBuilder? = null): Int = try {
        val conn = URL(url).openConnection() as HttpURLConnection
        try {
            conn.connectTimeout = 8_000
            conn.readTimeout = 15_000
            conn.instanceFollowRedirects = false
            conn.requestMethod = "POST"
            conn.doOutput = true
            conn.setRequestProperty("Content-Type", "application/json; charset=utf-8")
            conn.setRequestProperty("Authorization", "Bearer $token")
            if (ticket != null) conn.setRequestProperty("x-diagnostics-ticket", ticket)
            conn.outputStream.use { it.write(json.toByteArray(Charsets.UTF_8)) }
            val code = conn.responseCode
            if (reply != null && code in 200..299) {
                conn.inputStream.bufferedReader().use { r ->
                    val buf = CharArray(1024)
                    while (reply.length < 4096) { val n = r.read(buf); if (n < 0) break; reply.append(buf, 0, n) }
                }
            }
            code
        } finally {
            conn.disconnect()
        }
    } catch (t: Throwable) {
        PlayerLogger.w(TAG, "PLAYER_DIAGNOSTICS post failed: ${DiagnosticsPolicy.errorCode(t)}")
        -1
    }
}
