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
 * Rotating file logger — customer-testing build.
 *
 * Bisected 2026-04-23 through 5 CI iterations to narrow down the Kotlin
 * compile error. The error was in rotate()'s body — still tracking the
 * exact root cause, but the rotation-free version compiles cleanly and
 * is strictly more useful than the previous stub (which only hit
 * logcat — lost on Goodview / NovaStar / TCL boxes that have no
 * ADB access).
 *
 * What ships in this build:
 *   ✓ init(Context)                       — idempotent, caches logDir
 *   ✓ d/i/w/e(tag, msg, [throwable])      — forwards to logcat AND
 *                                           appends to on-disk log
 *   ✓ readRecent(maxLines)                — tail of active file
 *   ✓ uploadRecent(...)                   — no-op (next commit)
 *   ✓ truncateSecret(...)                 — redaction helper
 *
 * Deferred to follow-ups (won't block customer testing):
 *   • 1 MB rotation — rotate() body broke CI on bisect 5; reinstate
 *     once I can reproduce locally with an Android SDK
 *   • Daemon-thread uploadRecent — needs local test too
 *   • Crash handler via setDefaultUncaughtExceptionHandler
 *
 * Disk budget note: without rotation the file grows unbounded. At
 * typical heartbeat/OTA/boot volumes that's ~2 MB/day, fine for weeks
 * of customer testing but will eventually fill external storage. Boot
 * logs `logDir` so an operator can manually wipe if needed. Do not
 * leave on a pilot device past ~60 days without the rotation fix.
 */
object PlayerLogger {

    private const val LOG_FILE = "player.log"

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
            } catch (ex: Exception) {
                Log.e("PlayerLogger", "writeLine failed: " + (ex.message ?: "unknown"))
            }
        }
    }
}
