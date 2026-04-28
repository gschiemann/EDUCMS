package com.educms.player.ota

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import com.educms.player.logging.PlayerLogger

/**
 * Catches the PackageInstaller.Session commit result and logs it.
 *
 * When PackageInstaller runs in confirm-required mode (non-device-owner
 * kiosks) it sends back an Intent carrying EXTRA_STATUS +
 * EXTRA_STATUS_MESSAGE and, if user consent is needed,
 * Intent.EXTRA_INTENT — a new ACTION_VIEW the user must approve.
 *
 * For silent installs on provisioned kiosks (pm set-installer) the
 * result lands here with STATUS_SUCCESS and no intent to relaunch.
 * Either way we log the outcome so the field operator has a record.
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
            PackageInstaller.STATUS_SUCCESS ->
                PlayerLogger.i(TAG, "OTA install: SUCCESS — new APK active after next process start")
            PackageInstaller.STATUS_FAILURE,
            PackageInstaller.STATUS_FAILURE_ABORTED,
            PackageInstaller.STATUS_FAILURE_BLOCKED,
            PackageInstaller.STATUS_FAILURE_CONFLICT,
            PackageInstaller.STATUS_FAILURE_INCOMPATIBLE,
            PackageInstaller.STATUS_FAILURE_INVALID,
            PackageInstaller.STATUS_FAILURE_STORAGE ->
                PlayerLogger.w(TAG, "OTA install FAILED (status=$status): $msg")
            else ->
                PlayerLogger.w(TAG, "OTA install: unknown status=$status msg=$msg")
        }
    }
    companion object {
        private const val TAG = "OtaInstallReceiver"
        const val ACTION_LAUNCH_INSTALL_PROMPT = "com.educms.player.LAUNCH_INSTALL_PROMPT"
        const val EXTRA_INSTALL_PROMPT = "install_prompt_intent"
    }
}
