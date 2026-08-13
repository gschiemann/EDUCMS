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
 * ⚠️  ONE RECORD PER CAPABILITY — WHY THIS IS A SET, NOT A SLOT
 * ─────────────────────────────────────────────────────────────────────
 * v1 stored exactly ONE record. Two overlapping tests destroyed each
 * other, and the failure mode was a permanently dark wall-mounted
 * screen:
 *
 *   * Operator presses Blank (60 s dead-man). Record = {BLANK,
 *     priorBlanked=false}. Panel goes off.
 *   * Ten seconds later they drag the brightness slider — the natural
 *     "is it just dim?" reflex. v1's `arm()` OVERWROTE the single slot
 *     with {BRIGHTNESS, priorBlanked=**true**}: it snapshotted the
 *     state the FIRST action had already produced and called it "prior".
 *   * The BLANK record no longer exists, so nothing ever wakes the
 *     panel. Truck roll.
 *
 * The trivially-reachable variant needed no second capability at all:
 * pressing Blank twice made the second `arm()` snapshot
 * priorBlanked=true, so the revert re-applied Blank forever.
 *
 * Two rules kill both, and [DisplayGuard] enforces them:
 *
 *   1. Records are keyed by [Capability] and stored as a SET. A revert
 *      for one capability can never destroy another's.
 *   2. Re-arming a capability that already has an outstanding record
 *      PRESERVES the original snapshot (only the due time moves out).
 *      The first snapshot is the only one taken before we changed
 *      anything, so it is the only true "prior".
 *
 * ─────────────────────────────────────────────────────────────────────
 * WHO OWNS THE BLANK STATE
 * ─────────────────────────────────────────────────────────────────────
 * [ownsBlankState] exists because a BRIGHTNESS record's [priorBlanked]
 * is only trustworthy when it was captured while nothing else was
 * outstanding. With two records in flight, restoring blank state from
 * BOTH of them re-introduces the same class of bug in a new order:
 * the BLANK revert wakes the screen at T+60, then the BRIGHTNESS
 * revert's stale `priorBlanked=true` blacks it out again at T+70 with
 * no record left to undo it.
 *
 * So exactly one record may drive on/off:
 *   * a BLANK/WAKE record always owns it (that IS its capability);
 *   * a BRIGHTNESS record owns it only when it was the sole record at
 *     arm time;
 *   * a VOLUME record never owns it.
 *
 * ─────────────────────────────────────────────────────────────────────
 * WHY A HAND-ROLLED FORMAT AND NOT JSON
 * ─────────────────────────────────────────────────────────────────────
 * This record is read on the boot path of a wall-mounted screen, and it
 * is the thing that un-blanks a display nobody can reach. `org.json` is
 * part of `android.jar`, which means it is STUBBED in JVM unit tests —
 * a JSON record could not have a test that proves round-tripping works
 * without pulling a third-party parser into the shipped APK. A fixed
 * pipe-delimited line has no parser, cannot throw, and is fully
 * testable on a plain JVM. Unknown/short/garbage input decodes to null,
 * which the guard treats as "nothing pending".
 *
 * Format (v2):  `v2|CAPABILITY|priorPercent|priorBlanked|dueAtEpochMs|ownsBlankState`
 * Format (v1):  `v1|CAPABILITY|priorPercent|priorBlanked|dueAtEpochMs`
 *
 * v1 still decodes — a device that took this APK while a v1 record was
 * on disk must still get its screen back. v1's `ownsBlankState` is
 * derived as "BLANK/WAKE only", which is byte-for-byte what v1 did.
 * Multiple records are stored one per LINE.
 */
data class PendingRevert(
    val capability: Capability,
    /** Brightness or volume percent to restore. Ignored for BLANK/WAKE. */
    val priorPercent: Int,
    /** Whether the screen was blanked before the action. */
    val priorBlanked: Boolean,
    /** Wall-clock epoch millis at which the revert is due. */
    val dueAtEpochMs: Long,
    /**
     * Whether THIS record is the one allowed to restore on/off state.
     * See the header — at most one outstanding record may own it.
     */
    val ownsBlankState: Boolean = capability == Capability.BLANK || capability == Capability.WAKE,
) {
    fun isDue(nowMs: Long): Boolean = nowMs >= dueAtEpochMs

    /**
     * The actions that put the screen back the way we found it, in the
     * order they must be applied: the value restore first, then the
     * on/off restore, so the final visible state is the one that wins.
     *
     * A BRIGHTNESS record that owns blank state emits the on/off action
     * too — the v1 bug was that it emitted ONLY the brightness write, so
     * a vendor box whose blank is a power broadcast and whose brightness
     * is a sysfs node was never woken at all (the sysfs write landed on
     * a panel that was still powered off).
     */
    fun revertActions(): List<DisplayAction> {
        // A reboot cannot be un-done; the guard never arms one, and this
        // branch exists only so the record type stays total.
        if (capability == Capability.REBOOT) return emptyList()

        val out = mutableListOf<DisplayAction>()
        when (capability) {
            Capability.VOLUME -> out.add(DisplayAction.SetVolume(priorPercent))
            Capability.BRIGHTNESS ->
                // allowBlack: the PRIOR state is by definition a state the
                // screen was already in, so restoring it is safe even when
                // it is below MIN_SAFE (e.g. an overnight 0% poster the
                // operator tested a brightness bump against).
                out.add(DisplayAction.SetBrightness(priorPercent, allowBlack = true))
            else -> Unit
        }
        if (ownsBlankState) {
            if (priorBlanked) {
                out.add(DisplayAction.Blank)
            } else if (capability != Capability.BRIGHTNESS || priorPercent > 0) {
                // Restoring "not blanked" means an explicit Wake, so a
                // vendor power broadcast / screen-timeout blank is undone
                // and KEEP_SCREEN_ON comes back. Skipped only when the
                // prior state was a deliberate 0% (dark by intent) —
                // waking that would fight the operator's own setting.
                out.add(DisplayAction.Wake)
            }
        }
        return out
    }

    fun encode(): String =
        listOf(
            VERSION,
            capability.name,
            priorPercent.toString(),
            if (priorBlanked) "1" else "0",
            dueAtEpochMs.toString(),
            if (ownsBlankState) "1" else "0",
        ).joinToString(SEP)

    companion object {
        private const val VERSION = "v2"
        private const val LEGACY_VERSION = "v1"
        private const val SEP = "|"
        internal const val RECORD_SEP = "\n"

        /**
         * Decode ONE persisted record. Returns null for anything this
         * build does not fully understand — a record we cannot parse
         * must never be acted on, and "nothing pending" is the safe
         * reading (the screen simply keeps whatever state it has rather
         * than being driven somewhere by a half-read record).
         */
        fun decode(raw: String?): PendingRevert? {
            val line = raw?.trim()
            if (line.isNullOrEmpty()) return null
            val parts = line.split(SEP)
            val v2 = parts.size == 6 && parts[0] == VERSION
            val v1 = parts.size == 5 && parts[0] == LEGACY_VERSION
            if (!v2 && !v1) return null
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
            val ownsBlank = if (v2) {
                when (parts[5]) {
                    "1" -> true
                    "0" -> false
                    else -> return null
                }
            } else {
                // v1 semantics, preserved exactly: only a BLANK/WAKE
                // record ever drove on/off state.
                capability == Capability.BLANK || capability == Capability.WAKE
            }
            return PendingRevert(capability, percent, blanked, due, ownsBlank)
        }

        /**
         * Decode the whole persisted SET. Unparseable lines are dropped
         * individually — one corrupt line must not cost the screen every
         * other outstanding revert. At most one record survives per
         * capability (the LAST one wins, which is what a well-formed
         * write produces anyway).
         */
        fun decodeAll(raw: String?): List<PendingRevert> {
            if (raw.isNullOrBlank()) return emptyList()
            val byCapability = LinkedHashMap<Capability, PendingRevert>()
            raw.split(RECORD_SEP).forEach { line ->
                decode(line)?.let { byCapability[it.capability] = it }
            }
            return byCapability.values.toList()
        }

        /** Encode a whole set, one record per line. */
        fun encodeAll(records: List<PendingRevert>): String =
            records.joinToString(RECORD_SEP) { it.encode() }
    }
}
