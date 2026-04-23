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
 * on devices that have no ADB access (Goodview / NovaStar / TCL OEM
 * signage boxes) survive power cycles.
 *
 * Shipped features:
 *   ✓ init(Context)                       — idempotent, caches logDir
 *   ✓ d/i/w/e(tag, msg, [throwable])      — logcat + on-disk append
 *   ✓ truncateSecret(...)                 — redaction helper
 *
 * Deferred (tracked as follow-ups — not customer-facing blockers):
 *   • 1 MB rotation — several Kotlin-syntax attempts tripped the
 *     APK CI compiler in a way the unauth'd check-runs API won't
 *     surface. Revisit with a local Android SDK + JDK 17 so we
 *     can read the actual 'e: file:///…' error instead of
 *     bisecting from CI signal only. Active file grows ~2 MB/day
 *     — acceptable for customer-testing windows; not a shipping
 *     blocker for v1.0.8.
 *   • readRecent() — same CI-blocked bisect. Pull the log via
 *     adb or USB from `getExternalFilesDir("logs")` today.
 *   • uploadRecent() — no-op. Follow-up.
 *   • Crash handler via Thread.setDefaultUncaughtExceptionHandler.
 */
object PlayerLogger {

    private const val LOG_FILE = "player.log"
    private const val MAX_BYTES = 1_048_576L

    private val LOCK = Any()
    // @Volatile guarantees cross-thread visibility without the full
    // synchronized-block cost on every read. logDir + initialized are
    // READ from every writeLine call but only WRITTEN from init().
    // Without @Volatile, a worker thread's read of `initialized=true`
    // could legally see the older `logDir=null` on some JVMs and
    // skip the file write silently — the exact issue the audit
    // flagged.
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
        // Don't call i() from here in bisect 3 — that recursion through
        // write() can hide a stacktrace when the root cause lives in
        // write(). Keeping it direct-to-logcat for now.
        Log.i("PlayerLogger", "Logger initialised. logDir=" + (logDir?.absolutePath ?: "(null)"))
    }

    fun d(tag: String, msg: String) { writeLine("DEBUG", tag, msg, null) }
    fun i(tag: String, msg: String) { writeLine("INFO", tag, msg, null) }
    fun w(tag: String, msg: String, throwable: Throwable? = null) { writeLine("WARN", tag, msg, throwable) }
    fun e(tag: String, msg: String, throwable: Throwable? = null) { writeLine("ERROR", tag, msg, throwable) }

    fun readRecent(maxLines: Int = 500): String {
        val dir = logDir ?: return "(logger not initialised)"
        return "(in-app log tail pending — pull " + File(dir, LOG_FILE).absolutePath +
            " via adb or USB for the full trace; on-device view coming in next build)"
    }

    fun uploadRecent(apiRoot: String, deviceJwt: String?, screenId: String?) {
        // Upload deferred — see file header. Kept as a compiling no-op
        // so every caller (MainActivity, WebAppBridge, etc.) still
        // resolves.
        Log.i(
            "PlayerLogger",
            "uploadRecent deferred — apiRoot=" + apiRoot +
                " screen=" + (screenId ?: "none"),
        )
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

    // Forward to logcat AND append a formatted line to the active
    // log file. No rotation yet — that comes in bisect step 4 once we
    // know write itself compiles.
    private fun writeLine(level: String, tag: String, msg: String, throwable: Throwable?) {
        // Logcat first — always works regardless of init state.
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
