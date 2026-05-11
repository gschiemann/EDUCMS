package com.educms.manager

import android.annotation.SuppressLint
import android.app.ActivityOptions
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log
import androidx.annotation.RequiresApi

/**
 * API-34 (Android 14 / UpsideDownCake) BAL-allowed activity launcher.
 *
 * Android 14 tightened Background Activity Launch rules. Apps with a
 * foreground service no longer automatically get BAL exemption — the
 * grace window closed ~10s after the FGS started. Beyond that, a
 * non-foregrounded caller MUST explicitly opt in via:
 *
 *   ActivityOptions.makeBasic()
 *     .setPendingIntentBackgroundActivityStartMode(MODE_BACKGROUND_ACTIVITY_START_ALLOWED)
 *
 * passed to PendingIntent.send().
 *
 * Why isolated in @RequiresApi(34) object: same VerifyError safety as
 * Api31SilentInstall / Api34UpdateOwnership. The setPendingIntentBackgroundActivityStartMode
 * symbol is API 34+. Loading it on older Android would crash class
 * verification at process start.
 *
 * Call site (PackageReplacedReceiver.relaunchPackage):
 *
 *   if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
 *       Api34BalLauncher.launchAllowingBackgroundStart(ctx, launchIntent)
 *   } else {
 *       ctx.startActivity(launchIntent)
 *   }
 *
 * 2026-05-12 (Manager v1.0.18) — added after debugging The Den's
 * post-install relaunch failure. Stock Android 14 emulator reproduced
 * the bug; logcat showed "BAL blocked allowsBackgroundActivityStarts=false".
 */
@RequiresApi(Build.VERSION_CODES.UPSIDE_DOWN_CAKE)
object Api34BalLauncher {

    private const val TAG = "Api34BalLauncher"

    @SuppressLint("NewApi")
    fun launchAllowingBackgroundStart(ctx: Context, launchIntent: Intent) {
        // Use a PendingIntent + ActivityOptions with BAL allowed. This
        // is the documented Android 14+ pattern for activity launch
        // from a non-foregrounded caller.
        val pi = PendingIntent.getActivity(
            ctx,
            // requestCode 0 — only one outstanding relaunch PI at a time.
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
            Log.i(TAG, "BAL-allowed PendingIntent.send dispatched for ${launchIntent.`package`}")
        } catch (e: PendingIntent.CanceledException) {
            Log.w(TAG, "PendingIntent canceled: ${e.message}")
            // Fallback to direct startActivity. Will likely also be BAL-blocked
            // but logged so we know the PI path failed too.
            ctx.startActivity(launchIntent)
        }
    }
}
