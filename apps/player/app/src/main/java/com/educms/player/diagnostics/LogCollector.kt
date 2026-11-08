package com.educms.player.diagnostics

import android.content.Context
import android.net.Uri
import com.educms.player.logging.PlayerLogger
import java.util.concurrent.Executors
import java.util.concurrent.ThreadFactory
import java.util.concurrent.TimeUnit

/**
 * Collects the last N minutes of log for BOTH packages (2026-11-08, "Get
 * recent logs").
 *
 *   • Player  — `logcat -d -t <since>` (an app reads its own UID's log with
 *               no permission since Android 4.1), plus the tail of the
 *               persistent PlayerLogger file, which also holds the page's
 *               console lines that survived a reload.
 *   • Manager — a different UID, so its log is read BY the Manager: the
 *               signature-protected `content://com.educms.manager.diagnostics`
 *               provider's `recentLogs` call (Manager ≥ the unit carrying this
 *               feature). An older Manager has no such provider: the bundle
 *               says "companion-too-old", it never fails the upload.
 *
 * Bounded: each logcat ≤ [DiagnosticsPolicy.LOGCAT_TIMEOUT_MS] (the process
 * is destroyed past it) and each package's text is capped in bytes; both are
 * redacted ([LogRedaction]) BEFORE they leave this object.
 */
object LogCollector {

    const val MANAGER_AUTHORITY = "com.educms.manager.diagnostics"
    const val MANAGER_METHOD = "recentLogs"
    const val MANAGER_KEY_TEXT = "text"

    private val pool = Executors.newSingleThreadExecutor(ThreadFactory { r ->
        Thread(r, "diag-logs").apply { isDaemon = true; priority = Thread.MIN_PRIORITY }
    })

    data class Bundle(val player: String, val manager: String, val managerStatus: String)

    fun collect(ctx: Context, minutes: Int): Bundle {
        val since = DiagnosticsPolicy.logcatSince(System.currentTimeMillis(), minutes)
        val logcat = ownLogcat(since) ?: "(logcat unavailable on this device)"
        val file = runCatching { PlayerLogger.readRecent(1500) }.getOrDefault("")
        val player = LogRedaction.tail(
            "----- logcat (last $minutes min) -----\n$logcat\n----- player.log (tail) -----\n$file",
            DiagnosticsPolicy.LOG_PLAYER_MAX_BYTES,
        )
        var status = "unavailable"
        val managerRaw = DiagnosticsPolicy.bounded(pool, DiagnosticsPolicy.LOGCAT_TIMEOUT_MS + 2_000, { status = "error-$it".take(48).lowercase() }) {
            val res = ctx.contentResolver.call(Uri.parse("content://$MANAGER_AUTHORITY"), MANAGER_METHOD, minutes.toString(), null)
            res?.getString(MANAGER_KEY_TEXT)
        }
        val manager = when {
            managerRaw != null -> { status = "ok"; LogRedaction.tail(managerRaw, DiagnosticsPolicy.LOG_MANAGER_MAX_BYTES) }
            status.startsWith("error-") && status.contains("illegalargument") -> { status = "companion-too-old"; "" }
            status.startsWith("error-") && status.contains("security") -> { status = "companion-not-trusted"; "" }
            else -> ""
        }
        return Bundle(player, manager, status.replace(Regex("[^a-z0-9-]"), "-"))
    }

    /** This process's own logcat since [since]; null when logcat cannot run. */
    fun ownLogcat(since: String): String? = runCatching {
        val p = ProcessBuilder("logcat", "-d", "-v", "threadtime", "-t", since)
            .redirectErrorStream(true)
            .start()
        val reader = Executors.newSingleThreadExecutor()
        try {
            val f = reader.submit<String> {
                val cap = DiagnosticsPolicy.LOG_PLAYER_MAX_BYTES * 2
                val buf = java.io.ByteArrayOutputStream()
                val chunk = ByteArray(8192)
                p.inputStream.use { input ->
                    while (true) {
                        val n = input.read(chunk)
                        if (n < 0) break
                        buf.write(chunk, 0, n)
                        if (buf.size() > cap) break
                    }
                }
                buf.toString("UTF-8")
            }
            f.get(DiagnosticsPolicy.LOGCAT_TIMEOUT_MS, TimeUnit.MILLISECONDS)
        } finally {
            runCatching { p.destroy() }
            reader.shutdownNow()
        }
    }.getOrNull()
}
