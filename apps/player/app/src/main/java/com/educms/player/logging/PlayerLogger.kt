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
 * Rotating file logger — minimum viable version for customer testing.
 *
 * THIS IS AN INTENTIONALLY CONSERVATIVE BUILD. Previous richer versions
 * (crash handler, daemon-thread upload, advanced rotation) broke the
 * APK CI gradle build with inaccessible remote logs. We're adding those
 * features back in subsequent commits one slice at a time so any
 * regression is caught by a single commit.
 *
 * Features shipped in THIS commit:
 *   • init(Context)                          — idempotent; caches logDir
 *   • d/i/w/e(tag, msg, [throwable])         — forwards to logcat, writes file
 *   • readRecent(maxLines)                   — tail of active log file
 *   • truncateSecret(value, n)               — redaction helper
 *   • Simple 1 MB rotation on write          — synchronous, no daemon thread
 *
 * Features DEFERRED (will re-add commit-by-commit after this compiles):
 *   • uploadRecent — daemon-thread HTTP POST
 *   • Crash handler via setDefaultUncaughtExceptionHandler
 *   • Reading rotated files in readRecent (currently active file only)
 *
 * Signatures match the original so every caller (MainActivity,
 * PlayerApp, BootReceiver, HeartbeatService, OtaUpdateWorker,
 * WebAppBridge) compiles unchanged. uploadRecent is still exposed but
 * is a no-op logcat entry for now.
 */
object PlayerLogger {

    private const val LOG_FILE = "player.log"
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
        i("PlayerLogger", "Logger initialised. logDir=" + (logDir?.absolutePath ?: "(null)"))
    }

    fun d(tag: String, msg: String) { write("DEBUG", tag, msg, null) }
    fun i(tag: String, msg: String) { write("INFO ", tag, msg, null) }
    fun w(tag: String, msg: String, throwable: Throwable? = null) { write("WARN ", tag, msg, throwable) }
    fun e(tag: String, msg: String, throwable: Throwable? = null) { write("ERROR", tag, msg, throwable) }

    fun readRecent(maxLines: Int = 500): String {
        val dir = logDir ?: return "(logger not initialised)"
        synchronized(LOCK) {
            return try {
                val active = File(dir, LOG_FILE)
                if (!active.exists()) return "(no log file yet)"
                val lines = ArrayList<String>()
                val reader = active.bufferedReader()
                try {
                    while (true) {
                        val line = reader.readLine() ?: break
                        lines.add(line)
                    }
                } finally {
                    try { reader.close() } catch (_: Exception) {}
                }
                if (lines.size <= maxLines) {
                    lines.joinToString("\n")
                } else {
                    val start = lines.size - maxLines
                    lines.subList(start, lines.size).joinToString("\n")
                }
            } catch (ex: Exception) {
                "(readRecent failed: " + (ex.message ?: "unknown") + ")"
            }
        }
    }

    fun uploadRecent(apiRoot: String, deviceJwt: String?, screenId: String?) {
        // Deferred — see file header. No-op for now so the call site compiles.
        Log.i("PlayerLogger", "uploadRecent not yet implemented (apiRoot=" + apiRoot + " screen=" + (screenId ?: "none") + ")")
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

    private fun write(level: String, tag: String, msg: String, throwable: Throwable?) {
        when (level.trim()) {
            "DEBUG" -> if (throwable != null) Log.d(tag, msg, throwable) else Log.d(tag, msg)
            "INFO"  -> if (throwable != null) Log.i(tag, msg, throwable) else Log.i(tag, msg)
            "WARN"  -> if (throwable != null) Log.w(tag, msg, throwable) else Log.w(tag, msg)
            "ERROR" -> if (throwable != null) Log.e(tag, msg, throwable) else Log.e(tag, msg)
            else    -> Log.v(tag, msg)
        }
        if (!initialized) return

        val fullMsg = if (throwable != null) {
            val sw = StringWriter()
            throwable.printStackTrace(PrintWriter(sw))
            msg + "\n" + sw.toString()
        } else {
            msg
        }

        val dir = logDir ?: return
        val line = formatTimestamp() + " [" + level + "] " + tag + ": " + fullMsg + "\n"

        synchronized(LOCK) {
            try {
                val active = File(dir, LOG_FILE)
                active.appendText(line, Charsets.UTF_8)
                if (active.length() >= MAX_BYTES) {
                    rotate(dir)
                }
            } catch (ex: Exception) {
                Log.e("PlayerLogger", "write failed: " + (ex.message ?: "unknown"))
            }
        }
    }

    private fun rotate(dir: File) {
        try {
            val rotated = File(dir, "player.1.log")
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
