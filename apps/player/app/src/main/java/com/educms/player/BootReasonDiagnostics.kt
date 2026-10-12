package com.educms.player

import android.app.ActivityManager
import android.content.Context
import android.os.Build
import android.os.SystemClock
import com.educms.player.logging.PlayerLogger

/**
 * WHY DID THE BOX (OR THE PROCESS) START? — `PLAYER_BOOT_REASON` (2026-10-12).
 *
 * The L55VEC rebooted ≈13 s after an emergency wake and the device log could
 * only say "uptime 43 s, boot count +1". Android records the answer in system
 * properties the bootloader / init set (`ro.boot.bootreason`,
 * `sys.boot.reason`, `persist.sys.boot.reason`, Amlogic's
 * `ro.boot.reboot_mode`) — `watchdog`, `kernel_panic`, `reboot,…`, `cold`.
 * They are readable by any app through the hidden `android.os.SystemProperties`;
 * reflection is best-effort and a ROM that blocks it just logs `unreadable`.
 *
 * Also the previous process's most recent `ApplicationExitInfo`, whatever its
 * reason (ProcessExitDiagnostics keeps only the crash-like ones): a box reset
 * often records nothing at all, and "nothing" is itself the evidence.
 *
 * Runs once per process start, from `PlayerApp.onCreate`. Never throws.
 */
object BootReasonDiagnostics {

    private const val TAG = "BootReason"

    fun record(ctx: Context) {
        runCatching {
            val props = BootReasonPolicy.PROPERTIES.associateWith { readProperty(it) }
            PlayerLogger.i(TAG, BootReasonPolicy.propertiesLine(SystemClock.elapsedRealtime(), props))
        }.onFailure { PlayerLogger.w(TAG, "boot reason unavailable: ${it.javaClass.simpleName}") }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            runCatching {
                val am = ctx.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager ?: return@runCatching
                val last = am.getHistoricalProcessExitReasons(ctx.packageName, 0, 1).firstOrNull()
                PlayerLogger.i(
                    TAG,
                    if (last == null) {
                        BootReasonPolicy.noPreviousExitLine()
                    } else {
                        BootReasonPolicy.previousExitLine(last.timestamp, last.reason, last.status, last.description)
                    },
                )
            }.onFailure { PlayerLogger.w(TAG, "previous exit unavailable: ${it.javaClass.simpleName}") }
        }
    }

    /** `android.os.SystemProperties.get(key)` by reflection; null when unreadable. */
    @android.annotation.SuppressLint("PrivateApi")
    private fun readProperty(key: String): String? = runCatching {
        val cls = Class.forName("android.os.SystemProperties")
        cls.getMethod("get", String::class.java).invoke(null, key) as? String
    }.getOrNull()
}

/** The pure half — formatting and sanitising, with a JVM test. */
object BootReasonPolicy {

    val PROPERTIES = listOf(
        "ro.boot.bootreason",
        "sys.boot.reason",
        "sys.boot.reason.last",
        "persist.sys.boot.reason",
        "ro.boot.reboot_mode",
    )

    const val VALUE_CAP = 96

    /** Printable ASCII, no spaces (one token), capped. Null → `unreadable`, blank → `unset`. */
    fun sanitize(raw: String?): String {
        if (raw == null) return "unreadable"
        val v = raw.replace(Regex("[^\\x21-\\x7E]"), "_").trim('_').take(VALUE_CAP)
        return if (v.isEmpty()) "unset" else v
    }

    fun propertiesLine(uptimeMs: Long, props: Map<String, String?>): String =
        "PLAYER_BOOT_REASON uptimeMs=$uptimeMs " + props.entries.joinToString(" ") { "${it.key}=${sanitize(it.value)}" }

    /** `ApplicationExitInfo.REASON_*` names, literal so the JVM test needs no SDK. */
    fun reasonName(reason: Int): String = when (reason) {
        0 -> "unknown"
        1 -> "exit-self"
        2 -> "signaled"
        3 -> "low-memory"
        4 -> "crash"
        5 -> "crash-native"
        6 -> "anr"
        7 -> "initialization-failure"
        8 -> "permission-change"
        9 -> "excessive-resource-usage"
        10 -> "user-requested"
        11 -> "user-stopped"
        12 -> "dependency-died"
        13 -> "other"
        14 -> "freezer"
        15 -> "package-state-change"
        16 -> "package-updated"
        else -> "reason-$reason"
    }

    fun previousExitLine(timestamp: Long, reason: Int, status: Int, description: String?): String {
        val desc = ProcessExitPolicy.sanitizeDescription(description)
        return "PLAYER_BOOT_REASON prevExit at=$timestamp reason=$reason(${reasonName(reason)}) status=$status" +
            if (desc.isEmpty()) "" else " desc=\"$desc\""
    }

    fun noPreviousExitLine(): String =
        "PLAYER_BOOT_REASON prevExit=none — the OS recorded no exit for the previous process (a box reset usually records none)"
}
