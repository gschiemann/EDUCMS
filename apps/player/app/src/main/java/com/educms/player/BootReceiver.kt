package com.educms.player

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import com.educms.player.logging.PlayerLogger

/**
 * Re-launches the player on device boot so wall-mounted signs come back
 * automatically after a power cycle. Honors several boot-completed actions
 * for OEM compatibility (ACTION_BOOT_COMPLETED is the spec; QUICKBOOT_POWERON
 * variants are how HTC and some Chinese OEMs signal warm boot).
 *
 * Always routes to MainActivity. MainActivity hosts the WebView which itself
 * handles paired-vs-unpaired states — paired devices go straight to manifest;
 * unpaired devices show the 6-digit pairing code inside the WebView. There
 * is no longer a separate native PairingActivity (it got pinned as a default
 * LAUNCHER by some TV auto-launch utilities and ambushed operators with a
 * "type your code" keyboard prompt that the web player already obsoleted).
 */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.action ?: return
        if (action !in BOOT_ACTIONS) return
        Log.i("BootReceiver", "Boot detected ($action) — launching MainActivity")
        PlayerLogger.i("BootReceiver", "Boot completed ($action) — starting player services")

        // Bring up the foreground services BEFORE the activity so the
        // dashboard sees ONLINE the moment the kiosk boots, even if the
        // activity launch is briefly delayed by display init.
        com.educms.player.heartbeat.HeartbeatService.ensureRunning(context.applicationContext)
        com.educms.player.watchdog.Watchdog.arm(context.applicationContext)
        PlayerLogger.i("BootReceiver", "HeartbeatService and Watchdog armed")

        // 2026-04-28 — operator: 'i rebooted the player and nothing
        // fucking happened'. ROOT CAUSE: this BootReceiver did NOT
        // kick the OTA worker. WorkManager's periodic schedule uses
        // KEEP policy, so reboot kept the existing 6h cadence
        // instead of running a check immediately. Adding a one-shot
        // OTA fire here so every power-cycle starts a fresh check.
        // Defense in depth — Manager v1.0.2's BootReceiver fires
        // its own check, but if Manager isn't installed (legacy
        // kiosk) Player still gets the boot-time check.
        try {
            PlayerApp.fireOtaCheckNow(context.applicationContext)
            PlayerLogger.i("BootReceiver", "fired one-shot OTA check on boot")
        } catch (e: Exception) {
            PlayerLogger.w("BootReceiver", "fireOtaCheckNow failed on boot", e)
        }

        val launch = Intent(context, MainActivity::class.java).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP)
        }
        runCatching { context.startActivity(launch) }
            .onFailure {
                PlayerLogger.w("BootReceiver", "Failed to launch MainActivity on boot", it)
                Log.w("BootReceiver", "Failed to launch MainActivity on boot", it)
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
