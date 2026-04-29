package com.educms.player.ota

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import com.educms.player.logging.PlayerLogger
import org.json.JSONObject

/**
 * Catches the PackageInstaller.Session commit result and logs it.
 *
 * When PackageInstaller runs in confirm-required mode (non-device-owner
 * kiosks) it sends back an Intent carrying EXTRA_STATUS +
 * EXTRA_STATUS_MESSAGE and, if user consent is needed,
 * Intent.EXTRA_INTENT — a new ACTION_VIEW the user must approve.
 *
 * For completed installs, the result lands here with STATUS_SUCCESS;
 * we relaunch the Player so the kiosk does not strand itself on the
 * OEM launcher after the operator taps Install.
 */
class OtaInstallReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, -999)
        val msg = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE) ?: ""
        when (status) {
            PackageInstaller.STATUS_PENDING_USER_ACTION -> {
                // 2026-04-28 (v1.0.22) — Android specialist audit found
                // Goodview Android 11's BAL (Background Activity Launch)
                // restrictions silently block startActivity() calls from
                // BroadcastReceivers on stripped signage ROMs. THIS is
                // why bundled-Manager-install has been silently failing
                // since v1.0.13 — STATUS_PENDING_USER_ACTION fires, our
                // receiver tries startActivity, OS blocks it without
                // throwing, no system Install prompt appears.
                //
                // Fix: trampoline through MainActivity (a foregrounded
                // user-visible Activity, satisfies BAL). MainActivity's
                // onNewIntent handler launches the Install prompt from
                // the foreground task chain.
                val confirm = intent.getParcelableExtra<Intent>(Intent.EXTRA_INTENT)
                if (confirm == null) {
                    PlayerLogger.w(TAG, "STATUS_PENDING_USER_ACTION but no EXTRA_INTENT")
                    reportOtaError(context, "Install stalled: user-action intent missing")
                    return
                }
                // Diagnostic: log component + resolveActivity result so
                // the dashboard / logcat shows whether Goodview's ROM
                // even has a system PackageInstaller activity registered.
                val resolved = try { confirm.resolveActivity(context.packageManager) } catch (_: Exception) { null }
                PlayerLogger.i(
                    TAG,
                    "PENDING_USER_ACTION received. component=${confirm.component} " +
                    "data=${confirm.data} package=${confirm.`package`} resolves=$resolved",
                )
                // Route through MainActivity trampoline. FLAG_ACTIVITY_NEW_TASK
                // + FLAG_ACTIVITY_SINGLE_TOP so we reuse the existing
                // MainActivity instance instead of spawning a duplicate.
                val trampoline = Intent(context, com.educms.player.MainActivity::class.java).apply {
                    action = ACTION_LAUNCH_INSTALL_PROMPT
                    putExtra(EXTRA_INSTALL_PROMPT, confirm)
                    flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
                }
                try {
                    context.startActivity(trampoline)
                    PlayerLogger.i(TAG, "trampoline through MainActivity dispatched")
                } catch (ex: Exception) {
                    PlayerLogger.e(TAG, "trampoline launch failed", ex)
                }
            }
            PackageInstaller.STATUS_SUCCESS -> {
                PlayerLogger.i(TAG, "OTA install: SUCCESS; relaunching Player")
                val pending = goAsync()
                Thread {
                    try {
                        relaunchSelf(context)
                    } finally {
                        pending.finish()
                    }
                }.start()
            }
            PackageInstaller.STATUS_FAILURE,
            PackageInstaller.STATUS_FAILURE_ABORTED,
            PackageInstaller.STATUS_FAILURE_BLOCKED,
            PackageInstaller.STATUS_FAILURE_CONFLICT,
            PackageInstaller.STATUS_FAILURE_INCOMPATIBLE,
            PackageInstaller.STATUS_FAILURE_INVALID,
            PackageInstaller.STATUS_FAILURE_STORAGE -> {
                PlayerLogger.w(TAG, "OTA install FAILED (status=$status): $msg")
                reportOtaError(context, "Install failed: ${statusName(status)}${if (msg.isNotBlank()) " - $msg" else ""}")
            }
            else -> {
                PlayerLogger.w(TAG, "OTA install: unknown status=$status msg=$msg")
                reportOtaError(context, "Install returned unknown status=$status${if (msg.isNotBlank()) " - $msg" else ""}")
            }
        }
    }

    private fun reportOtaError(context: Context, message: String) {
        try {
            val prefs = context.getSharedPreferences("edu_player", Context.MODE_PRIVATE)
            val apiRoot = prefs.getString("api_root", null) ?: return
            val fp = prefs.getString("device_fingerprint", null) ?: return
            val url = java.net.URL("$apiRoot/api/v1/screens/status/$fp/ota-state")
            val conn = (url.openConnection() as java.net.HttpURLConnection).apply {
                requestMethod = "POST"
                setRequestProperty("Content-Type", "application/json")
                doOutput = true
                connectTimeout = 5_000
                readTimeout = 5_000
            }
            val payload = JSONObject().apply {
                put("state", "ERROR")
                put("message", message.take(400))
            }
            conn.outputStream.use { it.write(payload.toString().toByteArray()) }
            conn.responseCode
        } catch (_: Exception) { /* best-effort */ }
    }

    private fun relaunchSelf(context: Context) {
        for (attempt in 0..7) {
            try {
                val launch = context.packageManager.getLaunchIntentForPackage(context.packageName)
                if (launch != null) {
                    launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
                    context.startActivity(launch)
                    PlayerLogger.i(TAG, "Player relaunched after OTA install (attempt=$attempt)")
                    return
                }
            } catch (ex: Exception) {
                PlayerLogger.w(TAG, "Player relaunch failed (attempt=$attempt): ${ex.message}")
            }
            try {
                Thread.sleep(1000)
            } catch (_: InterruptedException) {
                break
            }
        }
        reportOtaError(context, "Install succeeded but Player did not relaunch; reboot or open EduCMS Player")
    }

    private fun statusName(status: Int): String = when (status) {
        PackageInstaller.STATUS_FAILURE -> "FAILURE"
        PackageInstaller.STATUS_FAILURE_ABORTED -> "FAILURE_ABORTED"
        PackageInstaller.STATUS_FAILURE_BLOCKED -> "FAILURE_BLOCKED"
        PackageInstaller.STATUS_FAILURE_CONFLICT -> "FAILURE_CONFLICT"
        PackageInstaller.STATUS_FAILURE_INCOMPATIBLE -> "FAILURE_INCOMPATIBLE"
        PackageInstaller.STATUS_FAILURE_INVALID -> "FAILURE_INVALID"
        PackageInstaller.STATUS_FAILURE_STORAGE -> "FAILURE_STORAGE"
        else -> "UNKNOWN($status)"
    }

    companion object {
        private const val TAG = "OtaInstallReceiver"
        const val ACTION_LAUNCH_INSTALL_PROMPT = "com.educms.player.LAUNCH_INSTALL_PROMPT"
        const val EXTRA_INSTALL_PROMPT = "install_prompt_intent"
    }
}
