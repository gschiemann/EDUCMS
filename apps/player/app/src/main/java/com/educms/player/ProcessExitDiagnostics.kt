package com.educms.player

import android.app.ActivityManager
import android.app.ApplicationExitInfo
import android.content.Context
import android.os.Build
import com.educms.player.logging.PlayerLogger

/** OS evidence covers native/ANR/low-memory exits that a JVM handler cannot see. */
object ProcessExitDiagnostics {
    fun recordPreviousExit(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return
        runCatching {
            val manager = context.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager ?: return
            val prefs = context.getSharedPreferences("process_exit_diagnostics", Context.MODE_PRIVATE)
            val recordedAt = prefs.getLong("recordedAt", 0)
            val failures = setOf(ApplicationExitInfo.REASON_CRASH, ApplicationExitInfo.REASON_CRASH_NATIVE,
                ApplicationExitInfo.REASON_ANR, ApplicationExitInfo.REASON_LOW_MEMORY)
            val exits = manager.getHistoricalProcessExitReasons(context.packageName, 0, 8)
                .filter { it.timestamp > recordedAt && it.reason in failures }.sortedBy { it.timestamp }
            exits.forEach {
                // Do not upload descriptions, stack traces or URLs from other processes.
                PlayerLogger.e("ProcessExit", "PLAYER_PROCESS_EXIT at=${it.timestamp} reason=${it.reason} status=${it.status} pssKb=${it.pss} rssKb=${it.rss}")
            }
            exits.lastOrNull()?.let { prefs.edit().putLong("recordedAt", it.timestamp).commit() }
        }.onFailure { PlayerLogger.w("ProcessExit", "OS exit diagnostics unavailable: ${it.javaClass.simpleName}") }
    }
}
