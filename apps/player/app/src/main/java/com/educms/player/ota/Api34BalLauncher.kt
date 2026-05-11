package com.educms.player.ota

import android.annotation.SuppressLint
import android.app.ActivityOptions
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.annotation.RequiresApi
import com.educms.player.logging.PlayerLogger

/**
 * API-34 BAL-allowed activity launcher for Player's own
 * PostInstallRelaunchWorker. Sister class of Manager's Api34BalLauncher.
 *
 * Same Android 14 BAL tightening applies to Player: when the worker
 * fires post-install (cold-started by JobScheduler in a fresh process
 * with no foreground activity), a direct startActivity call is BAL-
 * blocked. PendingIntent + ActivityOptions.MODE_BACKGROUND_ACTIVITY_START_ALLOWED
 * is the documented bypass.
 *
 * Isolated in @RequiresApi(34) object so older Android ART never tries
 * to resolve setPendingIntentBackgroundActivityStartMode at class-load
 * time — same VerifyError-safety pattern as Api31SilentInstall.
 */
@RequiresApi(Build.VERSION_CODES.UPSIDE_DOWN_CAKE)
object Api34BalLauncher {

    private const val TAG = "Api34BalLauncher"

    @SuppressLint("NewApi")
    fun launchAllowingBackgroundStart(ctx: Context, launchIntent: Intent) {
        val pi = PendingIntent.getActivity(
            ctx,
            0,
            launchIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val options = ActivityOptions.makeBasic()
            .setPendingIntentBackgroundActivityStartMode(
                ActivityOptions.MODE_BACKGROUND_ACTIVITY_START_ALLOWED,
            )
        try {
            pi.send(ctx, 0, null, null, null, null, options.toBundle())
            PlayerLogger.i(TAG, "BAL-allowed PendingIntent.send dispatched for ${launchIntent.`package`}")
        } catch (e: PendingIntent.CanceledException) {
            PlayerLogger.w(TAG, "PendingIntent canceled: ${e.message}")
            ctx.startActivity(launchIntent)
        }
    }
}
