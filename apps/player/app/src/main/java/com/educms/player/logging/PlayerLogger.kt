package com.educms.player.logging

import android.content.Context
import android.util.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import java.io.File
import java.io.PrintWriter
import java.io.StringWriter
import java.net.HttpURLConnection
import java.net.URL
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.concurrent.locks.ReentrantLock
import kotlin.concurrent.withLock

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
 * Thread safety: all writes go through [lock]. Reads (readRecent) and
 * uploads run on a separate IO coroutine scope to avoid blocking callers.
 *
 * Security: sensitive fields (JWTs, pairing codes, device fingerprints)
 * must NOT appear in full. Callers are responsible for truncating before
 * passing to the logger; the truncateSecret() helper is provided for this.
 *
 * Install path: call PlayerLogger.init(applicationContext) from
 * PlayerApp.onCreate() BEFORE any other code that might log.
 */
object PlayerLogger {

    // ── Constants ───────────────────────────────────────────────────────────

    private const val LOG_FILE      = "player.log"
    private const val MAX_BYTES     = 1_048_576L   // 1 MB per file
    private const val MAX_ROTATIONS = 2             // .1.log and .2.log kept
    private const val UPLOAD_PATH   = "/api/v1/player-logs"
    private const val MAX_UPLOAD_BYTES = 512_000    // 512 KB to stay under server 1 MB cap
    private const val READ_TAIL_LINES  = 500

    // ── State ────────────────────────────────────────────────────────────────

    private val lock  = ReentrantLock()
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    @Volatile private var logDir: File? = null
    @Volatile private var initialized = false

    private val iso8601: SimpleDateFormat get() = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).also {
        it.timeZone = TimeZone.getTimeZone("UTC")
    }

    // ── Public API ───────────────────────────────────────────────────────────

    /**
     * Must be called once from PlayerApp.onCreate() before any log calls.
     * Safe to call multiple times (idempotent after first call).
     *
     * Also installs a global uncaught exception handler that captures the
     * crash stack trace to the log file and rotates before the process dies.
     */
    fun init(ctx: Context) {
        if (initialized) return
        logDir = ctx.getExternalFilesDir("logs")?.also { it.mkdirs() }
        initialized = true

        // Install crash handler. We chain the previous handler so nothing
        // is lost if another library (Sentry, Firebase Crashlytics) also
        // set one.
        val previousHandler = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, throwable ->
            try {
                val sw = StringWriter()
                throwable.printStackTrace(PrintWriter(sw))
                writeRaw("CRASH", "UncaughtException",
                    "UNCAUGHT EXCEPTION on thread '${thread.name}': ${throwable.message}\n${sw}")
                // Force a rotation so the crash is at the top of the next file.
                rotate()
            } catch (_: Throwable) { /* must not crash the crash handler */ }
            previousHandler?.uncaughtException(thread, throwable)
        }

        i("PlayerLogger", "Logger initialised. logDir=${logDir?.absolutePath}")
    }

    fun d(tag: String, msg: String) = write("DEBUG", tag, msg, null)
    fun i(tag: String, msg: String) = write("INFO ", tag, msg, null)
    fun w(tag: String, msg: String, throwable: Throwable? = null) = write("WARN ", tag, msg, throwable)
    fun e(tag: String, msg: String, throwable: Throwable? = null) = write("ERROR", tag, msg, throwable)

    /**
     * Returns a tail of the combined log files (newest last) as a plain
     * string, up to [maxLines] lines. Thread-safe; blocks briefly on [lock]
     * to get a consistent snapshot.
     */
    fun readRecent(maxLines: Int = READ_TAIL_LINES): String {
        val dir = logDir ?: return "(logger not initialised)"
        return lock.withLock {
            try {
                // Read from oldest rotated files down to the active file so
                // chronological order is preserved in the returned string.
                val files = buildList {
                    for (i in MAX_ROTATIONS downTo 1) {
                        val f = File(dir, "player.$i.log")
                        if (f.exists()) add(f)
                    }
                    val active = File(dir, LOG_FILE)
                    if (active.exists()) add(active)
                }

                val lines = mutableListOf<String>()
                for (f in files) {
                    f.bufferedReader().forEachLine { lines.add(it) }
                }

                if (lines.size <= maxLines) {
                    lines.joinToString("\n")
                } else {
                    lines.takeLast(maxLines).joinToString("\n")
                }
            } catch (ex: Exception) {
                "(readRecent failed: ${ex.message})"
            }
        }
    }

    /**
     * POSTs the recent log tail to the API for server-side storage.
     * Runs on the IO dispatcher; non-blocking from the caller's perspective.
     * Returns immediately; result is logged (to the log file and logcat).
     *
     * [deviceJwt] is the device-scoped JWT used in the Authorization header.
     * Pass null to send without auth (the server will still accept if the
     * route is exempted, but this is not recommended).
     *
     * Security: never log the full [deviceJwt] value here. We log only the
     * first 8 chars so support can cross-reference the token family.
     */
    fun uploadRecent(apiRoot: String, deviceJwt: String?) {
        scope.launch {
            val jwtHint = deviceJwt?.take(8)?.let { "$it…" } ?: "none"
            i("PlayerLogger", "uploadRecent: starting upload to $apiRoot (jwt=${jwtHint})")
            try {
                val body = readRecent(maxLines = 2000)
                    .toByteArray(Charsets.UTF_8)
                    .let { if (it.size > MAX_UPLOAD_BYTES) it.takeLast(MAX_UPLOAD_BYTES).toByteArray() else it }

                // Derive the screenId from the stored fingerprint for the URL segment.
                // We use "unknown" when the device isn't yet paired — the server will
                // still log via AuditLog; it just won't have a screen association.
                val screenId = getStoredScreenId() ?: "unknown"
                val url = URL("${apiRoot.trimEnd('/')}$UPLOAD_PATH/$screenId")

                val conn = (url.openConnection() as HttpURLConnection).apply {
                    requestMethod = "POST"
                    setRequestProperty("Content-Type", "text/plain; charset=utf-8")
                    setRequestProperty("Content-Length", body.size.toString())
                    if (deviceJwt != null) {
                        setRequestProperty("Authorization", "Bearer $deviceJwt")
                    }
                    connectTimeout = 10_000
                    readTimeout = 15_000
                    doOutput = true
                }
                conn.outputStream.use { it.write(body) }
                val code = conn.responseCode
                if (code in 200..299) {
                    i("PlayerLogger", "uploadRecent: success HTTP $code (${body.size}B sent)")
                } else {
                    w("PlayerLogger", "uploadRecent: server returned HTTP $code")
                }
                try { conn.inputStream.close() } catch (_: Exception) {}
            } catch (ex: Exception) {
                w("PlayerLogger", "uploadRecent: upload failed: ${ex.message}")
            }
        }
    }

    /**
     * Truncate a sensitive value to the first [n] chars + "…" so it can be
     * referenced in log lines without leaking the full secret.
     * Use for JWT tokens, pairing codes, device fingerprints.
     */
    fun truncateSecret(value: String?, n: Int = 8): String =
        if (value.isNullOrEmpty()) "(empty)" else "${value.take(n)}…"

    // ── Private implementation ───────────────────────────────────────────────

    private fun write(level: String, tag: String, msg: String, throwable: Throwable?) {
        // Forward to logcat regardless of init status.
        when (level.trim()) {
            "DEBUG" -> Log.d(tag, msg, throwable)
            "INFO"  -> Log.i(tag, msg, throwable)
            "WARN"  -> Log.w(tag, msg, throwable)
            "ERROR" -> Log.e(tag, msg, throwable)
            "CRASH" -> Log.e(tag, msg, throwable)
            else    -> Log.v(tag, msg, throwable)
        }
        if (!initialized) return

        val stackTrace = throwable?.let { t ->
            val sw = StringWriter()
            t.printStackTrace(PrintWriter(sw))
            "\n" + sw.toString().lines().joinToString("\n") { "    $it" }
        } ?: ""

        writeRaw(level, tag, msg + stackTrace)
    }

    /**
     * Core write: formats the line, appends to the active log file, and
     * rotates if the file has grown past [MAX_BYTES]. Called under [lock].
     */
    private fun writeRaw(level: String, tag: String, msg: String) {
        val dir = logDir ?: return
        val timestamp = iso8601.format(Date())
        val line = "$timestamp [$level] $tag: $msg\n"

        lock.withLock {
            try {
                val active = File(dir, LOG_FILE)
                active.appendText(line, Charsets.UTF_8)
                if (active.length() >= MAX_BYTES) {
                    rotate()
                }
            } catch (ex: Exception) {
                // If the file system is broken we can't log to the file, but
                // logcat is already written above so the message isn't lost.
                Log.e("PlayerLogger", "writeRaw failed: ${ex.message}")
            }
        }
    }

    /**
     * Rotate logs: player.2.log is dropped, player.1.log → player.2.log,
     * player.log → player.1.log. Then the active file is recreated empty.
     *
     * IMPORTANT: must be called while holding [lock] (or from crash handler
     * where single-thread execution is guaranteed).
     */
    private fun rotate() {
        val dir = logDir ?: return
        try {
            // Drop the oldest.
            val oldest = File(dir, "player.$MAX_ROTATIONS.log")
            if (oldest.exists()) oldest.delete()

            // Shift intermediates.
            for (i in MAX_ROTATIONS downTo 2) {
                val src = File(dir, "player.${i - 1}.log")
                if (src.exists()) src.renameTo(File(dir, "player.$i.log"))
            }

            // Rotate active → .1
            val active = File(dir, LOG_FILE)
            if (active.exists()) active.renameTo(File(dir, "player.1.log"))

            // New empty active file (created on next write by appendText).
            Log.i("PlayerLogger", "Log rotated. Kept files: player.log, player.1.log, player.2.log")
        } catch (ex: Exception) {
            Log.w("PlayerLogger", "rotate() failed: ${ex.message}")
        }
    }

    /**
     * Reads the stored device fingerprint from the app's SharedPreferences.
     * This is the same key the heartbeat service + web player use, so IDs
     * are consistent across components.
     *
     * Returns null if the device has not yet been paired (fresh install).
     * In that case the upload URL will use "unknown" as the segment and
     * the server logs it to AuditLog without a Screen association.
     */
    private fun getStoredScreenId(): String? = try {
        // We don't have a Context inside the singleton, but PlayerApp stores
        // a static reference that the workers use. Mirror that pattern.
        // If null, the upload URL falls back to "unknown".
        PlayerLoggerCtx.appCtx?.getSharedPreferences("edu_player", Context.MODE_PRIVATE)
            ?.getString("device_fingerprint", null)
            ?.takeIf { it.isNotBlank() }
    } catch (_: Exception) { null }
}

/**
 * Thin holder so PlayerLogger can access the application context without
 * receiving it on every call. Set once in PlayerApp.onCreate().
 */
internal object PlayerLoggerCtx {
    @Volatile var appCtx: Context? = null
}
