package com.educms.manager

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import androidx.work.Constraints
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager

/**
 * Listens for the cross-app broadcast Player sends when it receives
 * a `CHECK_FOR_UPDATES` message from the dashboard's WebSocket.
 *
 * Player flow:
 *   1. Web player receives signed CHECK_FOR_UPDATES via WS
 *   2. Calls EduCmsNative.checkForUpdates() (existing JS bridge)
 *   3. PlayerApp.fireOtaCheckNow() runs (existing — kicks Player's
 *      own OtaUpdateWorker for the legacy non-Manager path)
 *   4. ALSO sends a broadcast targeted at Manager so Manager's
 *      silent-install path runs in parallel
 *
 * If both Player's worker and Manager's worker run, the dashboard
 * just gets two attempts — the first one to install wins, the
 * second sees "already up to date" and exits cleanly. No conflict.
 *
 * The broadcast carries no payload; the trigger itself is the
 * signal. Manager runs its standard update-check flow (same API
 * endpoints Player uses).
 */
class OtaTriggerReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        Log.i(TAG, "OTA trigger received from Player — enqueuing OtaWorker")
        try {
            val constraints = Constraints.Builder()
                .setRequiredNetworkType(NetworkType.CONNECTED)
                .build()
            val req = OneTimeWorkRequestBuilder<OtaWorker>()
                .setConstraints(constraints)
                .build()
            // REPLACE — if a previous on-demand check is still running,
            // fold the new request into it (the worker is idempotent;
            // running it twice in quick succession just produces two
            // identical update-check API calls).
            WorkManager.getInstance(context).enqueueUniqueWork(
                "edu-manager-ota-now",
                ExistingWorkPolicy.REPLACE,
                req,
            )
            Log.i(TAG, "OtaWorker (one-time) enqueued")
        } catch (e: Exception) {
            Log.w(TAG, "fireOtaCheckNow failed: ${e.message}", e)
        }
    }

    companion object {
        private const val TAG = "OtaTriggerReceiver"
        const val ACTION = "com.educms.manager.TRIGGER_OTA_CHECK"
    }
}
