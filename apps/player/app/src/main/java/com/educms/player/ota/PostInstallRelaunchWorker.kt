package com.educms.player.ota

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.educms.player.MainActivity
import com.educms.player.logging.PlayerLogger
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
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
 *
 * 2026-09-01 — THE LAUNCH ITSELF MOVED TO [RelaunchEscalation]. Two panels
 * on the live fleet ran this worker after an OTA and stayed on the OEM
 * launcher: `startActivity` from a background process is SILENTLY dropped
 * on Android 10+ unless the app is HOME, holds SYSTEM_ALERT_WINDOW, or
 * is/has a device owner — no exception, so this worker logged "relaunched
 * ..." and returned success over a screen that never came back. The call is
 * unchanged (same intent, same flags, same API-34 BAL path); what is new is
 * that something now PROVES it landed and says so honestly when it did not.
 * One implementation, two callers — the other is HeartbeatService's
 * EXTRA_LAUNCH_MAIN branch.
 */
class PostInstallRelaunchWorker(
    ctx: Context,
    params: WorkerParameters,
) : CoroutineWorker(ctx, params) {

    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        val ctx = applicationContext
        // 2026-09-01 (TC22 F1) — THIS RUNG IS THE ONE THAT BURIED THE
        // COMPANION-UPGRADE DIALOG. It fires +60 s after the player install
        // commits, which is the exact window in which `ManagerBootstrap`
        // raises the system "Update VenueOS Manager?" confirmation. The
        // escalation ladder now stands down on its own, but returning here
        // is cheaper AND avoids sitting on the process for the 18 s
        // settle-delay below for a rung we know will do nothing.
        //
        // Two facts, never one: already on glass, or holding a prompt we
        // put there ourselves. Neither is a stranded screen.
        if (MainActivity.isInForeground || MainActivity.installPromptOutstanding) {
            PlayerLogger.i(
                TAG,
                "post-install relaunch safety-net skipped — " +
                    "foreground=${MainActivity.isInForeground} " +
                    "installPromptOutstanding=${MainActivity.installPromptOutstanding}",
            )
            return@withContext Result.success()
        }
        PlayerLogger.i(TAG, "post-install relaunch safety-net firing")
        RelaunchEscalation.attempt(ctx, SOURCE)
        // Stay alive across the escalation window. `doWork` returning is a
        // licence for the OS to kill this process, and the follow-up checks
        // are pending Handler callbacks — a killed process drops them
        // silently, which is the same class of invisible failure this whole
        // change exists to end. A ~16 s hold is nothing against
        // WorkManager's 10-minute ceiling.
        delay(RelaunchEscalation.ESCALATION_WINDOW_MS + SETTLE_MARGIN_MS)
        Result.success()
    }

    companion object {
        private const val TAG = "PostInstallRelaunch"

        /** Names this rung in the field log. */
        private const val SOURCE = "post-install-worker"

        /** Slack so the final check has actually run before we let go. */
        private const val SETTLE_MARGIN_MS = 2_000L
    }
}
