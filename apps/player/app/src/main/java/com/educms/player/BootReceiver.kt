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
        //
        // v1.0.62 — for MY_PACKAGE_REPLACED, the receiver CANNOT launch
        // an activity directly (Android 14 BAL grants the receiver a
        // 20-second FGS-only exemption, not an activity-launch one). The
        // FGS we start here DOES inherit the BAL grant, so we tag the
        // start intent EXTRA_LAUNCH_MAIN=true and let HeartbeatService
        // do the activity launch from inside its onStartCommand where
        // the grant is honored. For BOOT_COMPLETED variants the
        // receiver's own startActivity at the bottom of this method
        // still works (BOOT_COMPLETED IS on the activity-launch
        // exemption list), so we only use the trampoline for the
        // upgrade path.
        if (action == Intent.ACTION_MY_PACKAGE_REPLACED) {
            com.educms.player.heartbeat.HeartbeatService.ensureRunningAndLaunchMain(
                context.applicationContext,
            )
        } else {
            com.educms.player.heartbeat.HeartbeatService.ensureRunning(context.applicationContext)
        }
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

        // For MY_PACKAGE_REPLACED the activity launch was already routed
        // through HeartbeatService above (BAL workaround). For real boot
        // actions this direct startActivity is fine — the receiver gets
        // the activity-launch BAL exemption from BOOT_COMPLETED.
        if (action != Intent.ACTION_MY_PACKAGE_REPLACED) {
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
    }

    companion object {
        private val BOOT_ACTIONS = setOf(
            Intent.ACTION_BOOT_COMPLETED,
            Intent.ACTION_LOCKED_BOOT_COMPLETED,
            "android.intent.action.QUICKBOOT_POWERON",
            "com.htc.intent.action.QUICKBOOT_POWERON",
            // v1.0.61 — also catch Player upgrades. Manifest filter is in
            // AndroidManifest.xml; explanation of why this fixes the
            // "didnt relaunch the app" complaint lives there too. We
            // intentionally route into the same boot path because
            // "Player upgraded itself" needs the same wake-up sequence
            // as "device just booted": foreground services, OTA check,
            // and MainActivity launch. Treating them identically also
            // means any future boot-time work (e.g. emergency cache
            // rehydrate) happens after upgrade automatically.
            Intent.ACTION_MY_PACKAGE_REPLACED,
        )
    }
}
