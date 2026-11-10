package com.educms.player.health

/**
 * MEMORY PRESSURE — what the player does when Android says memory is short
 * (2026-11-09, player stability gap 1). Pure, so `MemoryPressurePolicyTest`
 * pins every rule.
 *
 * Before this file nothing in the APK listened for `onTrimMemory` /
 * `onLowMemory`: a box short of memory was only noticed after Android had
 * killed the process (`PLAYER_PROCESS_EXIT reason=3`).
 *
 * RULES:
 *  1. `TRIM_MEMORY_UI_HIDDEN` (20) is not pressure — it fires every time the
 *     panel goes dark or another app covers us. Ignored: not counted, no action.
 *  2. Every other level is RECORDED (count, highest level, last level and
 *     time) and reaches the server on the signed native heartbeat
 *     (`x-venueos-process-health`, `ProcessHealthReport`).
 *  3. Only REAL pressure frees memory: `RUNNING_CRITICAL` (15, the system is
 *     about to kill background work and then us), `COMPLETE` (80) and
 *     `onLowMemory` (read as 80). The action is the one thing we can rebuild
 *     for free: the player WebView's in-RAM HTTP cache (`clearCache(false)`).
 *     Never the disk cache, never the service worker, never the offline media
 *     cache, never the emergency tier, never a reload, never a page change.
 *     (Chromium already trims its own renderer on the same callbacks; this is
 *     the part only we can ask for.)
 *  4. At most one free per [FREE_COOLDOWN_MS]: a box that sits at critical
 *     must not clear its cache on every callback.
 *  5. NEVER while an emergency alert or hold is up, and never when that state
 *     cannot be read (`emergencyHeld == null` counts as held): the alert's
 *     page must not even re-fetch an image while it is on the glass.
 *  6. Kill switch: the server's `processHealth: "off"` (`PLAYER_PROCESS_HEALTH`)
 *     turns the free off; recording stays local.
 */
object MemoryPressurePolicy {

    const val RUNNING_MODERATE = 5
    const val RUNNING_LOW = 10
    const val RUNNING_CRITICAL = 15
    const val UI_HIDDEN = 20
    const val BACKGROUND = 40
    const val MODERATE = 60
    const val COMPLETE = 80

    /** `onLowMemory` is the pre-API-14 spelling of "complete". */
    const val LOW_MEMORY = COMPLETE

    const val FREE_COOLDOWN_MS = 10L * 60 * 1000

    enum class Action { IGNORE, RECORD, RECORD_AND_FREE }

    fun isPressure(level: Int): Boolean = level != UI_HIDDEN && level > 0

    fun isCritical(level: Int): Boolean = level == RUNNING_CRITICAL || level >= COMPLETE

    /**
     * @param emergencyHeld true / false from `DisplayEmergency.isHeld`; null when unreadable.
     * @param lastFreeAtMs elapsed-clock time of the last free, null if none in this process.
     */
    fun decide(
        level: Int,
        nowMs: Long,
        lastFreeAtMs: Long?,
        emergencyHeld: Boolean?,
        killSwitchOff: Boolean,
    ): Action {
        if (!isPressure(level)) return Action.IGNORE
        if (!isCritical(level)) return Action.RECORD
        if (killSwitchOff) return Action.RECORD
        if (emergencyHeld != false) return Action.RECORD
        if (lastFreeAtMs != null && nowMs - lastFreeAtMs < FREE_COOLDOWN_MS) return Action.RECORD
        return Action.RECORD_AND_FREE
    }

    /** What has happened in this process — the `mem` block of the report. */
    data class Record(
        val count: Int = 0,
        val maxLevel: Int = 0,
        val lastLevel: Int = 0,
        val lastAtMs: Long? = null,
        val frees: Int = 0,
        val lastFreeAtMs: Long? = null,
    )

    fun apply(record: Record, level: Int, nowMs: Long, action: Action): Record = when (action) {
        Action.IGNORE -> record
        Action.RECORD -> record.copy(
            count = record.count + 1,
            maxLevel = maxOf(record.maxLevel, level),
            lastLevel = level,
            lastAtMs = nowMs,
        )
        Action.RECORD_AND_FREE -> record.copy(
            count = record.count + 1,
            maxLevel = maxOf(record.maxLevel, level),
            lastLevel = level,
            lastAtMs = nowMs,
            frees = record.frees + 1,
            lastFreeAtMs = nowMs,
        )
    }

    fun line(level: Int, action: Action, record: Record): String =
        "PLAYER_MEMORY_PRESSURE level=$level action=${action.name.lowercase()} " +
            "count=${record.count} max=${record.maxLevel} frees=${record.frees}"
}
