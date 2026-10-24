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
 *  2. An identity already APPLIED or FAILED in this boot is left alone. An
 *     APPLIED one whose read-back has since DRIFTED is RECORDED as
 *     `changed-elsewhere` (once — the mark never flips back on its own) and
 *     still left alone: never re-written.
 *  2w. A Wi-Fi identity that is IN PROGRESS outside this record — a switch
 *     being proved, a save dialog waiting for a person, Android's one-time
 *     approval — is re-described from what [WifiProgress] says now and is
 *     never applied again while that is alive. While a switch is being proved
 *     for one identity, no other identity starts one.
 *  3. After a reboot an APPLIED identity stays applied. Its read-back is
 *     checked again ([DeviceSettingKey.recheckAfterBoot]) and a DRIFT is
 *     recorded as `changed-elsewhere` — NEVER set again (2026-10-24, owner
 *     rule: VenueOS never fights the vendor's app; until then a drift at boot
 *     was re-applied, so on a Goodview panel two apps took turns on one
 *     value). A value is written exactly once per identity — when the
 *     operator changes it in the dashboard — and whatever changes it
 *     afterwards (Goodview's CloudSign / GvSettings, a person, a firmware
 *     reset) is respected and reported, not undone.
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
 *  6w. Below Android 10 a Wi-Fi network can only be saved with the radio on:
 *     while Wi-Fi is off the item WAITS (`wifi-off`). VenueOS never turns
 *     Wi-Fi on.
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
        /** The Wi-Fi item's progress outside this record (rules 2w and 6w); null for every other key. */
        val wifi: WifiProgress? = null,
        /** Device wall clock — stamped on a Wi-Fi identity that lands without a write of its own. */
        val nowWallMs: Long = 0L,
    )

    /**
     * Where a Wi-Fi identity stands OUTSIDE its record, read by `WifiSetup`.
     * Pure data, so rules 2w and 6w have JVM tests.
     */
    data class WifiProgress(
        /** Android 9 and older: is the Wi-Fi radio on? null = not that path, or unreadable. */
        val legacyRadioOn: Boolean? = null,
        /** The identity whose switch is being proved right now (a persisted journal), or null. */
        val switchingId: String? = null,
        /** The identity whose save dialog is staged in THIS process, or null. */
        val dialogStagedId: String? = null,
        /** A finished save dialog: the identity and what happened ([DeviceSettingCodes] Wi-Fi code). */
        val dialogResultId: String? = null,
        val dialogResult: String? = null,
        /** Android's approval of VenueOS's suggestions (`approved` / `pending` / `rejected` / `unknown`). */
        val approval: String = "unknown",
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

        /**
         * The write landed and [why] says what it means — a Wi-Fi outcome
         * Android offers no read-back for (`wifi-joined`, `wifi-saved`, …).
         */
        data class Landed(val why: String) : Outcome()

        /**
         * The write was made and now waits on something outside VenueOS — a
         * person, Android's approval, a switch being proved. The attempt is
         * spent; rule 2w keeps it from being made again while that lasts.
         */
        data class Held(val status: Status, val why: String) : Outcome()

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

        // 2 — this identity is settled for this boot. An APPLIED value that
        // Android no longer reads back was changed by something else on the
        // unit: say so (once), never write it again.
        if (sameBoot && (prev!!.status == Status.APPLIED || prev.status == Status.FAILED)) {
            return Decision.Report(markDriftIfAny(item, prev, input.observedMatches))
        }
        // A failure nothing can fix is not retried after a reboot either.
        if (prev != null && prev.status == Status.FAILED && prev.why in DeviceSettingCodes.NEVER_RETRIED) {
            return Decision.Report(prev.copy(boot = input.boot))
        }

        // 2w — a Wi-Fi identity in progress is re-described, never applied again.
        if (item.key == DeviceSettingKey.WIFI) {
            wifiInProgress(item, prev, input)?.let { return Decision.Report(it) }
        }

        // 3 — a new boot re-checks an applied setting: a drift is RECORDED,
        // never re-applied (owner rule 2026-10-24 — never fight the vendor
        // app). The budget resets with the boot, which matters only when the
        // operator sends a NEW identity.
        if (prev != null && !sameBoot && prev.status == Status.APPLIED) {
            val carried = prev.copy(boot = input.boot, attempts = 0, lastAttemptElapsedMs = 0L)
            return Decision.Report(
                if (item.key.recheckAfterBoot) markDriftIfAny(item, carried, input.observedMatches) else carried,
            )
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

        // 6w — below Android 10 a network is saved only with the radio on, and
        // VenueOS never turns it on. No attempt is spent: it is picked up the
        // first heartbeat after someone turns Wi-Fi on.
        if (item.key == DeviceSettingKey.WIFI && input.wifi?.legacyRadioOn == false) {
            return Decision.Report(ack(Status.WAITING, DeviceSettingCodes.WIFI_OFF))
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
     * Rules 2 and 3 — an APPLIED identity whose read-back no longer matches
     * was changed by something else on the unit. The record keeps `applied`
     * and gains `changed-elsewhere`, ONCE: a later matching read does not
     * clear it (a value that flaps between two apps must not flap the report
     * too), and the mark is never a reason to write. Only a definite mismatch
     * (`false`) counts — `null` is "cannot tell", never "changed". A Wi-Fi
     * record is never marked: its read-back is a network name Android may
     * simply not be on right now.
     */
    private fun markDriftIfAny(item: DesiredItem, prev: Ack, observedMatches: Boolean?): Ack {
        if (prev.status != Status.APPLIED || observedMatches != false) return prev
        if (item.key == DeviceSettingKey.WIFI) return prev
        if (prev.why == DeviceSettingCodes.CHANGED_ELSEWHERE) return prev
        return prev.copy(why = DeviceSettingCodes.CHANGED_ELSEWHERE)
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
        is Outcome.Landed -> attempt.copy(status = Status.APPLIED, why = outcome.why, appliedAtWallMs = nowWallMs)
        is Outcome.Held -> attempt.copy(status = outcome.status, why = outcome.why)
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
     * Rule 2w. Null = nothing is in progress for this identity outside its
     * record: carry on with the ordinary rules. Reading is all this does —
     * a person's answer, Android's approval or a proved switch is RECORDED
     * here, never acted on.
     */
    private fun wifiInProgress(item: DesiredItem, prev: Ack?, input: Input): Ack? {
        val w = input.wifi ?: return null
        val stamp = input.nowWallMs.takeIf { it > 0L }
        val switching = w.switchingId
        // One switch at a time: while another identity's switch is being
        // proved, this one waits — never a second switch on top of the first.
        if (switching != null && switching != item.id) {
            return Ack(
                id = item.id,
                status = Status.PENDING,
                why = DeviceSettingCodes.WIFI_SWITCHING,
                attempts = if (prev != null && prev.boot == input.boot) prev.attempts else 0,
                lastAttemptElapsedMs = if (prev != null && prev.boot == input.boot) prev.lastAttemptElapsedMs else 0L,
                boot = input.boot,
                appliedAtWallMs = prev?.appliedAtWallMs,
            )
        }
        if (prev == null) return null
        return when (prev.why) {
            DeviceSettingCodes.WIFI_SWITCHING ->
                // The journal outlives the process; once it is gone the
                // switch has been recorded (or was lost) — the rules decide.
                if (switching == item.id) prev.copy(boot = input.boot) else null
            DeviceSettingCodes.WIFI_DIALOG -> {
                val result = w.dialogResult?.takeIf { w.dialogResultId == item.id }
                when {
                    result == DeviceSettingCodes.WIFI_SAVED -> prev.copy(
                        status = Status.APPLIED,
                        why = DeviceSettingCodes.WIFI_SAVED,
                        boot = input.boot,
                        appliedAtWallMs = stamp ?: prev.appliedAtWallMs,
                    )
                    result != null -> prev.copy(status = Status.FAILED, why = result, boot = input.boot)
                    w.dialogStagedId == item.id -> prev.copy(boot = input.boot)
                    // The stage lived in a process that is gone (its passphrase
                    // with it): the ordinary rules ask for the passphrase and
                    // stage it again, inside the same attempt budget.
                    else -> null
                }
            }
            DeviceSettingCodes.WIFI_APPROVAL -> when (w.approval) {
                DeviceSettingsFacts.WIFI_APPROVED -> prev.copy(
                    status = Status.APPLIED,
                    why = DeviceSettingCodes.WIFI_SAVED,
                    boot = input.boot,
                    appliedAtWallMs = stamp ?: prev.appliedAtWallMs,
                )
                // Declined: the ordinary rules apply again, and the applier
                // routes to the save dialog where the screen has one.
                DeviceSettingsFacts.WIFI_REJECTED -> null
                else -> prev.copy(boot = input.boot)
            }
            else -> null
        }
    }

    /**
     * Must this unit ask the server for the Wi-Fi passphrase again? Only for
     * a current item it could apply right now.
     */
    fun needsSecret(acks: Collection<Ack>): Boolean =
        acks.any { it.status == Status.PENDING && it.why == DeviceSettingCodes.NEEDS_SECRET }
}
