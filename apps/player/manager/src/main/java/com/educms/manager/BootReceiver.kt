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
        ManagerApp.startWatchdogService(context)
    }

    companion object {
        private const val TAG = "BootReceiver"
    }
}
