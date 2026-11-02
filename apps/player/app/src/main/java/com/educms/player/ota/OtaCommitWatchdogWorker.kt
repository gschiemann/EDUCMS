package com.educms.player.ota

import android.content.Context
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import androidx.work.Data
import com.educms.player.BuildConfig
import com.educms.player.logging.PlayerLogger
import java.util.concurrent.TimeUnit

/**
 * 1.1.56 — a committed update whose PackageInstaller status never came back.
 *
 * Field (Android 9 panels): the session was committed, no status broadcast
 * ever arrived, the dashboard sat on INSTALLING and the Back menu never got
 * its "Install v…" button. [OtaAttemptPolicy.COMMIT_STATUS_GRACE_MS] after
 * every commit this one-shot, LOCAL check (no network but the state report)
 * turns such a commit into NEEDS_TAP. If the build landed, the new process
 * runs this with a newer BuildConfig and it does nothing.
 */
class OtaCommitWatchdogWorker(ctx: Context, params: WorkerParameters) : Worker(ctx, params) {
    override fun doWork(): Result {
        val vc = inputData.getInt(KEY_VC, 0)
        if (vc <= 0) return Result.success()
        val ctx = applicationContext
        val attempt = OtaAttemptStore.read(ctx)
        val record = PendingInstallStore.read(ctx)
        val dialogOpen = record != null && PendingInstallConfirmation.isFresh(
            record, System.currentTimeMillis(), android.os.SystemClock.elapsedRealtime(),
        )
        if (!OtaAttemptPolicy.stalledCommit(attempt, vc, BuildConfig.VERSION_CODE, dialogOpen)) return Result.success()
        OtaAttemptStore.recordOutcome(ctx, vc, OtaAttemptPolicy.Outcome.NEEDS_TAP)
        val target = attempt?.versionName?.let { "v$it" } ?: "the update"
        PlayerLogger.w(TAG, "own update $target: no install status after ${OtaAttemptPolicy.COMMIT_STATUS_GRACE_MS / 1000}s — offering the Install button")
        OtaStateReporter.report(ctx, "NEEDS_TAP", null, OtaAttemptPolicy.stagedNeedsTapMessage(target))
        return Result.success()
    }

    companion object {
        private const val TAG = "OtaCommitWatchdog"
        private const val KEY_VC = "versionCode"
        private const val WORK = "edu-ota-commit-watchdog"

        fun schedule(ctx: Context, versionCode: Int) {
            runCatching {
                val req = OneTimeWorkRequestBuilder<OtaCommitWatchdogWorker>()
                    .setInitialDelay(OtaAttemptPolicy.COMMIT_STATUS_GRACE_MS, TimeUnit.MILLISECONDS)
                    .setInputData(Data.Builder().putInt(KEY_VC, versionCode).build())
                    .build()
                WorkManager.getInstance(ctx.applicationContext).enqueueUniqueWork(WORK, ExistingWorkPolicy.REPLACE, req)
            }.onFailure { PlayerLogger.w(TAG, "could not schedule: ${it.message}") }
        }
    }
}
