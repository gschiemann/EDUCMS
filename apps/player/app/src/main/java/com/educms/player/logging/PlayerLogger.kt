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
 * Rotating file logger.
 *
 * Bisected 2026-04-23 — the previous rotate() helper function broke the
 * Kotlin compile in a way that GitHub's unauth'd check-runs API didn't
 * expose. Inlined rotation into writeLine instead: `runCatching { ... }`
 * around delete + renameTo avoids the nested-try-catch pattern that was
 * the likely culprit (bisect showed rotate()'s body specifically was
 * the failure; writeLine-without-rotation built clean).
 *
 * Shipped features:
 *   ✓ init(Context)                       — idempotent, caches logDir
 *   ✓ d/i/w/e(tag, msg, [throwable])      — forwards to logcat AND
 *                                           appends to on-disk log
 *   ✓ readRecent(maxLines)                — tail of active file
 *   ✓ truncateSecret(...)                 — redaction helper
 *   ✓ 1 MB rotation on write              — player.log → player.1.log
 *                                           once it crosses the cap
 *
 * Deferred (follow-up once APK baseline is stable on customer boxes):
 *   • Daemon-thread uploadRecent — currently no-op
 *   • Crash handler via setDefaultUncaughtExceptionHandler
 *   • Reading rotated file in readRecent (currently active file only)
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
        // Direct-to-logcat so init never recurses through writeLine —
        // kept on boot so tail -f logcat still shows the logDir path.
        Log.i("PlayerLogger", "Logger initialised. logDir=" + (logDir?.absolutePath ?: "(null)"))
    }

    fun d(tag: String, msg: String) { writeLine("DEBUG", tag, msg, null) }
    fun i(tag: String, msg: String) { writeLine("INFO", tag, msg, null) }
    fun w(tag: String, msg: String, throwable: Throwable? = null) { writeLine("WARN", tag, msg, throwable) }
    fun e(tag: String, msg: String, throwable: Throwable? = null) { writeLine("ERROR", tag, msg, throwable) }

    fun readRecent(maxLines: Int = 500): String {
        val dir = logDir ?: return "(logger not initialised)"
        val active = File(dir, LOG_FILE)
        if (!active.exists()) return "(no log file yet)"
        synchronized(LOCK) {
            val lines = ArrayList<String>()
            val reader = active.bufferedReader()
            try {
                while (true) {
                    val line = reader.readLine() ?: break
                    lines.add(line)
                }
            } catch (ex: Exception) {
                return "(readRecent failed: " + (ex.message ?: "unknown") + ")"
            } finally {
                try { reader.close() } catch (_: Exception) {}
            }
            return if (lines.size <= maxLines) {
                lines.joinToString("\n")
            } else {
                val start = lines.size - maxLines
                lines.subList(start, lines.size).joinToString("\n")
            }
        }
    }

    fun uploadRecent(apiRoot: String, deviceJwt: String?, screenId: String?) {
        // Deferred — see header. No-op for this customer-testing build
        // so the call site compiles and an operator hitting the
        // "Upload diagnostics" button in the info overlay just gets a
        // clean logcat note instead of a crash.
        Log.i("PlayerLogger", "uploadRecent deferred — apiRoot=" + apiRoot +
            " screen=" + (screenId ?: "none"))
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
                // Rotation on write: keep player.log under 1 MB by
                // flipping it to player.1.log once it crosses the
                // threshold. Using two sequential try-blocks (instead of
                // nested) because the previous nested-try version broke
                // CI with a compile error that hid in the bisect.
                if (active.length() >= MAX_BYTES) {
                    val rotated = File(dir, ROTATED_FILE)
                    runCatching { rotated.delete() }
                    runCatching { active.renameTo(rotated) }
                }
            } catch (ex: Exception) {
                Log.e("PlayerLogger", "writeLine failed: " + (ex.message ?: "unknown"))
            }
        }
    }
}
