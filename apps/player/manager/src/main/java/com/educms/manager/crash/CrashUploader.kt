package com.educms.manager.crash

import android.content.Context
import android.util.Log
import com.educms.manager.BuildConfig
import org.json.JSONObject
import java.io.PrintWriter
import java.io.StringWriter
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/**
 * Manager-side crash uploader. Mirror of Player's CrashUploader —
 * installs an UncaughtExceptionHandler, POSTs the trace to the same
 * /api/v1/screens/status/:fp/crash-report endpoint with
 * source="manager".
 *
 * The shared endpoint design lets the dashboard show a single
 * "last crash" timeline per kiosk regardless of which APK threw.
 * Source attribution comes from the body field, not separate routes.
 *
 * Manager uses the same Settings.Secure.ANDROID_ID-derived
 * fingerprint as Player (both apps signed with same key → same
 * scoped ID per Android 8+). So a Manager crash and a Player crash
 * on the same kiosk land on the same screens row — operator sees
 * "M43 crashed" not "M43 player crashed" + "M43 manager crashed".
 */
object CrashUploader {
    private const val TAG = "ManagerCrashUploader"
    private const val MAX_STACK_BYTES = 7 * 1024

    fun install(ctx: Context) {
        val previous = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, throwable ->
            try {
                uploadSync(ctx, throwable)
            } catch (e: Throwable) {
                Log.e(TAG, "crash upload threw: ${e.message}")
            }
            previous?.uncaughtException(thread, throwable)
        }
        Log.i(TAG, "crash handler installed (Manager ${BuildConfig.VERSION_NAME})")
    }

    private fun uploadSync(ctx: Context, t: Throwable) {
        val sw = StringWriter()
        t.printStackTrace(PrintWriter(sw))
        val stack = sw.toString().take(MAX_STACK_BYTES)
        val msg = (t.message ?: t::class.java.simpleName).take(500)

        val body = JSONObject().apply {
            put("source", "manager")
            put("versionName", BuildConfig.VERSION_NAME)
            put("versionCode", BuildConfig.VERSION_CODE)
            put("message", msg)
            put("stack", stack)
        }

        val apiRoot = BuildConfig.API_ROOT
        val fp = deriveFingerprint(ctx)

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
                Log.i(TAG, "crash uploaded (HTTP ${conn.responseCode}, fp=${fp.take(20)}…)")
            } catch (e: Throwable) {
                Log.w(TAG, "crash upload failed: ${e.message}")
            }
        }
        try { task.get(5, TimeUnit.SECONDS) } catch (_: Exception) { task.cancel(true) }
        exec.shutdownNow()
    }

    @Suppress("DEPRECATION")
    private fun deriveFingerprint(ctx: Context): String {
        val androidId = try {
            android.provider.Settings.Secure.getString(
                ctx.contentResolver,
                android.provider.Settings.Secure.ANDROID_ID,
            ) ?: ""
        } catch (_: Exception) { "" }
        return if (androidId.isNotBlank()) "android-$androidId" else "android-unknown"
    }
}
