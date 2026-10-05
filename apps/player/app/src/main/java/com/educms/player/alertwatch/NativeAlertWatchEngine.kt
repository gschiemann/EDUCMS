package com.educms.player.alertwatch

/**
 * THE NATIVE ALERT WATCH — the machine (2026-10-05, player 1.1.22).
 *
 * [NativeAlertWatchPolicy] holds the rules; this strings them into one
 * [pass] that the Android half ([NativeAlertWatch]) calls in a loop:
 *
 *   panel off? → poll each watched manifest that is due → ALERT? → raise the
 *   hold → is the player on the glass? → has the page confirmed? → reload.
 *
 * Everything the machine touches is behind [Ports], so the whole sequence —
 * a dark panel, an alert, a page that never wakes, three reloads, giving up
 * — runs in a JVM test on a virtual clock (NativeAlertWatchEngineTest). A
 * life-safety path whose only proof needs a signage box on a bench is a path
 * that ships unproven; this box cannot even be reached with adb.
 *
 * ⚠️ RAISE ONLY. [Ports] has no way to release a hold, and that is the
 * design: the page, on a LIVE manifest, is the only thing that releases.
 *
 * Not thread-safe: one loop, one caller. No android.*, no I/O of its own.
 */
class NativeAlertWatchEngine(private val ports: Ports) {

    /** The Android half, or a test double. */
    interface Ports {
        /** `SystemClock.elapsedRealtime()` — monotonic, counts sleep. */
        fun nowMs(): Long

        /** `PowerManager.isInteractive`. */
        fun panelInteractive(): Boolean

        /**
         * The stored facts about who could be watched. Read on every dark
         * pass — a token can appear or go — and never while the panel is on.
         */
        fun plan(): WatchPlan

        /** One bounded `GET …/manifest`. Never throws; a failure is an outcome. */
        fun fetchManifest(target: WatchTarget, ifNoneMatch: String?): PollOutcome

        /** Is the emergency hold engaged, by anyone? */
        fun holdHeld(): Boolean

        /** `elapsedRealtime` of [face]'s page's last raise in the current hold period; null = none. */
        fun pageRaisedAtMs(face: Int): Long?

        /** `DisplayEmergency.raiseFromNativeWatch`. THE ONLY WRITE TO THE HOLD THIS MACHINE HAS. */
        fun raise(face: Int, firstForThisAlert: Boolean)

        /** Is MainActivity resumed? */
        fun playerInForeground(): Boolean

        /** Start / bring forward MainActivity through the existing relaunch helper. */
        fun bringPlayerForward(attempt: Int)

        /** Reload [face]'s page through the Activity's own reload path. */
        fun reloadPage(face: Int, attempt: Int, why: String)

        /** `elapsedRealtime` when [face]'s page last started a load; null = unknown. */
        fun pageLoadStartedAtMs(face: Int): Long?

        /** Hold (and refresh) or let go of the PARTIAL wake lock. */
        fun cpuLock(hold: Boolean)

        fun log(level: Level, message: String)
    }

    enum class Level { INFO, WARN, ERROR }

    /**
     * What the stores say, undecided: whether it adds up to "may poll" is
     * [NativeAlertWatchPolicy.pollRefusal]'s call, made in [pass].
     */
    class WatchPlan(
        /** The API root the page bootstrapped, or null. */
        val apiRoot: String?,
        /** Did it pass the native API-host allowlist at this point of use? */
        val apiRootAllowed: Boolean,
        /** Every face that holds a usable device token, primary first. */
        val targets: List<WatchTarget>,
    )

    // ── one dark period ──
    private var memories: MutableMap<Int, PollMemory>? = null
    private var darkSinceMs = 0L
    private var pollsThisDarkPeriod = 0
    private var lastProgressLogAtMs = 0L
    private var refusalLogged: String? = null

    // ── across dark periods (process lifetime) ──
    private val faces = HashMap<Int, FaceWatch>()
    private var relaunch = RelaunchMemory()
    private var notOnGlassLogged = false

    /** For tests and the loop's own bookkeeping. */
    internal fun faceState(face: Int): FaceWatch = faces[face] ?: FaceWatch()

    /**
     * One pass.
     *
     * @return how long the caller may sleep before the next pass, or null
     *         when there is nothing left to watch (the loop ends; a
     *         screen-off, the heartbeat or the Watchdog starts it again).
     */
    fun pass(): Long? {
        dropEpisodesTheHoldNoLongerBacks()

        val nextPollInMs = pollIfDark()
        val followUpInMs = followUp()

        val waits = listOfNotNull(nextPollInMs, followUpInMs)
        val sleepMs = waits.minOrNull()
        ports.cpuLock(NativeAlertWatchPolicy.holdCpu(ports.panelInteractive(), hasWork = sleepMs != null))
        return sleepMs?.coerceIn(MIN_SLEEP_MS, NativeAlertWatchPolicy.MAX_BACKOFF_MS)
    }

    // ─── 0. an episode exists only while the hold does ───────────────

    /**
     * The page releases the hold on a live all-clear, usually while this
     * loop is not even running (the panel is on). An episode left over from
     * that alert must not be mistaken for the next one — its "confirmed"
     * would excuse a page that never woke for the NEW alert.
     */
    private fun dropEpisodesTheHoldNoLongerBacks() {
        if (faces.values.none { it.episode != null }) return
        if (ports.holdHeld()) return
        for ((face, state) in faces.entries.toList()) {
            val ep = state.episode ?: continue
            if (ep.settled == null) {
                ports.log(
                    Level.ERROR,
                    "PLAYER_NATIVE_ALERT_PAGE_CLEARED face=$face afterMs=${ports.nowMs() - ep.openedAtMs} — " +
                        "the page released the hold on a live manifest; the native watch has nothing left to confirm",
                )
            }
            faces[face] = NativeAlertWatchPolicy.close(state)
        }
    }

    // ─── 1. poll, only while the panel is off ────────────────────────

    private fun pollIfDark(): Long? {
        val interactive = ports.panelInteractive()
        // The stores are not even read while the panel is on.
        val plan = if (interactive) null else ports.plan()
        val refusal = NativeAlertWatchPolicy.pollRefusal(
            panelInteractive = interactive,
            apiRoot = plan?.apiRoot,
            apiRootAllowed = plan?.apiRootAllowed == true,
            targets = plan?.targets?.size ?: 0,
        )
        if (refusal != null) {
            if (memories != null) {
                memories = null
                ports.log(
                    Level.INFO,
                    "the native alert watch stops polling after $pollsThisDarkPeriod poll(s) — $refusal",
                )
            }
            if (interactive) {
                refusalLogged = null
            } else if (refusal != refusalLogged) {
                // Said once per reason: a dark panel nothing is watching is
                // worth a line, not one every minute.
                refusalLogged = refusal
                ports.log(
                    Level.WARN,
                    "the panel is off and this screen is NOT being watched natively for an alert — $refusal",
                )
            }
            return null
        }
        val targets = plan?.targets.orEmpty()

        ports.cpuLock(true)
        refusalLogged = null
        val mem = memories ?: HashMap<Int, PollMemory>().also {
            memories = it
            darkSinceMs = ports.nowMs()
            pollsThisDarkPeriod = 0
            lastProgressLogAtMs = darkSinceMs
            ports.log(
                Level.INFO,
                "the panel is off — watching ${targets.size} manifest(s) natively for an emergency alert " +
                    "(first poll in ${NativeAlertWatchPolicy.FIRST_POLL_DELAY_MS / 1000}s, then every " +
                    "${NativeAlertWatchPolicy.POLL_INTERVAL_MS / 1000}s)",
            )
        }
        mem.keys.retainAll(targets.map { it.face }.toSet())

        for (target in targets) {
            val before = mem[target.face]
                ?: NativeAlertWatchPolicy.firstMemory(ports.nowMs()).also { mem[target.face] = it }
            if (ports.nowMs() < before.nextPollAtMs) continue
            // Rule 1, re-read per manifest: the panel may have come on while
            // an earlier face was being asked.
            if (ports.panelInteractive()) break

            ports.cpuLock(true)
            val outcome = ports.fetchManifest(target, before.etag)
            val nowMs = ports.nowMs()
            val verdict = NativeAlertWatchPolicy.classify(outcome, before)
            val after = NativeAlertWatchPolicy.afterPoll(before, outcome, verdict, nowMs)
            mem[target.face] = after
            pollsThisDarkPeriod += 1
            logPoll(target.face, outcome, verdict, before, after)
            applyVerdict(target.face, verdict, nowMs)
        }

        val nowMs = ports.nowMs()
        if (nowMs - lastProgressLogAtMs >= PROGRESS_LOG_EVERY_MS) {
            lastProgressLogAtMs = nowMs
            ports.log(
                Level.INFO,
                "native alert watch: the panel has been off for ${(nowMs - darkSinceMs) / 60_000} min — " +
                    "$pollsThisDarkPeriod manifest poll(s) so far",
            )
        }
        return mem.values.minOfOrNull { it.nextPollAtMs - nowMs }?.coerceAtLeast(0L)
    }

    private fun applyVerdict(face: Int, verdict: AlertVerdict, nowMs: Long) {
        // Read again AFTER the request: an answer that lands once the panel
        // is on belongs to the page (rule 1).
        val interactive = ports.panelInteractive()
        val step = NativeAlertWatchPolicy.onVerdict(faceState(face), verdict, nowMs, interactive)
        faces[face] = step.state
        when {
            step.action == WatchAction.RAISE -> {
                if (step.openedEpisode) {
                    relaunch = RelaunchMemory()
                    notOnGlassLogged = false
                }
                ports.raise(face, step.openedEpisode)
            }
            verdict == AlertVerdict.ALERT ->
                ports.log(
                    Level.WARN,
                    "native alert watch: face $face's manifest reports an alert, but the panel came on while " +
                        "it was being read — the page owns it; no native raise",
                )
            else -> Unit
        }
    }

    private fun logPoll(face: Int, outcome: PollOutcome, verdict: AlertVerdict, before: PollMemory, after: PollMemory) {
        if (verdict == AlertVerdict.UNKNOWN) {
            val what = describeFailure(outcome)
            val retryS = (after.nextPollAtMs - ports.nowMs()).coerceAtLeast(0L) / 1000
            when {
                after.failures == BLIND_AFTER_FAILURES -> ports.log(
                    Level.ERROR,
                    "PLAYER_NATIVE_ALERT_BLIND face=$face failures=${after.failures} last=$what — the native watch " +
                        "cannot read this screen's manifest; while that lasts an alert cannot wake this panel",
                )
                after.failures == 1 || after.failures % 20 == 0 -> ports.log(
                    Level.WARN,
                    "native alert watch: face $face poll proved nothing ($what, ${after.failures} in a row) — " +
                        "not an alert and not an all-clear; retrying in ${retryS}s",
                )
            }
            return
        }
        if (before.failures > 0) {
            ports.log(
                Level.INFO,
                "native alert watch: face $face's manifest is readable again after ${before.failures} failed poll(s)",
            )
        }
        // A 304 is the steady state (every 15 s all night) and is not logged;
        // a 200 is news.
        if (outcome.httpStatus == 200 && verdict == AlertVerdict.NO_ALERT) {
            ports.log(Level.INFO, "native alert watch: face $face's manifest answered — no alert")
        }
    }

    private fun describeFailure(o: PollOutcome): String = when {
        o.httpStatus == null -> "no response (${o.error ?: "unknown"})"
        o.httpStatus == 401 || o.httpStatus == 403 ->
            "http-${o.httpStatus} (the device credential was refused; only the page can renew it)"
        o.httpStatus == 200 -> "http-200 but the body was ${o.scan?.name?.lowercase() ?: "unread"}"
        o.httpStatus == 304 -> "http-304 for a validator this watch no longer has an answer for"
        else -> "http-${o.httpStatus}"
    }

    // ─── 2. the alert on the glass: confirm, reload, bring forward ───

    private fun followUp(): Long? {
        if (faces.values.none { it.episode != null }) {
            relaunch = RelaunchMemory()
            return null
        }
        var soonestMs: Long? = null
        fun wake(inMs: Long) {
            soonestMs = minOf(soonestMs ?: inMs, inMs)
        }

        val held = ports.holdHeld()
        var alertLive = false
        for ((face, state) in faces.entries.toList()) {
            val ep = state.episode ?: continue
            val nowMs = ports.nowMs()
            val facts = FollowUpFacts(
                nowMs = nowMs,
                holdHeld = held,
                pageRaisedAtMs = ports.pageRaisedAtMs(face),
                pageLoadStartedAtMs = ports.pageLoadStartedAtMs(face),
            )
            when (val next = NativeAlertWatchPolicy.followUp(state, facts)) {
                FollowUp.Idle -> Unit
                is FollowUp.Wait -> wake(minOf(next.ms, NativeAlertWatchPolicy.FOLLOW_UP_TICK_MS))
                FollowUp.Confirmed -> {
                    faces[face] = NativeAlertWatchPolicy.settle(state, Settled.CONFIRMED)
                    val raisedAt = facts.pageRaisedAtMs ?: nowMs
                    ports.log(
                        Level.ERROR,
                        "PLAYER_NATIVE_ALERT_CONFIRMED face=$face afterMs=${(raisedAt - ep.openedAtMs).coerceAtLeast(0L)} " +
                            "reloads=${ep.reloads} — the page raised the hold itself: it has the alert",
                    )
                }
                FollowUp.PageCleared -> {
                    faces[face] = NativeAlertWatchPolicy.close(state)
                    ports.log(
                        Level.ERROR,
                        "PLAYER_NATIVE_ALERT_PAGE_CLEARED face=$face afterMs=${nowMs - ep.openedAtMs} — " +
                            "the page released the hold on a live manifest; the native watch has nothing left to confirm",
                    )
                }
                FollowUp.Reload -> {
                    val attempt = ep.reloads + 1
                    val why = if (ep.serverCleared) {
                        "the alert has ended on the server but the page never saw it — reloading so the page " +
                            "reads the live state and releases the hold itself"
                    } else {
                        "the page has not confirmed the alert — reloading it"
                    }
                    ports.log(
                        Level.ERROR,
                        "PLAYER_NATIVE_ALERT_RELOAD face=$face n=$attempt of=${NativeAlertWatchPolicy.MAX_RELOADS_PER_ALERT} " +
                            "sinceRaiseMs=${nowMs - ep.openedAtMs} — $why",
                    )
                    ports.reloadPage(face, attempt, why)
                    faces[face] = NativeAlertWatchPolicy.afterReload(state, nowMs)
                    wake(NativeAlertWatchPolicy.FOLLOW_UP_TICK_MS)
                }
                FollowUp.GaveUp -> {
                    faces[face] = NativeAlertWatchPolicy.settle(state, Settled.GAVE_UP)
                    ports.log(
                        Level.ERROR,
                        "PLAYER_NATIVE_ALERT_UNCONFIRMED face=$face reloads=${ep.reloads} " +
                            "sinceRaiseMs=${nowMs - ep.openedAtMs} — the page never raised the hold itself. " +
                            "The hold STAYS engaged and the panel stays lit; no further reloads for this alert",
                    )
                }
            }
            if (held && NativeAlertWatchPolicy.alertLive(faceState(face))) alertLive = true
        }

        // The page draws the alert, and the page lives in MainActivity.
        if (!alertLive) {
            relaunch = RelaunchMemory()
            return soonestMs
        }
        val nowMs = ports.nowMs()
        val inForeground = ports.playerInForeground()
        if (NativeAlertWatchPolicy.relaunchDue(relaunch, nowMs, alertLive, inForeground)) {
            relaunch = RelaunchMemory(attempts = relaunch.attempts + 1, lastAtMs = nowMs)
            ports.log(
                Level.ERROR,
                "PLAYER_NATIVE_ALERT_RELAUNCH attempt=${relaunch.attempts} of=${NativeAlertWatchPolicy.MAX_RELAUNCHES_PER_ALERT} — " +
                    "an alert is active and the player is not on the glass; bringing it forward",
            )
            ports.bringPlayerForward(relaunch.attempts)
            wake(NativeAlertWatchPolicy.FOLLOW_UP_TICK_MS)
        } else if (!inForeground) {
            if (relaunch.attempts < NativeAlertWatchPolicy.MAX_RELAUNCHES_PER_ALERT) {
                wake(NativeAlertWatchPolicy.FOLLOW_UP_TICK_MS)
            } else if (!notOnGlassLogged) {
                // One last look after the final launch has had its gap.
                val sinceLast = nowMs - (relaunch.lastAtMs ?: nowMs)
                if (sinceLast in 0 until NativeAlertWatchPolicy.RELAUNCH_MIN_GAP_MS) {
                    wake(NativeAlertWatchPolicy.RELAUNCH_MIN_GAP_MS - sinceLast)
                } else {
                    notOnGlassLogged = true
                    ports.log(
                        Level.ERROR,
                        "PLAYER_NATIVE_ALERT_NOT_ON_GLASS launches=${relaunch.attempts} — the player did not come to " +
                            "the foreground. Android refuses a launch from the background unless the app is the " +
                            "Home app, holds \"Display over other apps\" or is a device owner. The hold stays engaged",
                    )
                }
            }
        }
        return soonestMs
    }

    private companion object {
        /** Never spin: even "now" waits a quarter of a second. */
        const val MIN_SLEEP_MS = 250L

        /** The streak at which an unreadable manifest is called out with a marker. */
        const val BLIND_AFTER_FAILURES = 3

        /** One progress line per ten minutes of darkness, so a field log shows the watch ran all night. */
        const val PROGRESS_LOG_EVERY_MS = 10L * 60_000L
    }
}
