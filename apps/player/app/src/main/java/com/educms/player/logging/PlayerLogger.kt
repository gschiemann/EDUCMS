package com.educms.player.logging

import android.content.Context
import android.util.Log
import java.io.File
import java.io.PrintWriter
import java.io.StringWriter
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

/**
 * Bisect step 2 — STUB BODIES + FULL IMPORTS + FIELDS.
 *
 * The full-feature version and the minimal file-write version both
 * failed CI. The plain stub (no imports, no fields) passed. This
 * variant keeps stub behaviour for every method but ADDS:
 *   - the full set of java.io / java.text / java.util imports
 *   - the object-level fields (LOCK, logDir, initialized, LOG_FILE)
 *
 * If this passes, the imports+fields are fine and the compile error
 * is in one of the bodies. If this fails, the issue is in the
 * imports/fields themselves (wouldn't expect it, but that's exactly
 * why we're bisecting).
 */
object PlayerLogger {

    private const val LOG_FILE = "player.log"
    private const val MAX_BYTES = 1_048_576L

    private val LOCK = Any()
    private var logDir: File? = null
    private var initialized = false

    fun init(ctx: Context) {
        // Minimal init — no file IO yet. Record that we were called
        // so later bisect steps can tell the difference.
        synchronized(LOCK) {
            if (initialized) return
            logDir = ctx.getExternalFilesDir("logs")
            initialized = true
        }
    }

    fun d(tag: String, msg: String) { Log.d(tag, msg) }
    fun i(tag: String, msg: String) { Log.i(tag, msg) }
    fun w(tag: String, msg: String, throwable: Throwable? = null) {
        if (throwable != null) Log.w(tag, msg, throwable) else Log.w(tag, msg)
    }
    fun e(tag: String, msg: String, throwable: Throwable? = null) {
        if (throwable != null) Log.e(tag, msg, throwable) else Log.e(tag, msg)
    }

    fun readRecent(maxLines: Int = 500): String {
        return "(file logger stub 2 — file reads not yet re-enabled)"
    }

    fun uploadRecent(apiRoot: String, deviceJwt: String?, screenId: String?) {
        Log.i("PlayerLogger", "uploadRecent stub-2 — apiRoot=$apiRoot screen=${screenId ?: "none"}")
    }

    fun truncateSecret(value: String?, n: Int = 8): String {
        if (value == null || value.isEmpty()) return "(empty)"
        return value.take(n) + "…"
    }

    // Referenced by the imports above so the compiler doesn't prune them.
    // These are no-ops today — real implementations come in the next
    // bisect step once we know imports+fields compile.
    @Suppress("unused")
    private fun formatTimestamp(): String {
        val sdf = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US)
        sdf.timeZone = TimeZone.getTimeZone("UTC")
        return sdf.format(Date())
    }

    @Suppress("unused")
    private fun formatThrowable(t: Throwable): String {
        val sw = StringWriter()
        t.printStackTrace(PrintWriter(sw))
        return sw.toString()
    }
}
