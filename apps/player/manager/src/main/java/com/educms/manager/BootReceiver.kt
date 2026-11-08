package com.educms.manager

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

/**
 * Boot receiver — fires when the Android device finishes booting
 * (or a Quickboot variant on OEM signage boards).
 *
 * Job: start WatchdogService so Manager's whole reason for existing
 * (keep Player alive) is on the rails as soon as possible after
 * boot. WatchdogService in turn launches the Player MainActivity if
 * it's not already running.
 *
 * Why both Player and Manager have BootReceivers: redundancy. If
 * Manager's receiver fails (uncommon but happens on some OEM ROMs
 * that whitelist receivers), Player still gets up. If Player's
 * fails, Manager catches it.
 */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        Log.i(TAG, "BootReceiver fired (action=${intent.action})")
        // Always start the watchdog first so Player liveness
        // monitoring is on the rails before anything else.
        ManagerApp.startWatchdogService(context)

        // 2026-04-28 — operator: 'i rebooted the player and nothing
        // fucking happened... we are 16 versions of the player in
        // and i asked for OTA on the first version'.
        //
        // The single biggest reason power-cycling didn't recover:
        // BootReceiver did NOT kick the OTA workers. The periodic
        // schedule has KEEP semantics, so it stuck on whatever
        // 6h cadence was last enqueued — reboot didn't re-fire it.
        //
        // Fix: kick BOTH OTA workers immediately on boot so a
        // power-cycled kiosk picks up any pending update within
        // ~90s of network coming online (the worker's network
        // constraint waits for connectivity, which is correct).
        //
        // Player lane: bootstraps a Player onto a kiosk that has none.
        // (The Manager's own self-update lane is RETIRED, 2026-11-08: the
        // Manager ships inside the Player APK and the Player installs it —
        // ManagerUpdatePolicy. ManagerApp cancels the old periodic job.)
        ManagerApp.triggerImmediateOtaCheck(context)
        Log.i(TAG, "BootReceiver kicked the Player-OTA (bootstrap) worker")
    }

    companion object {
        private const val TAG = "BootReceiver"
    }
}
