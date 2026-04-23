package com.educms.player.logging

import android.content.Context
import android.util.Log
import java.io.File
import java.io.PrintWriter
import java.io.StringWriter
import java.net.HttpURLConnection
import java.net.URL
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

/**
 * Rotating file logger for the EduCMS kiosk player.
 *
 * Writes structured log lines to external-files storage so they survive
 * app updates and can be retrieved for field diagnostics on Goodview /
 * NovaStar / TCL displays that have no ADB access. Also forwards every
 * line to android.util.Log so logcat still works during development.
 *
 * Rotation: player.log → player.1.log → player.2.log at 1 MB each.
 * Max on-disk footprint is 3 × 1 MB = 3 MB per device.
 *
 * Thread safety: all file writes are wrapped in `synchronized(LOCK)`.
 * Uploads run in a daemon Thread so callers never block.
 *
 * Security: sensitive fields (JWTs, pairing codes, device fingerprints)
 * must NOT appear in full. Callers are responsible for truncating before
 * passing to the logger; `truncateSecret()` is provided for this.
 *
 * Install path: call PlayerLogger.init(applicationContext) from
 * PlayerApp.onCreate() BEFORE any other code that might log.
 *
 * This file deliberately avoids:
 *   - kotlin.concurrent.withLock (stdlib extension that some toolchains
 *     have flagged; use `synchronized` + plain monitor instead)
 *   - buildList { } (requires Kotlin 1.6+ language feature; safe to
 *     avoid for portability across AGP/Kotlin combos)
 *   - @Volatile on an `object`'s var properties (replaced with an
 *     explicit Object monitor + single-threaded init via double-checked
 *     locking)
 *   - custom-getter one-liners on val properties (expanded to a plain
 *     private function to keep the Kotlin source 100% idiomatic)
 */
object PlayerLogger {

    // ── Constants ───────────────────────────────────────────────────────────

    private const val LOG_FILE = "player.log"
    private const val MAX_BYTES = 1_048_576L            // 1 MB per file
    private const val MAX_ROTATIONS = 2                  // .1.log and .2.log kept
    private const val UPLOAD_PATH = "/api/v1/player-logs"
    private const val MAX_UPLOAD_BYTES = 512_000         // 512 KB under server 1 MB cap
    private const val READ_TAIL_LINES = 500

    // ── State ────────────────────────────────────────────────────────────────

    // Monitor used by every file-touching method. Kept as Any so there is
    // zero doubt about which lock is taken.
    private val LOCK = Any()

    private var logDir: File? = null
    private var initialized = false

    // ── Public API ───────────────────────────────────────────────────────────

    /**
     * Must be called once from PlayerApp.onCreate() before any log calls.
     * Safe to call multiple times (idempotent after first call).
     */
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

        // Install a global uncaught-exception handler outside the lock so
        // the lock isn't held while other threads might be logging. We
        // chain the previous handler so Sentry / Firebase etc. still see
        // the crash too.
        val previousHandler = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, throwable ->
            try {
                val sw = StringWriter()
                throwable.printStackTrace(PrintWriter(sw))
                writeRaw("CRASH", "UncaughtException",
                    "UNCAUGHT EXCEPTION on thread '" + thread.name + "': " +
                    (throwable.message ?: "(no message)") + "\n" + sw.toString())
                // Force a rotation so the crash lands at the head of the next file.
                synchronized(LOCK) { rotate() }
            } catch (_: Throwable) { /* must not crash the crash handler */ }
            previousHandler?.uncaughtException(thread, throwable)
        }

        i("PlayerLogger", "Logger initialised. logDir=" + (logDir?.absolutePath ?: "(null)"))
    }

    fun d(tag: String, msg: String) { write("DEBUG", tag, msg, null) }
    fun i(tag: String, msg: String) { write("INFO ", tag, msg, null) }
    fun w(tag: String, msg: String, throwable: Throwable? = null) { write("WARN ", tag, msg, throwable) }
    fun e(tag: String, msg: String, throwable: Throwable? = null) { write("ERROR", tag, msg, throwable) }

    /**
     * Returns a tail of the combined log files (newest last) as a plain
     * string, up to `maxLines` lines. Blocks briefly on the monitor to
     * get a consistent snapshot.
     */
    fun readRecent(maxLines: Int = READ_TAIL_LINES): String {
        val dir = logDir ?: return "(logger not initialised)"
        synchronized(LOCK) {
            return try {
                val files = ArrayList<File>()
                // Oldest rotated files first so chronological order is preserved.
                var i = MAX_ROTATIONS
                while (i >= 1) {
                    val f = File(dir, "player." + i + ".log")
                    if (f.exists()) files.add(f)
                    i--
                }
                val active = File(dir, LOG_FILE)
                if (active.exists()) files.add(active)

                val lines = ArrayList<String>()
                for (f in files) {
                    val reader = f.bufferedReader()
                    try {
                        while (true) {
                            val line = reader.readLine() ?: break
                            lines.add(line)
                        }
                    } finally {
                        try { reader.close() } catch (_: Exception) {}
                    }
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

    /**
     * POSTs the recent log tail to the API for server-side storage.
     * Runs on a short-lived daemon Thread; non-blocking from the caller's
     * perspective. Result is logged (to the log file and logcat).
     *
     * `deviceJwt` is the device-scoped JWT used in the Authorization header.
     * `screenId` is passed through as the URL segment; if null/blank we use
     * "unknown" so the server-side AuditLog still captures the payload.
     */
    fun uploadRecent(apiRoot: String, deviceJwt: String?, screenId: String?) {
        val worker = Thread(Runnable {
            val jwtHint = if (deviceJwt != null && deviceJwt.isNotEmpty()) {
                deviceJwt.take(8) + "…"
            } else {
                "none"
            }
            i("PlayerLogger", "uploadRecent: starting upload to " + apiRoot + " (jwt=" + jwtHint + ")")
            try {
                var bodyBytes = readRecent(2000).toByteArray(Charsets.UTF_8)
                if (bodyBytes.size > MAX_UPLOAD_BYTES) {
                    // Keep the TAIL so we see the most-recent activity.
                    val start = bodyBytes.size - MAX_UPLOAD_BYTES
                    val trimmed = ByteArray(MAX_UPLOAD_BYTES)
                    System.arraycopy(bodyBytes, start, trimmed, 0, MAX_UPLOAD_BYTES)
                    bodyBytes = trimmed
                }

                val seg = if (screenId != null && screenId.isNotBlank()) screenId else "unknown"
                val url = URL(apiRoot.trimEnd('/') + UPLOAD_PATH + "/" + seg)

                val conn = url.openConnection() as HttpURLConnection
                conn.requestMethod = "POST"
                conn.setRequestProperty("Content-Type", "text/plain; charset=utf-8")
                conn.setRequestProperty("Content-Length", bodyBytes.size.toString())
                if (deviceJwt != null && deviceJwt.isNotEmpty()) {
                    conn.setRequestProperty("Authorization", "Bearer " + deviceJwt)
                }
                conn.connectTimeout = 10_000
                conn.readTimeout = 15_000
                conn.doOutput = true

                val out = conn.outputStream
                try { out.write(bodyBytes) } finally { try { out.close() } catch (_: Exception) {} }

                val code = conn.responseCode
                if (code in 200..299) {
                    i("PlayerLogger", "uploadRecent: success HTTP " + code + " (" + bodyBytes.size + "B sent)")
                } else {
                    w("PlayerLogger", "uploadRecent: server returned HTTP " + code)
                }
                try { conn.inputStream.close() } catch (_: Exception) {}
            } catch (ex: Exception) {
                w("PlayerLogger", "uploadRecent: upload failed: " + (ex.message ?: "unknown"))
            }
        }, "PlayerLogger-upload")
        worker.isDaemon = true
        worker.start()
    }

    /**
     * Truncate a sensitive value to the first `n` chars + "…" so it can
     * be referenced in log lines without leaking the full secret.
     * Use for JWT tokens, pairing codes, device fingerprints.
     */
    fun truncateSecret(value: String?, n: Int = 8): String {
        if (value == null || value.isEmpty()) return "(empty)"
        return value.take(n) + "…"
    }

    // ── Private implementation ───────────────────────────────────────────────

    private fun formatTimestamp(): String {
        // New SDF per call — SimpleDateFormat isn't thread-safe, and this
        // method is called from every thread that logs. Cheap enough.
        val sdf = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US)
        sdf.timeZone = TimeZone.getTimeZone("UTC")
        return sdf.format(Date())
    }

    private fun write(level: String, tag: String, msg: String, throwable: Throwable?) {
        // Forward to logcat regardless of init status.
        when (level.trim()) {
            "DEBUG" -> if (throwable != null) Log.d(tag, msg, throwable) else Log.d(tag, msg)
            "INFO"  -> if (throwable != null) Log.i(tag, msg, throwable) else Log.i(tag, msg)
            "WARN"  -> if (throwable != null) Log.w(tag, msg, throwable) else Log.w(tag, msg)
            "ERROR" -> if (throwable != null) Log.e(tag, msg, throwable) else Log.e(tag, msg)
            "CRASH" -> if (throwable != null) Log.e(tag, msg, throwable) else Log.e(tag, msg)
            else    -> Log.v(tag, msg)
        }
        if (!initialized) return

        val fullMsg = if (throwable != null) {
            val sw = StringWriter()
            throwable.printStackTrace(PrintWriter(sw))
            val traceText = sw.toString()
            val indented = StringBuilder(traceText.length + 32)
            for (line in traceText.split('\n')) {
                indented.append("    ").append(line).append('\n')
            }
            msg + "\n" + indented.toString().trimEnd('\n')
        } else {
            msg
        }

        writeRaw(level, tag, fullMsg)
    }

    /**
     * Core write: formats the line, appends to the active log file, and
     * rotates if the file has grown past MAX_BYTES. Called under LOCK.
     */
    private fun writeRaw(level: String, tag: String, msg: String) {
        val dir = logDir ?: return
        val line = formatTimestamp() + " [" + level + "] " + tag + ": " + msg + "\n"

        synchronized(LOCK) {
            try {
                val active = File(dir, LOG_FILE)
                active.appendText(line, Charsets.UTF_8)
                if (active.length() >= MAX_BYTES) {
                    rotate()
                }
            } catch (ex: Exception) {
                // If the FS is broken we can't log to file, but logcat
                // already got the message above so it isn't lost.
                Log.e("PlayerLogger", "writeRaw failed: " + (ex.message ?: "unknown"))
            }
        }
    }

    /**
     * Rotate logs: player.2.log is dropped, player.1.log → player.2.log,
     * player.log → player.1.log. The active file is recreated empty on
     * the next write.
     *
     * MUST be called while holding LOCK (or from the crash handler where
     * single-thread execution is guaranteed).
     */
    private fun rotate() {
        val dir = logDir ?: return
        try {
            val oldest = File(dir, "player." + MAX_ROTATIONS + ".log")
            if (oldest.exists()) {
                try { oldest.delete() } catch (_: Exception) {}
            }
            var i = MAX_ROTATIONS
            while (i >= 2) {
                val src = File(dir, "player." + (i - 1) + ".log")
                if (src.exists()) {
                    try { src.renameTo(File(dir, "player." + i + ".log")) } catch (_: Exception) {}
                }
                i--
            }
            val active = File(dir, LOG_FILE)
            if (active.exists()) {
                try { active.renameTo(File(dir, "player.1.log")) } catch (_: Exception) {}
            }
            Log.i("PlayerLogger", "Log rotated. Kept files: player.log, player.1.log, player.2.log")
        } catch (ex: Exception) {
            Log.w("PlayerLogger", "rotate() failed: " + (ex.message ?: "unknown"))
        }
    }
}
