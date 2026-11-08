package com.educms.manager.health

import android.content.Context
import android.util.Log
import com.educms.manager.BuildConfig
import com.educms.manager.PlayerHealthProvider
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/**
 * Where a Manager report goes (2026-11-08): the Player's signed relay when it
 * is there and says so, otherwise the anonymous post 1.0.24 makes. See
 * [ManagerReportOutbox] for the rule and the failure direction.
 */
object ManagerReports {
    private const val TAG = "ManagerReports"
    private const val PREFS = "edu_manager_outbox"
    private const val KEY = "entries"
    private val lock = Any()

    private fun prefs(ctx: Context) = ctx.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun pending(ctx: Context): List<ManagerReportOutbox.Entry> =
        synchronized(lock) { ManagerReportOutbox.decode(prefs(ctx).getString(KEY, null)) }

    /** Provider DELETE: the Player acknowledged everything up to [ackedId]. Returns how many were removed. */
    fun ack(ctx: Context, ackedId: Long): Int = synchronized(lock) {
        val before = ManagerReportOutbox.decode(prefs(ctx).getString(KEY, null))
        val after = ManagerReportOutbox.ack(before, ackedId)
        prefs(ctx).edit().putString(KEY, ManagerReportOutbox.encode(after)).apply()
        before.size - after.size
    }

    /**
     * Queue for the Player when the route says so. `commit()` (synchronous) on
     * purpose: the crash handler calls this from a dying process.
     * Returns true when queued; false means the caller posts anonymously.
     */
    fun offerToPlayer(ctx: Context, kind: String, body: JSONObject): Boolean {
        return try {
            val (hbAt, relay) = PlayerHealthProvider.readRelayState(ctx)
            if (ManagerReportOutbox.route(System.currentTimeMillis(), hbAt, relay) != ManagerReportOutbox.Route.OUTBOX) {
                return false
            }
            synchronized(lock) {
                val prior = ManagerReportOutbox.decode(prefs(ctx).getString(KEY, null))
                val next = ManagerReportOutbox.enqueue(prior, kind, body.toString(), System.currentTimeMillis())
                prefs(ctx).edit().putString(KEY, ManagerReportOutbox.encode(next)).commit()
            }
        } catch (e: Exception) {
            Log.w(TAG, "outbox write failed (${e.message}) — posting anonymously")
            false
        }
    }

    /**
     * One `ota-state` report from the Manager: relayed by the Player when it
     * can, otherwise the anonymous POST exactly as before. Blocking — call off
     * the main thread (every existing caller already is).
     */
    fun otaState(ctx: Context, fp: String, state: String, message: String?, progress: Int? = null) {
        val body = JSONObject().apply {
            put("state", state)
            if (progress != null) put("progress", progress)
            if (message != null) put("message", message)
        }
        if (offerToPlayer(ctx, ManagerReportOutbox.KIND_OTA_STATE, body)) {
            Log.i(TAG, "ota-state $state queued for the Player's signed relay")
            return
        }
        postAnonymously(fp, ManagerReportOutbox.KIND_OTA_STATE, body, timeoutMs = 5_000)
    }

    fun postAnonymously(fp: String, kind: String, body: JSONObject, timeoutMs: Int) {
        if (fp.isBlank() || fp == "android-") return
        try {
            val url = URL("${BuildConfig.API_ROOT}/api/v1/screens/status/$fp/$kind")
            val conn = (url.openConnection() as HttpURLConnection).apply {
                requestMethod = "POST"
                setRequestProperty("Content-Type", "application/json")
                doOutput = true
                connectTimeout = timeoutMs
                readTimeout = timeoutMs
            }
            conn.outputStream.use { it.write(body.toString().toByteArray()) }
            val rc = conn.responseCode
            Log.i(TAG, "$kind posted anonymously (HTTP $rc)")
        } catch (e: Exception) {
            Log.w(TAG, "$kind anonymous post failed: ${e.message}")
        }
    }
}
