package com.educms.manager.alertwatch

/**
 * THE ALERT-WATCH WATCHDOG — the rules (2026-11-08, Manager wave 5; life
 * safety, CHANGE class: different-vendor review and an on-glass drill before
 * it merges).
 *
 * ═════════════════════════════════════════════════════════════════════
 * WHAT IT WATCHES
 * ═════════════════════════════════════════════════════════════════════
 * Player 1.1.22 added the NATIVE ALERT WATCH: while a panel is dark the
 * Player's own process polls the screen's manifest and RAISES the emergency
 * hold when it reports an alert — because on the X80 the web page made no
 * request for 8.8 hours after its panel went off, so a lockdown could not
 * wake it. That watch is kept alive by the Player's foreground
 * `HeartbeatService` (a kick every minute) and its 15-minute Watchdog alarm.
 * Nothing OUTSIDE the Player's process checked that it was actually running.
 *
 * The Player's watch now writes a STAMP into the Manager's health provider
 * after every pass ([AlertWatchStamp]): when, whether it is watching, how many
 * manifests, whether the panel is dark by its own reckoning (a vendor-dark
 * GUQ counts), whether a hold is up, and the mode the server gave this
 * screen. This object reads the stamp on every Manager tick and decides
 * whether the watch is ALIVE while the panel is dark — and, when it is not,
 * walks a short, bounded ladder to bring it back.
 *
 * ═════════════════════════════════════════════════════════════════════
 * THE RULES (every one has a JVM test in AlertWatchWatchdogPolicyTest)
 * ═════════════════════════════════════════════════════════════════════
 *  1. ADD ONLY. [Action] has two members that reach the Player — RE-ARM and
 *     RESTART-HOST — and both can only START the watch. There is no action
 *     that lowers, delays or suppresses an alert, and there must never be
 *     one. A stamp that says a hold is up stands the watchdog down: the
 *     panel is lit under a hold and the Player's own paint ladder owns it.
 *  2. THE PANEL STAYS DARK. Neither action touches the display: a re-arm is a
 *     broadcast into the live Player process, a restart starts the Player's
 *     HeartbeatService (the watch's host). The Activity — whose manifest
 *     `turnScreenOn` would light a scheduled-dark panel — is never launched
 *     from here, so the owner's sleep rules hold. A dead Player PROCESS is a
 *     stale heartbeat, and that stays the liveness watchdog's job
 *     (WatchdogService): this object DEFERS while the heartbeat is stale.
 *  3. UNSET MEANS TODAY. The mode comes from the server through the Player
 *     (manifest `display.alertWatchWatchdog`, env `MANAGER_ALERT_WATCH_WATCHDOG`).
 *     No stamp, no mode, or `off` → nothing happens and nothing is recorded.
 *     `observe` records every verdict and sends nothing; `on` sends.
 *  4. SILENCE IS COUNTED IN TICKS, NOT IN CLOCK. A stamp is stale when it is
 *     older than [STAMP_FRESH_MS]; the ladder starts only after
 *     [SILENT_TICKS] consecutive Manager ticks saw a stale stamp. A gap
 *     between two of the Manager's own ticks of [SUSPEND_GAP_MS] or more
 *     means the box slept (a t982 in deep standby suspends BOTH processes),
 *     so the streak starts again — the Player gets its minute back before
 *     anyone judges it. A stamp dated in the future (a reboot reset the
 *     clock) is read as fresh: failing toward "do nothing".
 *  5. ONE LADDER, BOUNDED, WITH BACKOFF. Re-arm → wait [REARM_WAIT_MS] →
 *     restart the host → wait [RESTART_WAIT_MS] → record UNRECOVERED and
 *     stand down for the rest of this dark period. A new ladder needs
 *     [LADDER_MIN_GAP_MS] since the last one started and fewer than
 *     [MAX_INTERVENTIONS_PER_DAY] interventions in the last 24 h — so an
 *     on/off flicker, a stamp that never comes back, or a Manager that
 *     restarts cannot turn this into a loop (the memory is persisted).
 *  6. ONE DEVICE, ONE LADDER. The stamp is per PROCESS and lists every face
 *     it watches; a double-sided DH43 is one process with two faces, so it
 *     gets one ladder, never two (the echo class). The record names the faces.
 *  7. EVERY VERDICT IS A FACT. Each change of state yields a [Record] the
 *     Manager stores for the Player to carry on its signed heartbeat
 *     (`x-venueos-alert-watch-watchdog`). Copy states what the evidence
 *     proves: "the stamp is N s old" and "a re-arm was sent", never "the
 *     watch is fixed".
 *
 * No android.*, no clock reads, no I/O: every fact is passed in.
 */
object AlertWatchWatchdogPolicy {

    // ─── cadence ─────────────────────────────────────────────────────

    /** The WatchdogService tick this is consulted on. */
    const val TICK_MS = 30_000L

    /** A gap between our own ticks at or above this means the box was suspended: the streak restarts. */
    const val SUSPEND_GAP_MS = 90_000L

    /**
     * A WATCHING stamp older than this, while the panel is dark, is stale.
     * The Player's engine passes at most every 60 s while watching
     * (NativeAlertWatchPolicy.MAX_BACKOFF_MS) and its host kicks it every
     * minute; twice that leaves room for a slow resolver.
     */
    const val STAMP_FRESH_MS = 120_000L

    /** Consecutive stale ticks before the ladder starts (4 × 30 s on top of the 2 min of age). */
    const val SILENT_TICKS = 4

    /** After a re-arm, how long the Player gets to stamp again before the next rung. */
    const val REARM_WAIT_MS = 120_000L

    /** After a host restart, how long before the ladder records UNRECOVERED. */
    const val RESTART_WAIT_MS = 180_000L

    /** Minimum gap between two ladder STARTS, across dark periods. */
    const val LADDER_MIN_GAP_MS = 30L * 60_000L

    /** Interventions (re-arms + restarts) allowed in any rolling 24 h. */
    const val MAX_INTERVENTIONS_PER_DAY = 6
    const val DAY_MS = 24L * 60 * 60_000L

    /** The Player heartbeat age past which the liveness watchdog owns the device (WatchdogService.STALE_THRESHOLD_MS). */
    const val PLAYER_HEARTBEAT_STALE_MS = 90_000L

    // ─── the facts ───────────────────────────────────────────────────

    /** What the server told this screen, carried by the Player in its stamp. */
    enum class Mode { OFF, OBSERVE, ON }

    /** What the Player's watch said about itself at its last pass. */
    enum class StampState {
        /** Polling manifests (the panel is dark, or a face is unattended). */
        WATCHING,

        /** Idle by design: the panel is on and every face is attended — the page owns alerts. */
        IDLE,

        /** It cannot watch: not paired, no API root, or the API root is not an allowed host. */
        NOT_WATCHABLE,
    }

    /**
     * The Player's stamp, decoded. [atElapsedMs] is the Player's
     * `SystemClock.elapsedRealtime()` — the same kernel clock the Manager
     * reads, so it is comparable across the two processes and immune to NTP.
     */
    data class Stamp(
        val atElapsedMs: Long,
        val state: StampState,
        /** The Player's own view: `!isInteractive`, OR the vendor backlight is off by our hand. */
        val panelDark: Boolean,
        val holdHeld: Boolean,
        /** Manifests (faces) the watch polls; 0 when idle or not watchable. */
        val faces: Int,
        val mode: Mode,
        /** A short, secret-free reason when NOT_WATCHABLE. */
        val reason: String? = null,
    )

    /** Everything one tick is allowed to know. */
    data class Facts(
        val nowElapsedMs: Long,
        /** `PowerManager.isInteractive` read by the Manager; null when unreadable. */
        val managerInteractive: Boolean?,
        val stamp: Stamp?,
        /** Age of the Player's liveness heartbeat row (wall clock); null = none recorded. */
        val playerHeartbeatAgeMs: Long?,
    )

    // ─── the memory ──────────────────────────────────────────────────

    enum class Rung { REARM, RESTART, UNRECOVERED, OBSERVED, BACKOFF, CAPPED }

    /** The ladder in the current dark period, or null when none has started. */
    data class Ladder(val rung: Rung, val atMs: Long)

    data class Memory(
        val lastTickAtMs: Long? = null,
        val staleTicks: Int = 0,
        /** `elapsedRealtime` when this dark period was first seen; null = the panel is on. */
        val darkSinceMs: Long? = null,
        val ladder: Ladder? = null,
        /** `elapsedRealtime` of each intervention SENT (re-arm or restart), newest last. */
        val interventions: List<Long> = emptyList(),
        val lastLadderStartMs: Long? = null,
    )

    // ─── what a tick may cause ───────────────────────────────────────

    /**
     * ⚠️ THERE IS NO RELEASE, CLEAR, WAKE OR LAUNCH HERE, AND THERE MUST NEVER
     * BE ONE (rule 1, rule 2). Both members START the Player's watch and
     * nothing else.
     */
    enum class Action { NONE, REARM, RESTART_HOST }

    /** What the dashboard is told. One per CHANGE of verdict; the Android half dedupes. */
    enum class Verdict {
        /** The panel is on (by both reckonings): the page owns alerts; the watch is idle by design. */
        PANEL_ON,

        /** Dark, and the watch stamped recently: it is alive. */
        HEALTHY,

        /** Dark, no stamp at all: this Player predates the stamp, or has never written one. Nothing to do. */
        NO_STAMP,

        /** Dark, and the Player's liveness heartbeat is stale: the liveness watchdog owns the device. */
        DEFERRED_LIVENESS,

        /** A hold is up: the Player's paint ladder owns the screen (and the panel is lit). */
        HOLD,

        /** Dark, fresh stamp, and the Player says it cannot watch (not paired, no API root). A re-arm cannot help. */
        NOT_WATCHABLE,

        /** Dark and the stamp has been stale for [SILENT_TICKS] ticks — observe mode, nothing sent. */
        SILENT_OBSERVED,

        /** Silent, and the last ladder started less than [LADDER_MIN_GAP_MS] ago. */
        SILENT_BACKOFF,

        /** Silent, and the 24 h intervention cap is reached. */
        SILENT_CAPPED,

        REARM_SENT,
        RESTART_SENT,

        /** The stamp came back fresh after an intervention. */
        RECOVERED,

        /** Both rungs were spent and the stamp is still stale. The panel is dark and NOT natively watched. */
        UNRECOVERED,
    }

    data class Record(
        val verdict: Verdict,
        val mode: Mode,
        val stampAgeMs: Long?,
        val stampState: StampState?,
        val faces: Int,
        val reason: String?,
        val ladder: Ladder?,
        /** Interventions sent in the trailing 24 h, this one included. */
        val interventionsLast24h: Int,
    )

    data class Step(val memory: Memory, val action: Action, val record: Record?)

    // ─── one tick ────────────────────────────────────────────────────

    fun tick(mem0: Memory, f: Facts): Step {
        val now = f.nowElapsedMs
        // Rule 4: our own tick gap says whether the box slept.
        val slept = mem0.lastTickAtMs?.let { now - it >= SUSPEND_GAP_MS || now < it } ?: false
        var mem = mem0.copy(
            lastTickAtMs = now,
            staleTicks = if (slept) 0 else mem0.staleTicks,
            interventions = mem0.interventions.filter { it <= now && now - it < DAY_MS },
        )
        val stamp = f.stamp
        val mode = stamp?.mode ?: Mode.OFF

        // Rule 3: unset / off is today's behaviour — nothing, and no record.
        if (mode == Mode.OFF) {
            return Step(mem.copy(staleTicks = 0, darkSinceMs = null, ladder = null), Action.NONE, null)
        }

        val dark = f.managerInteractive == false || stamp?.panelDark == true
        if (!dark) {
            // The page owns alerts while the panel is on. End the dark period.
            return Step(
                mem.copy(staleTicks = 0, darkSinceMs = null, ladder = null),
                Action.NONE,
                record(Verdict.PANEL_ON, mode, stamp, now, null, mem),
            )
        }
        if (mem.darkSinceMs == null) mem = mem.copy(darkSinceMs = now)

        if (stamp == null) {
            return Step(mem.copy(staleTicks = 0), Action.NONE, record(Verdict.NO_STAMP, mode, null, now, mem.ladder, mem))
        }
        // Rule 2: a dead or dying Player process is the liveness watchdog's.
        if (f.playerHeartbeatAgeMs == null || f.playerHeartbeatAgeMs > PLAYER_HEARTBEAT_STALE_MS || f.playerHeartbeatAgeMs < 0) {
            return Step(mem.copy(staleTicks = 0), Action.NONE, record(Verdict.DEFERRED_LIVENESS, mode, stamp, now, mem.ladder, mem))
        }
        // Rule 1: a hold is up — the Player's paint ladder owns the screen.
        if (stamp.holdHeld) {
            return Step(mem.copy(staleTicks = 0), Action.NONE, record(Verdict.HOLD, mode, stamp, now, mem.ladder, mem))
        }

        val age = stampAge(stamp, now)
        val fresh = age <= STAMP_FRESH_MS
        if (fresh && stamp.state == StampState.NOT_WATCHABLE) {
            return Step(mem.copy(staleTicks = 0), Action.NONE, record(Verdict.NOT_WATCHABLE, mode, stamp, now, mem.ladder, mem))
        }
        // Alive: a fresh WATCHING stamp. (A fresh IDLE stamp while the panel is
        // dark is a loop that has not re-read the power state — it counts as
        // silence until it does.)
        if (fresh && stamp.state == StampState.WATCHING) {
            val recovered = mem.ladder?.rung == Rung.REARM || mem.ladder?.rung == Rung.RESTART || mem.ladder?.rung == Rung.UNRECOVERED
            val next = mem.copy(staleTicks = 0, ladder = null)
            return Step(next, Action.NONE, record(if (recovered) Verdict.RECOVERED else Verdict.HEALTHY, mode, stamp, now, mem.ladder, next))
        }

        // Silent this tick.
        val streak = mem.staleTicks + 1
        mem = mem.copy(staleTicks = streak)
        if (streak < SILENT_TICKS) return Step(mem, Action.NONE, null)

        val ladder = mem.ladder
        if (ladder == null) {
            if (mode == Mode.OBSERVE) {
                val l = Ladder(Rung.OBSERVED, now)
                return Step(mem.copy(ladder = l), Action.NONE, record(Verdict.SILENT_OBSERVED, mode, stamp, now, l, mem))
            }
            val last = mem.lastLadderStartMs
            if (last != null && now >= last && now - last < LADDER_MIN_GAP_MS) {
                val l = Ladder(Rung.BACKOFF, now)
                return Step(mem.copy(ladder = l), Action.NONE, record(Verdict.SILENT_BACKOFF, mode, stamp, now, l, mem))
            }
            if (mem.interventions.size >= MAX_INTERVENTIONS_PER_DAY) {
                val l = Ladder(Rung.CAPPED, now)
                return Step(mem.copy(ladder = l), Action.NONE, record(Verdict.SILENT_CAPPED, mode, stamp, now, l, mem))
            }
            val l = Ladder(Rung.REARM, now)
            val next = mem.copy(ladder = l, interventions = mem.interventions + now, lastLadderStartMs = now)
            return Step(next, Action.REARM, record(Verdict.REARM_SENT, mode, stamp, now, l, next))
        }
        return when (ladder.rung) {
            Rung.REARM -> {
                if (now - ladder.atMs < REARM_WAIT_MS) return Step(mem, Action.NONE, null)
                if (mem.interventions.size >= MAX_INTERVENTIONS_PER_DAY) {
                    val l = Ladder(Rung.CAPPED, now)
                    return Step(mem.copy(ladder = l), Action.NONE, record(Verdict.SILENT_CAPPED, mode, stamp, now, l, mem))
                }
                val l = Ladder(Rung.RESTART, now)
                val next = mem.copy(ladder = l, interventions = mem.interventions + now)
                Step(next, Action.RESTART_HOST, record(Verdict.RESTART_SENT, mode, stamp, now, l, next))
            }
            Rung.RESTART -> {
                if (now - ladder.atMs < RESTART_WAIT_MS) return Step(mem, Action.NONE, null)
                val l = Ladder(Rung.UNRECOVERED, now)
                Step(mem.copy(ladder = l), Action.NONE, record(Verdict.UNRECOVERED, mode, stamp, now, l, mem))
            }
            // Spent, observed, backed off or capped: stand down for this dark period.
            Rung.UNRECOVERED, Rung.OBSERVED, Rung.BACKOFF, Rung.CAPPED -> Step(mem, Action.NONE, null)
        }
    }

    /** A stamp from the future (a reboot reset the clock) reads as age 0 — fresh, so nothing happens. */
    fun stampAge(stamp: Stamp, nowElapsedMs: Long): Long = (nowElapsedMs - stamp.atElapsedMs).coerceAtLeast(0L)

    private fun record(v: Verdict, mode: Mode, stamp: Stamp?, now: Long, ladder: Ladder?, mem: Memory): Record = Record(
        verdict = v,
        mode = mode,
        stampAgeMs = stamp?.let { stampAge(it, now) },
        stampState = stamp?.state,
        faces = stamp?.faces ?: 0,
        reason = stamp?.reason,
        ladder = ladder,
        interventionsLast24h = mem.interventions.count { it <= now && now - it < DAY_MS },
    )

    // ─── wire helpers (no org.json: the Manager's JVM tests have no Android runtime) ───

    fun modeOf(raw: String?): Mode = when (raw?.trim()?.lowercase()) {
        "on" -> Mode.ON
        "observe" -> Mode.OBSERVE
        else -> Mode.OFF
    }

    fun stampStateOf(raw: String?): StampState? = when (raw?.trim()?.lowercase()) {
        "watching" -> StampState.WATCHING
        "idle" -> StampState.IDLE
        "not-watchable" -> StampState.NOT_WATCHABLE
        else -> null
    }

    fun wire(state: StampState): String = when (state) {
        StampState.WATCHING -> "watching"
        StampState.IDLE -> "idle"
        StampState.NOT_WATCHABLE -> "not-watchable"
    }

    fun wire(mode: Mode): String = when (mode) {
        Mode.ON -> "on"
        Mode.OBSERVE -> "observe"
        Mode.OFF -> "off"
    }

    fun wire(v: Verdict): String = when (v) {
        Verdict.PANEL_ON -> "panel-on"
        Verdict.HEALTHY -> "healthy"
        Verdict.NO_STAMP -> "no-stamp"
        Verdict.DEFERRED_LIVENESS -> "deferred-liveness"
        Verdict.HOLD -> "hold"
        Verdict.NOT_WATCHABLE -> "not-watchable"
        Verdict.SILENT_OBSERVED -> "silent-observed"
        Verdict.SILENT_BACKOFF -> "silent-backoff"
        Verdict.SILENT_CAPPED -> "silent-capped"
        Verdict.REARM_SENT -> "rearm-sent"
        Verdict.RESTART_SENT -> "restart-sent"
        Verdict.RECOVERED -> "recovered"
        Verdict.UNRECOVERED -> "unrecovered"
    }

    fun wire(r: Rung): String = when (r) {
        Rung.REARM -> "rearm"
        Rung.RESTART -> "restart"
        Rung.UNRECOVERED -> "unrecovered"
        Rung.OBSERVED -> "observed"
        Rung.BACKOFF -> "backoff"
        Rung.CAPPED -> "capped"
    }

    /** A reason safe for a log line and a header: short, printable ASCII, no control characters. */
    fun safeReason(raw: String?): String? {
        val s = raw?.trim() ?: return null
        if (s.isEmpty()) return null
        val cleaned = s.filter { it.code in 0x20..0x7E && it != '"' && it != '\\' }.take(120)
        return cleaned.ifEmpty { null }
    }

    /**
     * The memory, persisted so the no-loop bounds survive a Manager restart.
     * A flat `key=value;…` line — no JSON library needed on either side.
     */
    fun encode(m: Memory): String = buildString {
        append("v=1")
        m.lastTickAtMs?.let { append(";t=").append(it) }
        append(";s=").append(m.staleTicks)
        m.darkSinceMs?.let { append(";d=").append(it) }
        m.ladder?.let { append(";lr=").append(wire(it.rung)).append(";la=").append(it.atMs) }
        if (m.interventions.isNotEmpty()) append(";i=").append(m.interventions.joinToString(","))
        m.lastLadderStartMs?.let { append(";ls=").append(it) }
    }

    fun decode(raw: String?): Memory {
        if (raw.isNullOrBlank()) return Memory()
        return runCatching {
            val kv = raw.split(';').mapNotNull { part ->
                val i = part.indexOf('=')
                if (i <= 0) null else part.substring(0, i) to part.substring(i + 1)
            }.toMap()
            if (kv["v"] != "1") return Memory()
            val rung = kv["lr"]?.let { r -> Rung.values().firstOrNull { wire(it) == r } }
            val la = kv["la"]?.toLongOrNull()
            Memory(
                lastTickAtMs = kv["t"]?.toLongOrNull(),
                staleTicks = kv["s"]?.toIntOrNull()?.coerceAtLeast(0) ?: 0,
                darkSinceMs = kv["d"]?.toLongOrNull(),
                ladder = if (rung != null && la != null) Ladder(rung, la) else null,
                interventions = kv["i"]?.split(',')?.mapNotNull { it.toLongOrNull() }?.take(64) ?: emptyList(),
                lastLadderStartMs = kv["ls"]?.toLongOrNull(),
            )
        }.getOrDefault(Memory())
    }
}
