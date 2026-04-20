package com.educms.player

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch

/**
 * Re-launches the player on device boot so wall-mounted signs come back automatically
 * after a power cycle. Honors several boot-completed actions for OEM compatibility.
 *
 * Routes intelligently: if the device already has a pairing token, jumps straight
 * into the kiosk MainActivity. If not, opens PairingActivity so the operator can
 * enter a code. Either way the screen comes alive automatically — no human touch
 * needed after the wall switch flips.
 */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.action ?: return
        if (action !in BOOT_ACTIONS) return
        Log.i("BootReceiver", "Boot detected ($action) — routing to player")

        // Bring up the foreground services BEFORE the activity so the
        // dashboard sees ONLINE the moment the kiosk boots, even if the
        // activity launch is briefly delayed by display init.
        com.educms.player.heartbeat.HeartbeatService.ensureRunning(context.applicationContext)
        com.educms.player.watchdog.Watchdog.arm(context.applicationContext)

        // Async lookup — DataStore is suspend-only. Use a goAsync pattern via
        // a one-shot coroutine; BroadcastReceiver lifecycle gives us ~10s.
        val pendingResult = goAsync()
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val token = DeviceStore(context.applicationContext).deviceToken.first()
                val target = if (token.isNullOrBlank()) {
                    PairingActivity::class.java
                } else {
                    MainActivity::class.java
                }
                val launch = Intent(context, target).apply {
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP)
                }
                context.startActivity(launch)
                Log.i("BootReceiver", "Launched ${target.simpleName}")
            } catch (t: Throwable) {
                Log.w("BootReceiver", "Failed to launch player on boot", t)
            } finally {
                pendingResult.finish()
            }
        }
    }

    companion object {
        private val BOOT_ACTIONS = setOf(
            Intent.ACTION_BOOT_COMPLETED,
            Intent.ACTION_LOCKED_BOOT_COMPLETED,
            "android.intent.action.QUICKBOOT_POWERON",
            "com.htc.intent.action.QUICKBOOT_POWERON",
        )
    }
}
