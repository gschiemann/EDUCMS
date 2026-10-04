package com.educms.player

import android.app.ActivityManager
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
            val exits = manager.getHistoricalProcessExitReasons(context.packageName, 0, 8)
                .filter { it.timestamp > recordedAt && ProcessExitPolicy.keep(it.reason) }.sortedBy { it.timestamp }
            exits.forEach {
                // Our own process's exits only (packageName), capped at 8. The
                // description is SANITISED and capped — never a stack trace,
                // never a URL (ProcessExitPolicy.sanitizeDescription).
                PlayerLogger.e(
                    "ProcessExit",
                    ProcessExitPolicy.line(
                        timestamp = it.timestamp,
                        reason = it.reason,
                        status = it.status,
                        importance = it.importance,
                        pssKb = it.pss,
                        rssKb = it.rss,
                        description = it.description,
                    ),
                )
            }
            exits.lastOrNull()?.let { prefs.edit().putLong("recordedAt", it.timestamp).commit() }
        }.onFailure { PlayerLogger.w("ProcessExit", "OS exit diagnostics unavailable: ${it.javaClass.simpleName}") }
    }
}

/**
 * Which process exits are worth a log line, and what the line says — pure, so
 * it has a JVM test (review P2-7, 2026-10-03).
 *
 * THE GAP. Only crash, native crash, ANR and low-memory exits were kept. OEM
 * killers — and lmkd on devices without kill reporting — show up as
 * `REASON_SIGNALED` (status 9), and the X80 failure in Cleveland may be one of
 * those, so the box could die every ten minutes and leave NOTHING here.
 * `EXCESSIVE_RESOURCE_USAGE`, `OTHER` and `FREEZER` were dropped too, and so
 * were the `description` and `importance` fields that say who killed it.
 *
 * Reason codes are `ApplicationExitInfo.REASON_*`, written as literals:
 * `REASON_FREEZER` is API 33 and these boxes run API 30. The test pins every
 * literal against the SDK constant.
 */
object ProcessExitPolicy {

    const val REASON_SIGNALED = 2
    const val REASON_LOW_MEMORY = 3
    const val REASON_CRASH = 4
    const val REASON_CRASH_NATIVE = 5
    const val REASON_ANR = 6
    const val REASON_EXCESSIVE_RESOURCE_USAGE = 9
    const val REASON_OTHER = 13
    const val REASON_FREEZER = 14

    /** Every exit that is not the user, not us, and not an update. */
    val KEPT: Set<Int> = setOf(
        REASON_CRASH,
        REASON_CRASH_NATIVE,
        REASON_ANR,
        REASON_LOW_MEMORY,
        REASON_SIGNALED,
        REASON_EXCESSIVE_RESOURCE_USAGE,
        REASON_OTHER,
        REASON_FREEZER,
    )

    /** Longest description we keep — enough for "Killing … (adj 900): …". */
    const val DESCRIPTION_CAP = 160

    fun keep(reason: Int): Boolean = reason in KEPT

    /**
     * The system-written description, made safe for a log that leaves the
     * device: URLs removed, whitespace collapsed, only printable ASCII kept,
     * capped at [DESCRIPTION_CAP]. Null/blank → "".
     */
    fun sanitizeDescription(raw: String?): String {
        if (raw.isNullOrBlank()) return ""
        return raw
            .replace(Regex("[a-zA-Z][a-zA-Z0-9+.-]*://\\S+"), "[url]")
            .replace(Regex("[^\\x20-\\x7E]"), " ")
            .replace(Regex("\\s+"), " ")
            .trim()
            .take(DESCRIPTION_CAP)
    }

    fun line(
        timestamp: Long,
        reason: Int,
        status: Int,
        importance: Int,
        pssKb: Long,
        rssKb: Long,
        description: String?,
    ): String {
        val desc = sanitizeDescription(description)
        return "PLAYER_PROCESS_EXIT at=$timestamp reason=$reason status=$status importance=$importance " +
            "pssKb=$pssKb rssKb=$rssKb" + if (desc.isEmpty()) "" else " desc=\"$desc\""
    }
}
