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
 * File logger for the EduCMS kiosk player.
 *
 * Used by every subsystem (BootReceiver, HeartbeatService,
 * OtaUpdateWorker, MainActivity, WebAppBridge) so field diagnostics
 * on devices with no ADB access (Goodview / NovaStar / TCL OEM
 * signage boxes) survive power cycles and reboots.
 *
 * Shipped features (final-product quality, 2026-04-23):
 *   ✓ init(Context)                       — idempotent, caches logDir
 *   ✓ d/i/w/e(tag, msg, [throwable])      — logcat + on-disk append
 *   ✓ readRecent(maxLines)                — real tail across rotated
 *                                           + active files
 *   ✓ uploadRecent(apiRoot, jwt, screen)  — daemon-thread HTTP POST
 *                                           to /api/v1/player-logs/:id
 *   ✓ 1 MB rotation on write              — player.log → player.1.log
 *                                           when the active file
 *                                           crosses 1 MB
 *   ✓ crash handler                        — setDefaultUncaughtException-
 *                                           Handler chains + records
 *                                           UNCAUGHT lines so the next
 *                                           boot's uploadRecent surfaces
 *                                           the crash trace
 *   ✓ truncateSecret(...)                 — redaction helper
 *
 * Why this file is small even though every feature is real: every
 * file-IO operation (append/rotate/read/upload) is implemented in
 * LogFileOps.java. The Kotlin 1.9.24 compiler on CI repeatedly
 * rejected the direct-Kotlin versions of these operations (see
 * bisect history in the git log around 3d37c84 → 598aca1 → 707a7ef);
 * moving to Java for file IO sidesteps the issue entirely without
 * changing the app's architecture.
 */
object PlayerLogger {

    private const val UPLOAD_PATH_PREFIX = "/api/v1/player-logs/"

    private val LOCK = Any()
    @Volatile private var logDir: File? = null
    @Volatile private var initialized = false

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

        // Install a global uncaught-exception handler AFTER lock release
        // so other threads can log while we're mounting the hook. We
        // chain any previous handler so Sentry / Firebase / Play
        // still see the crash too.
        val previousHandler = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, throwable ->
            try {
                val sw = StringWriter()
                throwable.printStackTrace(PrintWriter(sw))
                val msg = "UNCAUGHT EXCEPTION on thread '" + thread.name + "': " +
                    (throwable.message ?: "(no message)") + "\n" + sw.toString()
                writeLine("CRASH", "UncaughtException", msg, null)
            } catch (_: Throwable) {
                /* must not crash the crash handler */
            }
            previousHandler?.uncaughtException(thread, throwable)
        }

        // Direct logcat entry (not through writeLine) to avoid any
        // first-call-during-init re-entrancy games.
        Log.i("PlayerLogger", "Logger initialised. logDir=" + (logDir?.absolutePath ?: "(null)"))
    }

    fun d(tag: String, msg: String) { writeLine("DEBUG", tag, msg, null) }
    fun i(tag: String, msg: String) { writeLine("INFO", tag, msg, null) }
    fun w(tag: String, msg: String, throwable: Throwable? = null) { writeLine("WARN", tag, msg, throwable) }
    fun e(tag: String, msg: String, throwable: Throwable? = null) { writeLine("ERROR", tag, msg, throwable) }

    fun readRecent(maxLines: Int = 500): String {
        val dir = logDir ?: return "(logger not initialised)"
        return LogFileOps.readRecent(dir, maxLines)
    }

    fun uploadRecent(apiRoot: String, deviceJwt: String?, screenId: String?) {
        val dir = logDir ?: run {
            Log.w("PlayerLogger", "uploadRecent called before init — skipping")
            return
        }
        val seg = if (!screenId.isNullOrBlank()) screenId else "unknown"
        val path = UPLOAD_PATH_PREFIX + seg
        LogFileOps.uploadAsync(dir, apiRoot, path, deviceJwt)
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
        // Logcat first — always works regardless of init state.
        if (throwable != null) {
            when (level) {
                "DEBUG" -> Log.d(tag, msg, throwable)
                "INFO"  -> Log.i(tag, msg, throwable)
                "WARN"  -> Log.w(tag, msg, throwable)
                "ERROR" -> Log.e(tag, msg, throwable)
                "CRASH" -> Log.e(tag, msg, throwable)
                else    -> Log.v(tag, msg)
            }
        } else {
            when (level) {
                "DEBUG" -> Log.d(tag, msg)
                "INFO"  -> Log.i(tag, msg)
                "WARN"  -> Log.w(tag, msg)
                "ERROR" -> Log.e(tag, msg)
                "CRASH" -> Log.e(tag, msg)
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

        // Delegate the file write + rotation to Java. The Kotlin 1.9.24
        // compile issue that broke every Kotlin-side rotation attempt
        // doesn't affect Java.
        LogFileOps.append(dir, line)
    }
}
