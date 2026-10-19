package com.educms.player.settings

/**
 * WHAT MAY BE APPLIED, AND WHEN (2026-10-18). Pure — no `android.*` — so every
 * rule has a JVM test on a virtual clock (`DeviceSettingsPolicyTest`).
 *
 * ─────────────────────────────────────────────────────────────────────
 * THE ORDER OF THE RULES IS THE CONTRACT
 * ─────────────────────────────────────────────────────────────────────
 *  1. A value this unit does not accept is FAILED (`invalid-value`) and never
 *     retried — it is written into the system, so it is refused, not trusted.
 *  2. An identity already APPLIED or FAILED in this boot is left alone.
 *  3. After a reboot an APPLIED identity stays applied while Android still
 *     reads it back (or offers no read-back). Only a setting whose read-back
 *     DRIFTED is set again — some signage firmware resets the timeout,
 *     brightness or volume at boot.
 *  4. A value Android already reads back is APPLIED without a write
 *     (`already-set`): no needless hardware write, no volume panel.
 *  5. What this unit cannot set right now is UNSUPPORTED, with the reason
 *     the probe gave. No attempt is spent, so a grant made later (one tap,
 *     or the install command) is picked up on the next heartbeat.
 *  6. ⚠️ Nothing changes while an emergency is held, while Android says the
 *     panel is not interactive, while we hold it blanked, or until it has
 *     been on for [SETTLE_MS] and up for [BOOT_SETTLE_MS] (WAITING; no
 *     attempt spent). The first is life safety: an alert's brightness and
 *     keep-awake must not be touched by anything else. The last is field
 *     evidence: a hardware brightness write while the display pipeline was
 *     still powering up reset an L55VEC (EmergencyBrightnessPolicy's header);
 *     a basic setting can always wait a minute.
 *  7. A Wi-Fi item whose passphrase has not arrived is PENDING (`needs-secret`)
 *     and this unit asks for it in its next report.
 *  8. At most [MAX_ATTEMPTS] attempts per identity per boot, [RETRY_GAP_MS]
 *     apart. The attempt is returned to the caller to PERSIST before it
 *     touches the setting, so a crash mid-write cannot become a loop.
 *
 * "Nothing is applied without a stored operator intent" is structural: the
 * only input is a [DesiredItem] the server sent, and an empty desired set
 * makes no decision at all.
 */
object DeviceSettingsPolicy {

    const val MAX_ATTEMPTS = 3
    const val RETRY_GAP_MS = 60_000L
    /** Continuously on (since the last wake seen in this process) before anything is written. */
    const val SETTLE_MS = 60_000L
    /** Since the device booted, and since this process started. */
    const val BOOT_SETTLE_MS = 120_000L

    enum class Status(val wire: String) {
        APPLIED("applied"),
        FAILED("failed"),
        UNSUPPORTED("unsupported"),
        WAITING("waiting"),
        PENDING("pending");

        companion object {
            fun fromWire(s: String?): Status? = values().firstOrNull { it.wire == s }
        }
    }

    /**
     * What this unit remembers about ONE setting: the identity it last worked
     * on and what happened. Persisted per key, compared by identity equality.
     */
    data class Ack(
        val id: String,
        val status: Status,
        val why: String? = null,
        /** Attempts spent on [id] in boot [boot]. */
        val attempts: Int = 0,
        /** `elapsedRealtime` of the last attempt (meaningless across a reboot). */
        val lastAttemptElapsedMs: Long = 0L,
        /** `Settings.Global.BOOT_COUNT` when this record was last written; -1 = unknown. */
        val boot: Int = -1,
        /** Device wall clock of the last write that landed — evidence for the audit, never compared. */
        val appliedAtWallMs: Long? = null,
    )

    /** The panel's state right now. Unknown power state counts as OFF. */
    data class Conditions(
        val emergencyHeld: Boolean,
        val interactive: Boolean?,
        /** ms since the last wake seen in this process, or null when none was seen. */
        val sinceWakeMs: Long?,
        /** ms since this process started. */
        val processAgeMs: Long,
        /** `elapsedRealtime` — ms since the device booted. */
        val uptimeMs: Long,
        /** A native blank of ours is in force (DisplayPrefs.blanked). */
        val blankedByUs: Boolean,
        /** The screen-off blank's saved timeout exists — its 15 s value is in force. */
        val timeoutBlankActive: Boolean,
    ) {
        fun settled(): Boolean =
            uptimeMs >= BOOT_SETTLE_MS && processAgeMs >= SETTLE_MS &&
                (sinceWakeMs == null || sinceWakeMs >= SETTLE_MS)
    }

    data class Input(
        val item: DesiredItem,
        /** The probe's verdict for this key: [DeviceSettingCodes.OK] or a reason. */
        val capability: String,
        /** Does Android read back exactly the desired value? null = cannot tell. */
        val observedMatches: Boolean?,
        /** The record for this key, whatever identity it is for. */
        val previous: Ack?,
        val conditions: Conditions,
        val nowElapsedMs: Long,
        val boot: Int,
    )

    sealed class Decision {
        /** Leave the setting alone; report [ack]. */
        data class Report(val ack: Ack) : Decision()

        /**
         * Write the setting. [attempt] MUST be persisted (synchronously)
         * BEFORE the write, then folded with the outcome by [afterApply].
         */
        data class Apply(val attempt: Ack) : Decision()
    }

    /** How one write went. */
    sealed class Outcome {
        object Done : Outcome()
        data class Error(val code: String) : Outcome()
    }

    fun decide(input: Input): Decision {
        val item = input.item
        val prev = input.previous?.takeIf { it.id == item.id }
        // An unreadable boot count (-1 on both sides) reads as the SAME boot:
        // the safe degradation is "never re-check after a reboot", never "every
        // heartbeat is a new boot" — that would reset the attempt budget forever.
        val sameBoot = prev != null && prev.boot == input.boot
        val spentThisBoot = if (sameBoot) prev!!.attempts else 0
        fun ack(status: Status, why: String?, attempts: Int = spentThisBoot) = Ack(
            id = item.id,
            status = status,
            why = why,
            attempts = attempts,
            lastAttemptElapsedMs = if (sameBoot) prev!!.lastAttemptElapsedMs else 0L,
            boot = input.boot,
            appliedAtWallMs = prev?.appliedAtWallMs,
        )

        // 1 — refused, not trusted.
        if (!DeviceSettingDomains.valid(item.key, item.value)) {
            return Decision.Report(ack(Status.FAILED, DeviceSettingCodes.INVALID_VALUE))
        }

        // 2 — this identity is settled for this boot.
        if (sameBoot && (prev!!.status == Status.APPLIED || prev.status == Status.FAILED)) {
            return Decision.Report(prev)
        }
        // A failure nothing can fix is not retried after a reboot either.
        if (prev != null && prev.status == Status.FAILED && prev.why in DeviceSettingCodes.NEVER_RETRIED) {
            return Decision.Report(prev.copy(boot = input.boot))
        }

        // 3 — a new boot re-checks an applied setting; only a drift re-applies.
        if (prev != null && !sameBoot && prev.status == Status.APPLIED &&
            (!item.key.recheckAfterBoot || input.observedMatches != false)
        ) {
            return Decision.Report(prev.copy(boot = input.boot, attempts = 0, lastAttemptElapsedMs = 0L))
        }

        // 4 — already in place: nothing to write.
        if (input.observedMatches == true) {
            return Decision.Report(ack(Status.APPLIED, DeviceSettingCodes.ALREADY_SET))
        }

        // 5 — this unit cannot set it right now.
        if (input.capability != DeviceSettingCodes.OK) {
            return Decision.Report(ack(Status.UNSUPPORTED, input.capability))
        }

        // 6 — ⚠️ only on a lit, settled, un-blanked panel with no alert.
        val c = input.conditions
        when {
            c.emergencyHeld -> return Decision.Report(ack(Status.WAITING, DeviceSettingCodes.WAIT_EMERGENCY))
            c.interactive != true -> return Decision.Report(ack(Status.WAITING, DeviceSettingCodes.WAIT_SCREEN_OFF))
            c.blankedByUs || (item.key == DeviceSettingKey.SCREEN_OFF_TIMEOUT && c.timeoutBlankActive) ->
                return Decision.Report(ack(Status.WAITING, DeviceSettingCodes.WAIT_BLANKED))
            !c.settled() -> return Decision.Report(ack(Status.WAITING, DeviceSettingCodes.WAIT_SETTLING))
        }

        // 7 — the passphrase is never stored here; ask for it.
        val value = item.value
        if (item.key == DeviceSettingKey.WIFI && value is DesiredValue.WifiValue &&
            value.security != "open" && value.passphrase.isNullOrEmpty()
        ) {
            return Decision.Report(ack(Status.PENDING, DeviceSettingCodes.NEEDS_SECRET))
        }

        // 8 — bounded, spaced, persisted before the write.
        if (spentThisBoot >= MAX_ATTEMPTS) {
            return Decision.Report(ack(Status.FAILED, prev?.why ?: DeviceSettingCodes.NOT_TAKEN))
        }
        if (spentThisBoot > 0) {
            val since = input.nowElapsedMs - prev!!.lastAttemptElapsedMs
            if (since in 0 until RETRY_GAP_MS) {
                return Decision.Report(ack(Status.PENDING, prev.why))
            }
        }
        return Decision.Apply(
            Ack(
                id = item.id,
                status = Status.PENDING,
                why = null,
                attempts = spentThisBoot + 1,
                lastAttemptElapsedMs = input.nowElapsedMs,
                boot = input.boot,
                appliedAtWallMs = prev?.appliedAtWallMs,
            ),
        )
    }

    /**
     * Fold a write's outcome and Android's read-back into the record. Applied
     * means Android READS BACK the desired value (or offers no read-back at
     * all — `unverified`), never merely that the write call returned.
     */
    fun afterApply(attempt: Ack, outcome: Outcome, observedMatches: Boolean?, nowWallMs: Long): Ack = when (outcome) {
        is Outcome.Error -> {
            val terminal = outcome.code in DeviceSettingCodes.NEVER_RETRIED || attempt.attempts >= MAX_ATTEMPTS
            attempt.copy(status = if (terminal) Status.FAILED else Status.PENDING, why = outcome.code)
        }
        Outcome.Done -> when (observedMatches) {
            true -> attempt.copy(status = Status.APPLIED, why = null, appliedAtWallMs = nowWallMs)
            null -> attempt.copy(status = Status.APPLIED, why = DeviceSettingCodes.UNVERIFIED, appliedAtWallMs = nowWallMs)
            false -> attempt.copy(
                status = if (attempt.attempts >= MAX_ATTEMPTS) Status.FAILED else Status.PENDING,
                why = DeviceSettingCodes.NOT_TAKEN,
            )
        }
    }

    /**
     * Must this unit ask the server for the Wi-Fi passphrase again? Only for
     * a current item it could apply right now.
     */
    fun needsSecret(acks: Collection<Ack>): Boolean =
        acks.any { it.status == Status.PENDING && it.why == DeviceSettingCodes.NEEDS_SECRET }
}
