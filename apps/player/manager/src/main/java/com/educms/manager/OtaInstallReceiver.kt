package com.educms.manager

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.util.Log

/**
 * Catches the PackageInstaller.Session result for OTA installs
 * fired by OtaInstaller.
 *
 * Possible outcomes:
 *   STATUS_SUCCESS              — install landed; new Player APK
 *                                 ready, will boot itself in moments
 *   STATUS_FAILURE_*            — install rejected (signature
 *                                 mismatch, storage full, malformed
 *                                 APK, etc.). Phase 2 triggers
 *                                 rollback here.
 *   STATUS_PENDING_USER_ACTION  — Manager isn't device owner; system
 *                                 needs the operator to tap "Install"
 *                                 on a system prompt. We launch the
 *                                 prompt activity; on unattended
 *                                 kiosks this still gets us nowhere
 *                                 but it's the documented fallback.
 *
 * Phase 1: just log every outcome and report state to the API
 * (existing /api/v1/screens/:fp/ota-state endpoint shipped in
 * v1.0.12). Rollback logic comes in Phase 2.
 */
class OtaInstallReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val sessionId = intent.getIntExtra(OtaInstaller.EXTRA_SESSION_ID, -1)
        val targetPackage = intent.getStringExtra(OtaInstaller.EXTRA_TARGET_PACKAGE) ?: "(unknown)"
        val status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, -999)
        val message = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE)

        Log.i(
            TAG,
            "install result: sessionId=$sessionId target=$targetPackage status=${statusName(status)} message=$message",
        )

        when (status) {
            PackageInstaller.STATUS_SUCCESS -> {
                Log.i(TAG, "OTA install SUCCESS for $targetPackage — relaunching")
                // 2026-04-28 — operator: 'i hit yes and it then closed
                // the app and ttok me to the android app screen, never
                // relanched the app'. Cause: PackageInstaller doesn't
                // auto-launch the freshly-installed app.
                //
                // Regression-audit B1 fix: relaunch retry loop now uses
                // goAsync() so we don't block the receiver dispatch
                // thread for ~7s (would ANR on slow Goodview SoCs).
                // The PendingResult lets the system know we're working
                // asynchronously, keeps our process alive long enough
                // for the retry + telemetry POST to complete.
                if (targetPackage != context.packageName) {
                    val pending = goAsync()
                    Thread {
                        try {
                            relaunchPackage(context, targetPackage)
                        } finally {
                            pending.finish()
                        }
                    }.start()
                }
                // Phase 2: report INSTALLED state to API + clear
                // any "pending update" flags we tracked locally.
            }
            PackageInstaller.STATUS_PENDING_USER_ACTION -> {
                // Fallback path when not provisioned as DEVICE_OWNER.
                // The system needs the operator to tap "Install" on
                // a confirmation prompt; relaunching that prompt is
                // the documented dance.
                @Suppress("DEPRECATION")
                val pendingIntent: Intent? = intent.getParcelableExtra(Intent.EXTRA_INTENT)
                if (pendingIntent != null) {
                    pendingIntent.flags = Intent.FLAG_ACTIVITY_NEW_TASK
                    try {
                        context.startActivity(pendingIntent)
                        Log.i(TAG, "launched system Install prompt (kiosk needs DEVICE_OWNER for silent install)")
                    } catch (e: Exception) {
                        Log.e(TAG, "could not launch install prompt: ${e.message}", e)
                    }
                } else {
                    Log.w(TAG, "STATUS_PENDING_USER_ACTION but no EXTRA_INTENT — install stalled")
                }
            }
            else -> {
                Log.e(TAG, "OTA install FAILED: ${statusName(status)} — $message")
                // Phase 2: report ERROR state to API + trigger
                // rollback logic if we already removed the previous
                // APK from disk.
            }
        }
    }

    /**
     * Launch the freshly-installed package's main activity. Used
     * after STATUS_SUCCESS so the kiosk wakes back up to running
     * Player instead of getting stranded on the OEM home launcher.
     *
     * Tries production then debug variant, since Manager handles
     * both com.educms.player and com.educms.player.debug.
     *
     * 2026-04-28 — UX audit P1-D fix: Slow Goodview SoCs take 2-8s
     * AFTER STATUS_SUCCESS fires before the new APK's launch
     * activity is registered with PackageManager. The original
     * single-attempt code race-failed on those boards: STATUS_SUCCESS
     * → getLaunchIntentForPackage returns null → "kiosk stays on
     * home" → operator stuck on the launcher with no recovery.
     *
     * Now: retry up to 6 times with 1s backoff (≤7s wall clock).
     * Posts an ERROR state to the API on final failure so the
     * dashboard surfaces "Installed but did not relaunch — power-
     * cycle required" instead of the misleading "timeout".
     */
    private fun relaunchPackage(ctx: Context, pkg: String) {
        val candidates = listOf(pkg, "$pkg.debug")
        for (attempt in 0..5) {
            for (candidate in candidates) {
                try {
                    val launch = ctx.packageManager.getLaunchIntentForPackage(candidate)
                    if (launch != null) {
                        launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
                        ctx.startActivity(launch)
                        Log.i(TAG, "relaunched $candidate after successful install (attempt=$attempt)")
                        return
                    }
                } catch (e: Exception) {
                    Log.w(TAG, "relaunch $candidate failed (attempt=$attempt): ${e.message}")
                }
            }
            try { Thread.sleep(1000) } catch (_: InterruptedException) { /* swallow */ }
        }
        Log.w(TAG, "all relaunch attempts failed — kiosk stranded on home, will rely on watchdog")
        // Best-effort: tell the API so the dashboard surfaces "Installed
        // but did not relaunch" instead of "timeout". We're already on
        // the goAsync() background thread (caller wraps us in
        // Thread{}.start in onReceive), so no need to spawn another.
        //
        // Regression-audit B5 fix: read Player's fingerprint from
        // PlayerHealthProvider rather than Manager's own ANDROID_ID.
        // Player's screen row uses Player's ANDROID_ID (different from
        // Manager's per Android-8+ scoping). POSTing with Manager's
        // fingerprint goes to a row that doesn't exist → 404, dashboard
        // never sees the "stranded" state.
        try {
            val fp = readPlayerFingerprintFromHeartbeat(ctx)
                ?: ("android-" + (android.provider.Settings.Secure.getString(
                    ctx.contentResolver, android.provider.Settings.Secure.ANDROID_ID,
                ).orEmpty()))
            if (fp.isNotBlank() && fp != "android-") {
                val url = java.net.URL("${BuildConfig.API_ROOT}/api/v1/screens/status/$fp/ota-state")
                val conn = (url.openConnection() as java.net.HttpURLConnection).apply {
                    requestMethod = "POST"
                    setRequestProperty("Content-Type", "application/json")
                    doOutput = true
                    connectTimeout = 5_000
                    readTimeout = 5_000
                }
                val payload = """{"state":"ERROR","message":"Installed v$pkg but did not relaunch — power-cycle required"}"""
                conn.outputStream.use { it.write(payload.toByteArray()) }
                conn.responseCode  // force-flush
            }
        } catch (_: Exception) { /* best-effort */ }
    }

    /** Read Player's deviceFingerprint via the cross-process heartbeat
     *  provider so OTA telemetry hits the same Screen row Player
     *  populated. Returns null if the provider isn't reachable or
     *  hasn't been written by Player v1.0.18+ yet. */
    private fun readPlayerFingerprintFromHeartbeat(ctx: Context): String? {
        return try {
            val uri = android.net.Uri.parse("content://${PlayerHealthProvider.AUTHORITY}/heartbeat")
            ctx.contentResolver.query(uri, null, null, null, null)?.use { c ->
                if (!c.moveToFirst()) return null
                val idx = c.getColumnIndex(PlayerHealthProvider.COL_FINGERPRINT)
                if (idx < 0) return null
                val fp = c.getString(idx)
                if (fp.isNullOrBlank()) null else fp
            }
        } catch (_: Exception) { null }
    }

    private fun statusName(status: Int): String = when (status) {
        PackageInstaller.STATUS_SUCCESS -> "SUCCESS"
        PackageInstaller.STATUS_FAILURE -> "FAILURE"
        PackageInstaller.STATUS_FAILURE_ABORTED -> "FAILURE_ABORTED"
        PackageInstaller.STATUS_FAILURE_BLOCKED -> "FAILURE_BLOCKED"
        PackageInstaller.STATUS_FAILURE_CONFLICT -> "FAILURE_CONFLICT"
        PackageInstaller.STATUS_FAILURE_INCOMPATIBLE -> "FAILURE_INCOMPATIBLE (signature mismatch?)"
        PackageInstaller.STATUS_FAILURE_INVALID -> "FAILURE_INVALID"
        PackageInstaller.STATUS_FAILURE_STORAGE -> "FAILURE_STORAGE"
        PackageInstaller.STATUS_PENDING_USER_ACTION -> "PENDING_USER_ACTION"
        else -> "UNKNOWN($status)"
    }

    companion object {
        private const val TAG = "OtaInstallReceiver"
    }
}
