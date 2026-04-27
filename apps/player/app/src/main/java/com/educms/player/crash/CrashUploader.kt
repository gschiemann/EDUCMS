package com.educms.player.crash

import android.content.Context
import android.util.Log
import com.educms.player.BuildConfig
import org.json.JSONObject
import java.io.PrintWriter
import java.io.StringWriter
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/**
 * Player-side crash uploader. Installs an UncaughtExceptionHandler
 * that captures fatal Kotlin/Java exceptions, POSTs them to
 * /api/v1/screens/status/:fp/crash-report, and rethrows so the OS's
 * default handler still kills the process normally.
 *
 * Why in-house instead of Sentry NDK:
 *   - Project policy in CLAUDE.md: no commercial vendors until funding
 *   - We only need three things — see the crash, attribute to a
 *     versionCode, correlate to a screen — all of which fit in the
 *     existing /screens row.
 *   - Sentry NDK is also for NATIVE crashes (SIGSEGV in JNI). We
 *     don't currently use any native code in Player, so the JVM-only
 *     handler covers 100% of our actual crash surface.
 *
 * Limitations (acknowledged):
 *   - Doesn't capture native crashes (no JNI in Player today, so this
 *     is a non-issue). If we add native code later, we'd add tombstone
 *     reading on next-boot.
 *   - Doesn't capture ANRs (Application Not Responding events). Those
 *     need watchdog-style detection — Manager's WatchdogService
 *     already handles "Player isn't heartbeating" which is essentially
 *     ANR + crash + everything else lumped together.
 *
 * Network is best-effort with a hard 5s timeout. The handler must
 * complete fast — we're already in a "process is about to die" state;
 * blocking longer just delays the user-visible crash by that long.
 */
object CrashUploader {
    private const val TAG = "CrashUploader"

    /**
     * Install the handler. Wraps any pre-existing handler so the
     * default kill-process-and-show-dialog behavior still runs.
     * Called once from PlayerApp.onCreate.
     */
    fun install(ctx: Context, getApiRoot: () -> String, getFingerprint: () -> String) {
        val previous = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, throwable ->
            try {
                uploadSync(ctx, getApiRoot(), getFingerprint(), throwable)
            } catch (e: Throwable) {
                Log.e(TAG, "crash upload threw: ${e.message}")
            }
            // Always rethrow to the default handler — its job is to
            // kill the process and let Android's normal restart logic
            // take over. NEVER swallow the original throwable.
            previous?.uncaughtException(thread, throwable)
        }
        Log.i(TAG, "crash handler installed (Player ${BuildConfig.VERSION_NAME})")
    }

    private fun uploadSync(ctx: Context, apiRoot: String, fp: String, t: Throwable) {
        val sw = StringWriter()
        t.printStackTrace(PrintWriter(sw))
        val stack = sw.toString().take(MAX_STACK_BYTES)
        val msg = (t.message ?: t::class.java.simpleName).take(500)

        val body = JSONObject().apply {
            put("source", "player")
            put("versionName", BuildConfig.VERSION_NAME)
            put("versionCode", BuildConfig.VERSION_CODE)
            put("message", msg)
            put("stack", stack)
        }

        // Run the network call on a separate thread with a tight
        // timeout — we're in the uncaught-exception path; blocking
        // the dying thread risks ANRing the OS's "App has stopped"
        // dialog. 5s is enough for a fast network, falls through
        // silently on a slow one.
        val exec = Executors.newSingleThreadExecutor()
        val task = exec.submit {
            try {
                val url = URL("$apiRoot/api/v1/screens/status/$fp/crash-report")
                val conn = (url.openConnection() as HttpURLConnection).apply {
                    requestMethod = "POST"
                    setRequestProperty("Content-Type", "application/json")
                    doOutput = true
                    connectTimeout = 3_000
                    readTimeout = 3_000
                }
                conn.outputStream.use { it.write(body.toString().toByteArray()) }
                val rc = conn.responseCode
                Log.i(TAG, "crash uploaded (HTTP $rc, fp=${fp.take(20)}…)")
            } catch (e: Throwable) {
                Log.w(TAG, "crash upload failed: ${e.message}")
            }
        }
        try { task.get(5, TimeUnit.SECONDS) } catch (_: Exception) { task.cancel(true) }
        exec.shutdownNow()
    }

    private const val MAX_STACK_BYTES = 7 * 1024  // < server's 8KB cap
}
