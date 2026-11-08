package com.educms.manager.diagnostics

import android.content.ContentProvider
import android.content.ContentValues
import android.database.Cursor
import android.net.Uri
import android.os.Bundle
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/**
 * The Manager's half of "Get recent logs" (2026-11-08).
 *
 * The Player cannot read the Manager's log: since Android 4.1 an app reads
 * only its own UID's logcat. So the Player asks the Manager, through this
 * provider's `call("recentLogs", "<minutes>")`, and the Manager reads ITS OWN
 * logcat and hands the text back. The Player redacts it and uploads it with
 * its own; the API redacts it again.
 *
 * Guarded by the same signature-level `HEALTH_PERMISSION` as the heartbeat
 * provider (manifest), so only our own Player can call it. Bounded: at most
 * [MAX_BYTES] of text and [TIMEOUT_MS] of logcat (the process is destroyed
 * past it). Read-only: it never writes, never schedules, never restarts.
 * Pure helpers in [ManagerLogPolicy] (ManagerLogPolicyTest).
 */
class ManagerLogProvider : ContentProvider() {

    override fun onCreate(): Boolean = true

    override fun call(method: String, arg: String?, extras: Bundle?): Bundle? {
        if (method != ManagerLogPolicy.METHOD) return null
        // `call()` is NOT covered by the manifest's android:permission on every
        // API level — enforce the signature permission here as well.
        val ctx = context ?: return null
        if (ctx.checkCallingOrSelfPermission(ManagerLogPolicy.PERMISSION) != android.content.pm.PackageManager.PERMISSION_GRANTED) {
            throw SecurityException("recentLogs requires ${ManagerLogPolicy.PERMISSION}")
        }
        val minutes = ManagerLogPolicy.minutes(arg)
        val text = readOwnLogcat(ManagerLogPolicy.since(System.currentTimeMillis(), minutes)) ?: "(logcat unavailable)"
        return Bundle().apply { putString(ManagerLogPolicy.KEY_TEXT, ManagerLogPolicy.tail(text, ManagerLogPolicy.MAX_BYTES)) }
    }

    private fun readOwnLogcat(since: String): String? = runCatching {
        val p = ProcessBuilder("logcat", "-d", "-v", "threadtime", "-t", since).redirectErrorStream(true).start()
        val ex = Executors.newSingleThreadExecutor()
        try {
            ex.submit<String> {
                val out = java.io.ByteArrayOutputStream()
                val buf = ByteArray(8192)
                p.inputStream.use { input ->
                    while (true) {
                        val n = input.read(buf)
                        if (n < 0) break
                        out.write(buf, 0, n)
                        if (out.size() > ManagerLogPolicy.MAX_BYTES * 2) break
                    }
                }
                out.toString("UTF-8")
            }.get(ManagerLogPolicy.TIMEOUT_MS, TimeUnit.MILLISECONDS)
        } finally {
            runCatching { p.destroy() }
            ex.shutdownNow()
        }
    }.getOrNull()

    override fun query(uri: Uri, projection: Array<out String>?, selection: String?, selectionArgs: Array<out String>?, sortOrder: String?): Cursor? = null
    override fun getType(uri: Uri): String? = null
    override fun insert(uri: Uri, values: ContentValues?): Uri? = null
    override fun delete(uri: Uri, selection: String?, selectionArgs: Array<out String>?): Int = 0
    override fun update(uri: Uri, values: ContentValues?, selection: String?, selectionArgs: Array<out String>?): Int = 0
}

object ManagerLogPolicy {
    const val AUTHORITY = "com.educms.manager.diagnostics"
    const val METHOD = "recentLogs"
    const val KEY_TEXT = "text"
    const val PERMISSION = "com.educms.manager.HEALTH_PERMISSION"
    const val MAX_BYTES = 400_000
    const val TIMEOUT_MS = 8_000L

    fun minutes(arg: String?): Int = (arg?.trim()?.toIntOrNull() ?: 15).coerceIn(5, 60)

    fun since(nowMs: Long, minutes: Int, tz: java.util.TimeZone = java.util.TimeZone.getDefault()): String {
        val f = SimpleDateFormat("MM-dd HH:mm:ss.SSS", Locale.US)
        f.timeZone = tz
        return f.format(Date(nowMs - minutes * 60_000L))
    }

    /** The newest [maxBytes] bytes, cut at a line boundary. */
    fun tail(text: String, maxBytes: Int): String {
        val b = text.toByteArray(Charsets.UTF_8)
        if (b.size <= maxBytes) return text
        val cut = String(b, b.size - maxBytes, maxBytes, Charsets.UTF_8)
        val nl = cut.indexOf('\n')
        return if (nl >= 0) cut.substring(nl + 1) else cut
    }
}
