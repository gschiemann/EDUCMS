package com.educms.player.display

/**
 * The dead-man revert record — the single most safety-critical value in
 * this package.
 *
 * ─────────────────────────────────────────────────────────────────────
 * THE CONTRACT
 * ─────────────────────────────────────────────────────────────────────
 * An operator-initiated TEST action ("show me what 20% looks like",
 * "blank it so I can confirm which screen this is") carries a
 * `revertAfterMs`. Before that action is applied, [DisplayGuard]:
 *
 *   1. snapshots the state we are about to leave,
 *   2. writes THIS record to SharedPreferences with `commit()` —
 *      SYNCHRONOUSLY, the one place in this codebase where deviating
 *      from the repo's `apply()` convention is not just acceptable but
 *      required, because the entire point is surviving a process kill
 *      between the write and the apply,
 *   3. only then applies the action.
 *
 * On the next process start the record is replayed: if it is already due
 * the prior state is restored immediately, otherwise the alarm is
 * re-armed. So a process death, an OOM kill, an OTA restart or a full
 * reboot mid-test all end with the screen back the way the operator
 * found it.
 *
 * ─────────────────────────────────────────────────────────────────────
 * WHY A HAND-ROLLED FORMAT AND NOT JSON
 * ─────────────────────────────────────────────────────────────────────
 * This record is read on the boot path of a wall-mounted screen, and it
 * is the thing that un-blanks a display nobody can reach. `org.json` is
 * part of `android.jar`, which means it is STUBBED in JVM unit tests —
 * a JSON record could not have a test that proves round-tripping works
 * without pulling a third-party parser into the shipped APK. A fixed
 * five-field pipe-delimited line has no parser, cannot throw, and is
 * fully testable on a plain JVM. Unknown/short/garbage input decodes to
 * null, which the guard treats as "nothing pending".
 *
 * Format (v1):  `v1|CAPABILITY|priorPercent|priorBlanked|dueAtEpochMs`
 */
data class PendingRevert(
    val capability: Capability,
    /** Brightness or volume percent to restore. Ignored for BLANK/WAKE. */
    val priorPercent: Int,
    /** Whether the screen was blanked before the action. */
    val priorBlanked: Boolean,
    /** Wall-clock epoch millis at which the revert is due. */
    val dueAtEpochMs: Long,
) {
    fun isDue(nowMs: Long): Boolean = nowMs >= dueAtEpochMs

    /** The action that puts the screen back the way we found it. */
    fun revertAction(): DisplayAction = when (capability) {
        Capability.VOLUME -> DisplayAction.SetVolume(priorPercent)
        Capability.BRIGHTNESS ->
            // allowBlack: the PRIOR state is by definition a state the
            // screen was already in, so restoring it is safe even when
            // it is below MIN_SAFE (e.g. an overnight 0% poster the
            // operator tested a brightness bump against).
            DisplayAction.SetBrightness(priorPercent, allowBlack = true)
        Capability.BLANK, Capability.WAKE ->
            if (priorBlanked) DisplayAction.Blank else DisplayAction.Wake
        // A reboot cannot be un-done; the guard never arms one, and this
        // branch exists only so `when` stays exhaustive.
        Capability.REBOOT -> DisplayAction.Wake
    }

    fun encode(): String =
        listOf(
            VERSION,
            capability.name,
            priorPercent.toString(),
            if (priorBlanked) "1" else "0",
            dueAtEpochMs.toString(),
        ).joinToString(SEP)

    companion object {
        private const val VERSION = "v1"
        private const val SEP = "|"

        /**
         * Decode a persisted record. Returns null for anything this
         * build does not fully understand — a record we cannot parse
         * must never be acted on, and "nothing pending" is the safe
         * reading (the screen simply keeps whatever state it has rather
         * than being driven somewhere by a half-read record).
         */
        fun decode(raw: String?): PendingRevert? {
            val line = raw?.trim()
            if (line.isNullOrEmpty()) return null
            val parts = line.split(SEP)
            if (parts.size != 5) return null
            if (parts[0] != VERSION) return null
            val capability = Capability.values().firstOrNull { it.name == parts[1] } ?: return null
            val percent = parts[2].toIntOrNull() ?: return null
            if (percent < 0 || percent > 100) return null
            val blanked = when (parts[3]) {
                "1" -> true
                "0" -> false
                else -> return null
            }
            val due = parts[4].toLongOrNull() ?: return null
            if (due <= 0L) return null
            return PendingRevert(capability, percent, blanked, due)
        }
    }
}
