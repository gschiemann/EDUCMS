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
                PlayerLogger.i(TAG, "OTA install: pending user confirmation — launching system prompt")
                val confirm = intent.getParcelableExtra<Intent>(Intent.EXTRA_INTENT)
                if (confirm != null) {
                    confirm.flags = Intent.FLAG_ACTIVITY_NEW_TASK
                    try {
                        context.startActivity(confirm)
                    } catch (ex: Exception) {
                        PlayerLogger.w(TAG, "OTA install: failed to launch confirmation intent", ex)
                    }
                } else {
                    PlayerLogger.w(TAG, "OTA install: STATUS_PENDING_USER_ACTION but no EXTRA_INTENT")
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
    companion object { private const val TAG = "OtaInstallReceiver" }
}
