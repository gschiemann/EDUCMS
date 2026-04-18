package com.educms.player

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

/**
 * Re-launches the player on device boot so wall-mounted signs come back automatically
 * after a power cycle. Honors several boot-completed actions for OEM compatibility.
 */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.action ?: return
        if (action !in BOOT_ACTIONS) return
        Log.i("BootReceiver", "Boot detected ($action) — launching player")

        val launch = Intent(context, PairingActivity::class.java).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP)
        }
        runCatching { context.startActivity(launch) }
            .onFailure { Log.w("BootReceiver", "startActivity failed", it) }
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
