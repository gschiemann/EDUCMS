package com.educms.player.ota

import android.content.Context
import android.content.Intent
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.educms.player.logging.PlayerLogger
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * PostInstallRelaunchWorker — defensive safety net that re-launches Player
 * after an OTA install, even when Manager's PackageReplacedReceiver fails
 * to relaunch us.
 *
 * Operator (2026-05-12): "wasnt silent, didnt relaunch the app after i
 * clicked install, the download said it was at 87% and then the install
 * window popped up... i launched the app manually and i was on .54"
 *
 * Why this exists:
 *
 *   The canonical relaunch path is:
 *     PackageInstaller → STATUS_SUCCESS → OtaInstallReceiver → MainActivity
 *   ...but that fires inside the OLD Player process which Android kills
 *   when replacing the APK. On Goodview ROMs the SUCCESS callback often
 *   doesn't arrive at the dying process or arrives too late.
 *
 *   Manager has a PackageReplacedReceiver that catches the system-wide
 *   ACTION_PACKAGE_REPLACED broadcast and tries to relaunch Player from
 *   its own process. THIS DIDN'T WORK on The Den — the user landed on
 *   the launcher screen and had to open Player manually.
 *
 *   This worker is a belt-and-suspenders THIRD path: enqueued BEFORE the
 *   PackageInstaller commit, fires ~60 seconds later, just calls
 *   getLaunchIntentForPackage + startActivity. By the time it runs:
 *     - If the install succeeded silently, Player's already running
 *       (the new Player's own scheduled workers, including this one,
 *       run in the new process). Launching the singleTask MainActivity
 *       again is a no-op.
 *     - If the install needed a user tap and the user has tapped,
 *       Player got replaced. WorkManager honors the work request
 *       across the package replace because it persists to disk.
 *       The NEW Player's WorkManager runs this worker → launches
 *       MainActivity → kiosk wakes up.
 *     - If the install failed entirely, Player is still running,
 *       launch is again a no-op.
 *
 * Why WorkManager and not AlarmManager:
 *
 *   WorkManager's persistence layer survives package replace; the
 *   queued work is honored by the new APK's WorkManager. AlarmManager
 *   also survives, but Android 12+ requires SCHEDULE_EXACT_ALARM for
 *   exact-time delivery and inexact alarms can drift up to 9 minutes —
 *   too imprecise for a relaunch nudge.
 */
class PostInstallRelaunchWorker(
    ctx: Context,
    params: WorkerParameters,
) : CoroutineWorker(ctx, params) {

    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        val ctx = applicationContext
        PlayerLogger.i(TAG, "post-install relaunch safety-net firing")
        val pm = ctx.packageManager
        val launch = pm.getLaunchIntentForPackage(ctx.packageName)
        if (launch == null) {
            PlayerLogger.w(TAG, "no launch intent for ${ctx.packageName} — broken install?")
            return@withContext Result.success()
        }
        launch.addFlags(
            Intent.FLAG_ACTIVITY_NEW_TASK or
                Intent.FLAG_ACTIVITY_CLEAR_TOP or
                Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED,
        )
        try {
            ctx.startActivity(launch)
            PlayerLogger.i(TAG, "relaunched ${ctx.packageName} via PostInstallRelaunchWorker")
        } catch (e: Exception) {
            // BAL or no-foreground gate hit — log and move on. Manager's
            // PackageReplacedReceiver + WatchdogService are the other
            // recovery paths.
            PlayerLogger.w(TAG, "post-install relaunch startActivity failed: ${e.message}")
        }
        Result.success()
    }

    companion object {
        private const val TAG = "PostInstallRelaunch"
    }
}
