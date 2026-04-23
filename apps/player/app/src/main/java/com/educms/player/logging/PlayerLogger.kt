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
 * Bisect step 5 — rotation ONLY (no init→i recursion).
 *
 * Bisect 4 (rotation + init→i recursion) failed. Bisect 3 (no rotation,
 * no init→i recursion) passed. Split the two to isolate the culprit:
 *   - This step keeps init() using Log.i() directly (no recursion
 *     through writeLine)
 *   - But adds rotate() + rotation-on-write
 * If this passes, the compile error is specifically the init→i→
 * writeLine chain. If this fails, rotate() is the culprit.
 */
object PlayerLogger {

    private const val LOG_FILE = "player.log"
    private const val ROTATED_FILE = "player.1.log"
    private const val MAX_BYTES = 1_048_576L

    private val LOCK = Any()
    private var logDir: File? = null
    private var initialized = false

    fun init(ctx: Context) {
        synchronized(LOCK) {
            if (initialized) return
            val dir = ctx.getExternalFilesDir("logs")
            if (dir != null) {
                try { dir.mkdirs() } catch (_: Exception) { /* best-effort */ }
            }
            logDir = dir
            initialized = true
        }
        // Direct to logcat — no i() recursion into writeLine in this step.
        Log.i("PlayerLogger", "Logger initialised. logDir=" + (logDir?.absolutePath ?: "(null)"))
    }

    fun d(tag: String, msg: String) { writeLine("DEBUG", tag, msg, null) }
    fun i(tag: String, msg: String) { writeLine("INFO", tag, msg, null) }
    fun w(tag: String, msg: String, throwable: Throwable? = null) { writeLine("WARN", tag, msg, throwable) }
    fun e(tag: String, msg: String, throwable: Throwable? = null) { writeLine("ERROR", tag, msg, throwable) }

    fun readRecent(maxLines: Int = 500): String {
        return "(file logger bisect 5 — readRecent not yet re-enabled)"
    }

    fun uploadRecent(apiRoot: String, deviceJwt: String?, screenId: String?) {
        Log.i("PlayerLogger", "uploadRecent stub-5 — apiRoot=$apiRoot screen=${screenId ?: "none"}")
    }

    fun truncateSecret(value: String?, n: Int = 8): String {
        if (value == null || value.isEmpty()) return "(empty)"
        return value.take(n) + "…"
    }

    private fun formatTimestamp(): String {
        val sdf = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US)
        sdf.timeZone = TimeZone.getTimeZone("UTC")
        return sdf.format(Date())
    }

    private fun writeLine(level: String, tag: String, msg: String, throwable: Throwable?) {
        if (throwable != null) {
            when (level) {
                "DEBUG" -> Log.d(tag, msg, throwable)
                "INFO"  -> Log.i(tag, msg, throwable)
                "WARN"  -> Log.w(tag, msg, throwable)
                "ERROR" -> Log.e(tag, msg, throwable)
                else    -> Log.v(tag, msg)
            }
        } else {
            when (level) {
                "DEBUG" -> Log.d(tag, msg)
                "INFO"  -> Log.i(tag, msg)
                "WARN"  -> Log.w(tag, msg)
                "ERROR" -> Log.e(tag, msg)
                else    -> Log.v(tag, msg)
            }
        }

        if (!initialized) return
        val dir = logDir ?: return

        val fullMsg: String = if (throwable != null) {
            val sw = StringWriter()
            throwable.printStackTrace(PrintWriter(sw))
            msg + "\n" + sw.toString()
        } else {
            msg
        }
        val line = formatTimestamp() + " [" + level + "] " + tag + ": " + fullMsg + "\n"

        synchronized(LOCK) {
            try {
                val active = File(dir, LOG_FILE)
                active.appendText(line, Charsets.UTF_8)
                if (active.length() >= MAX_BYTES) {
                    rotate(dir)
                }
            } catch (ex: Exception) {
                Log.e("PlayerLogger", "writeLine failed: " + (ex.message ?: "unknown"))
            }
        }
    }

    private fun rotate(dir: File) {
        try {
            val rotated = File(dir, ROTATED_FILE)
            if (rotated.exists()) {
                try { rotated.delete() } catch (_: Exception) {}
            }
            val active = File(dir, LOG_FILE)
            if (active.exists()) {
                try { active.renameTo(rotated) } catch (_: Exception) {}
            }
        } catch (ex: Exception) {
            Log.w("PlayerLogger", "rotate failed: " + (ex.message ?: "unknown"))
        }
    }
}
