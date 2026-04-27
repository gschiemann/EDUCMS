package com.educms.manager

import android.app.Application
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log

/**
 * Manager APK Application class. Kicks the WatchdogService into
 * foreground state on first launch and re-arms it across cold boots.
 *
 * Design note: Manager is a daemon, NOT a user-facing app. There's
 * no MainActivity; the only way Manager runs is:
 *   1. Receivers (BootReceiver) firing on system events
 *   2. WatchdogService kept alive by foreground notification
 *   3. Cross-process content provider reads from Player
 *
 * If the operator manually launches Manager from app settings,
 * onCreate fires here, we ensure the service is running, and the
 * launcher does nothing further.
 */
class ManagerApp : Application() {
    override fun onCreate() {
        super.onCreate()
        Log.i(TAG, "ManagerApp.onCreate — starting watchdog")
        startWatchdogService(this)
    }

    companion object {
        private const val TAG = "ManagerApp"

        /**
         * Launches WatchdogService as a foreground service. Called
         * from onCreate, BootReceiver, and AdminReceiver.onEnabled.
         * Idempotent — re-calls just bump the existing service.
         */
        fun startWatchdogService(ctx: Context) {
            val intent = Intent(ctx, WatchdogService::class.java)
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    ctx.startForegroundService(intent)
                } else {
                    ctx.startService(intent)
                }
            } catch (e: Exception) {
                Log.w(TAG, "startWatchdogService failed: ${e.message}", e)
            }
        }
    }
}
