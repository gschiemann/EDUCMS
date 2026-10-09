package com.educms.player.heartbeat

/** Explicit power-on only. No timer, stale status or content failure may create a wake. */
object NativePowerOnPolicy {
    const val MAX_ATTEMPTS = 3
    const val RETRY_GAP_MS = 30_000L
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

    fun beforeApply(command: String, memory: Memory, nowElapsedMs: Long, standbyIdentity: String? = null): Memory = Memory(
        command = command,
        attempts = if (command == memory.command) memory.attempts + 1 else 1,
        lastAttemptElapsedMs = nowElapsedMs,
        acknowledged = memory.acknowledged,
        standbyIdentity = standbyIdentity,
        suppressed = memory.suppressed,
    )
}
