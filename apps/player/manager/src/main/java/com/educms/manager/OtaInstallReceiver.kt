package com.educms.manager

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.util.Log
import com.educms.manager.rollback.InstallState
import org.json.JSONObject

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
                // v1.0.6 — operator: "we gave the player the allow
                // permissions when really it might be the manager
                // that needs to permissions". Architectural fix:
                // route through a full-screen-intent NOTIFICATION
                // (BAL-immune) → InstallPromptActivity (transparent
                // trampoline) → system Install dialog.
                //
                // Old code did context.startActivity(pendingIntent)
                // straight from this BroadcastReceiver. Android 11+
                // BAL silently drops Activity launches from non-
                // foregrounded contexts — Manager has no Activity
                // to be foregrounded, so the install prompt never
                // appeared. Operator saw "nothing happens".
                @Suppress("DEPRECATION")
                val pendingIntent: Intent? = intent.getParcelableExtra(Intent.EXTRA_INTENT)
                if (pendingIntent == null) {
                    Log.w(TAG, "STATUS_PENDING_USER_ACTION but no EXTRA_INTENT — install stalled")
                    InstallState.clearPending(context)
                    InstallTracker.clearPending(context)
                    reportInstallError(context, targetPackage, "Install stalled: user-action intent missing")
                    return
                }
                surfaceInstallPromptViaNotification(context, pendingIntent, targetPackage)
            }
            else -> {
                Log.e(TAG, "OTA install FAILED: ${statusName(status)} — $message")
                InstallState.clearPending(context)
                InstallTracker.clearPending(context)
                reportInstallError(
                    context,
                    targetPackage,
                    "Install failed: ${statusName(status)}${message?.let { " - $it" } ?: ""}",
                )
                // Phase 2: report ERROR state to API + trigger
                // rollback logic if we already removed the previous
                // APK from disk.
            }
        }
    }

    private fun reportInstallError(ctx: Context, targetPackage: String, reason: String) {
        try {
            val fp = readPlayerFingerprintFromHeartbeat(ctx)
                ?: ("android-" + (android.provider.Settings.Secure.getString(
                    ctx.contentResolver,
                    android.provider.Settings.Secure.ANDROID_ID,
                ).orEmpty()))
            if (fp.isBlank() || fp == "android-") return

            val url = java.net.URL("${BuildConfig.API_ROOT}/api/v1/screens/status/$fp/ota-state")
            val conn = (url.openConnection() as java.net.HttpURLConnection).apply {
                requestMethod = "POST"
                setRequestProperty("Content-Type", "application/json")
                doOutput = true
                connectTimeout = 5_000
                readTimeout = 5_000
            }
            val payload = JSONObject().apply {
                put("state", "ERROR")
                put("message", "$targetPackage: ${reason.take(360)}")
            }
            conn.outputStream.use { it.write(payload.toString().toByteArray()) }
            conn.responseCode
        } catch (_: Exception) { /* best-effort */ }
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

    /**
     * v1.0.6 — surface the system Install prompt via a high-priority
     * notification with `setFullScreenIntent`. Full-screen-intent
     * notifications are the documented Android pattern for "launch
     * an Activity from background" — they bypass BAL because the
     * user-tap (or auto-fire when screen is off) counts as user
     * interaction.
     *
     * The notification's contentIntent + fullScreenIntent both
     * point at InstallPromptActivity, which is a transparent
     * trampoline that:
     *   1. Checks install-unknown-apps permission, deep-links to
     *      Settings if missing
     *   2. Otherwise dispatches the system Install dialog from a
     *      foregrounded context (BAL satisfied)
     *   3. finishes() so the operator never sees Manager UI
     *
     * Notification copy is signage-friendly: explains that the
     * kiosk needs an action so the operator standing in front of
     * it doesn't ignore the prompt.
     */
    private fun surfaceInstallPromptViaNotification(
        ctx: android.content.Context,
        promptIntent: Intent,
        targetPackage: String,
    ) {
        // Trampoline Intent → InstallPromptActivity. We pass the
        // system's prompt Intent as an extra; the activity launches
        // it from its foregrounded context.
        val trampoline = Intent(ctx, InstallPromptActivity::class.java).apply {
            action = InstallPromptActivity.ACTION
            putExtra(InstallPromptActivity.EXTRA_INSTALL_PROMPT, promptIntent)
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or
                Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val pi = android.app.PendingIntent.getActivity(
            ctx,
            INSTALL_PROMPT_NOTIF_ID,
            trampoline,
            android.app.PendingIntent.FLAG_UPDATE_CURRENT or
                android.app.PendingIntent.FLAG_MUTABLE,
        )

        // Ensure the notification channel exists (idempotent).
        val nm = ctx.getSystemService(android.content.Context.NOTIFICATION_SERVICE)
            as android.app.NotificationManager
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
            val channel = android.app.NotificationChannel(
                INSTALL_PROMPT_CHANNEL,
                "EduCMS Updates",
                android.app.NotificationManager.IMPORTANCE_HIGH,
            ).apply {
                description = "Tap to install Player updates pushed from the dashboard."
            }
            nm.createNotificationChannel(channel)
        }

        val target = if (targetPackage.endsWith(".debug")) "Player (debug)" else "Player"
        val notification = androidx.core.app.NotificationCompat.Builder(ctx, INSTALL_PROMPT_CHANNEL)
            .setSmallIcon(android.R.drawable.stat_sys_download_done)
            .setContentTitle("EduCMS: install $target update")
            .setContentText("Tap to confirm installation. The screen needs this to receive updates.")
            .setPriority(androidx.core.app.NotificationCompat.PRIORITY_HIGH)
            .setCategory(androidx.core.app.NotificationCompat.CATEGORY_RECOMMENDATION)
            .setAutoCancel(true)
            .setContentIntent(pi)
            // setFullScreenIntent is the BAL-bypass primitive — fires
            // the activity directly when the screen is locked OR
            // gives the heads-up notification high priority when the
            // screen is on. Either way, the install dialog reaches
            // the operator.
            .setFullScreenIntent(pi, true)
            .build()

        try {
            nm.notify(INSTALL_PROMPT_NOTIF_ID, notification)
            Log.i(TAG, "install-prompt notification posted (BAL bypass via full-screen-intent)")
        } catch (e: Exception) {
            Log.e(TAG, "could not post install-prompt notification: ${e.message}", e)
            // Last-ditch fallback: try the direct startActivity. Will
            // fail on strict Android 11+ but works on permissive ROMs.
            try {
                promptIntent.flags = Intent.FLAG_ACTIVITY_NEW_TASK
                ctx.startActivity(promptIntent)
                Log.i(TAG, "fallback startActivity succeeded (permissive ROM)")
            } catch (ee: Exception) {
                Log.e(TAG, "fallback startActivity also failed: ${ee.message}", ee)
            }
        }
    }

    companion object {
        private const val TAG = "OtaInstallReceiver"
        private const val INSTALL_PROMPT_CHANNEL = "edu_install_prompt"
        private const val INSTALL_PROMPT_NOTIF_ID = 92481
    }
}
