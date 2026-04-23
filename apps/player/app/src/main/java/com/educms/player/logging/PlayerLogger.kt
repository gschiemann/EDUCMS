package com.educms.player.logging

import android.content.Context
import android.util.Log

/**
 * MINIMAL STUB — previous implementation (rotating file logger, upload,
 * crash handler) crashed the gradle build on CI with no accessible logs.
 * Reverted to a no-op that forwards to logcat so every caller still
 * compiles + runs cleanly. Re-introduce the file-logging features one
 * surface at a time in a follow-up commit once the root cause is known.
 *
 * All public method signatures match the previous API so every existing
 * call site compiles without edits.
 */
object PlayerLogger {
    fun init(ctx: Context) { /* no-op in stub */ }

    fun d(tag: String, msg: String) { Log.d(tag, msg) }
    fun i(tag: String, msg: String) { Log.i(tag, msg) }
    fun w(tag: String, msg: String, throwable: Throwable? = null) {
        if (throwable != null) Log.w(tag, msg, throwable) else Log.w(tag, msg)
    }
    fun e(tag: String, msg: String, throwable: Throwable? = null) {
        if (throwable != null) Log.e(tag, msg, throwable) else Log.e(tag, msg)
    }

    fun readRecent(maxLines: Int = 500): String =
        "(file logger temporarily disabled — see server AuditLog for recent activity)"

    fun uploadRecent(apiRoot: String, deviceJwt: String?, screenId: String?) {
        Log.i("PlayerLogger", "uploadRecent no-op (stub) — apiRoot=$apiRoot screen=${screenId ?: "none"}")
    }

    fun truncateSecret(value: String?, n: Int = 8): String =
        if (value.isNullOrEmpty()) "(empty)" else "${value.take(n)}…"
}
