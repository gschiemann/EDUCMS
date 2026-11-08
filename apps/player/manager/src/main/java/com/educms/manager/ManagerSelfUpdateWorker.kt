package com.educms.manager

import android.content.Context
import android.util.Log
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters

/**
 * RETIRED (2026-11-08, one release unit) — kept only as a WorkManager landing
 * pad for the periodic job Manager ≤ 1.0.24 persisted under
 * `edu-manager-self-update-periodic`. WorkManager keeps enqueued work across
 * an app update and needs the worker class to exist to run — or cancel — it;
 * a missing class is logged as an error on every tick. [ManagerApp] cancels
 * the legacy names on every boot; until that cancel lands, this worker does
 * nothing and returns success.
 *
 * What it USED to do, and why that was wrong: it polled
 * `/api/v1/player/manager-update-check` every 30 minutes and installed the
 * newest `manager-v*` GitHub release over itself. Publishing a Manager tag was
 * therefore a fleet-wide push within half an hour, outside every gate the
 * Player's update ladder applies (field window, tracked push, canary, one
 * hardware class, off-hours). The Manager now reaches a screen only inside
 * the Player APK, installed by the Player when the bundled versionCode is
 * newer than the installed one — [ManagerUpdatePolicy] is the rule.
 *
 * The 2026-10-04 "no digest, no install" fix (a5c820ba7) that lived here is
 * moot: this worker installs nothing. The same rule still guards the one
 * install path left in this module, OtaWorker's bootstrap.
 */
class ManagerSelfUpdateWorker(
    ctx: Context,
    params: WorkerParameters,
) : CoroutineWorker(ctx, params) {

    override suspend fun doWork(): Result {
        if (ManagerUpdatePolicy.selfUpdateRetired) {
            Log.i(TAG, "self-update lane is retired — the Player carries and installs the Manager; nothing to do")
            return Result.success()
        }
        return Result.success()
    }

    companion object {
        private const val TAG = "ManagerSelfUpdate"
    }
}
