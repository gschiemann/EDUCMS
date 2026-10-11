package com.educms.player.heartbeat

/** Explicit power-on only. No timer, stale status or content failure may create a wake. */
object NativePowerOnPolicy {
    const val MAX_ATTEMPTS = 3
    const val RETRY_GAP_MS = 30_000L

    /**
     * How long after its last local attempt an unacknowledged power-on is
     * still "awaiting proof" (2026-10-11).
     *
     * THE BUG THIS CLOSES. The server re-sends a power-on for only five
     * minutes (`NATIVE_POWER_ON_TTL_MS`), and while the page is reporting for
     * itself the native heartbeat ticks only every five minutes
     * (`HeartbeatService.WEB_REPORTING_FLOOR_MS`). When the live page consumed
     * the command (the push path), the next native tick usually arrived after
     * the server had stopped sending it, so nothing ever compared "Android is
     * interactive and the player is in front" against it: VisionCore's X80
     * woke on 2026-10-09 and never acknowledged. Within this window the
     * heartbeat stays at full cadence and may acknowledge the command it
     * already applied without the server repeating it. Same boot only.
     */
    const val ACK_WINDOW_MS = 10L * 60_000L
    private val identity = Regex("^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$")

    data class Memory(
        val command: String? = null,
        val attempts: Int = 0,
        val lastAttemptElapsedMs: Long = 0L,
        val acknowledged: String? = null,
        val standbyIdentity: String? = null,
        val suppressed: String? = null,
    )

    /** A provider accepting Wake is not proof that Android or the player resumed. */
    fun mayAcknowledge(command: String?, memory: Memory, interactive: Boolean?, foreground: Boolean): Boolean =
        command != null && identity.matches(command) && command == memory.command &&
            memory.attempts > 0 && command != memory.acknowledged && command != memory.suppressed &&
            interactive == true && foreground

    /** Last command wins: a new physical OFF cancels retries of an older ON. */
    fun supersededByStandby(command: String?, memory: Memory, currentStandbyIdentity: String?): Boolean =
        command != null && command == memory.command && memory.attempts > 0 &&
            currentStandbyIdentity != null && currentStandbyIdentity != memory.standbyIdentity

    fun mayApply(command: String?, memory: Memory, nowElapsedMs: Long): Boolean {
        if (command == null || !identity.matches(command) || command == memory.acknowledged || command == memory.suppressed) return false
        if (command != memory.command) return true
        if (memory.attempts >= MAX_ATTEMPTS) return false
        val since = nowElapsedMs - memory.lastAttemptElapsedMs
        // A device reboot resets elapsedRealtime. The server still bounds
        // the command's lifetime; a kiosk wall clock is never compared.
        return since < 0 || since >= RETRY_GAP_MS
    }

    /**
     * The command this device already applied and has not yet proven, or null.
     * It never authorises another wake ([mayApply] still governs that); it only
     * keeps the heartbeat listening and lets [mayAcknowledge] run on a reply
     * that no longer carries the command. A reboot (elapsed clock went
     * backwards) or an old attempt yields null: a panel that is on after a
     * reboot proves nothing about this command.
     */
    fun awaitingProof(memory: Memory, nowElapsedMs: Long): String? {
        val c = memory.command ?: return null
        if (!identity.matches(c) || memory.attempts <= 0) return null
        if (c == memory.acknowledged || c == memory.suppressed) return null
        val since = nowElapsedMs - memory.lastAttemptElapsedMs
        return if (since in 0..ACK_WINDOW_MS) c else null
    }

    fun beforeApply(command: String, memory: Memory, nowElapsedMs: Long, standbyIdentity: String? = null): Memory = Memory(
        command = command,
        attempts = if (command == memory.command) memory.attempts + 1 else 1,
        lastAttemptElapsedMs = nowElapsedMs,
        acknowledged = memory.acknowledged,
        standbyIdentity = standbyIdentity,
        suppressed = memory.suppressed,
    )
}
