package com.educms.player.display

/** Paint is a separate fact from the hold, wake, page liveness and native-video retirement. */
internal object EmergencyPaintPolicy {
    val STEP_AT_MS = listOf(3_000L, 3_250L, 4_000L, 7_000L)
    const val FINISH_AT_MS = 10_000L
    const val MAX_EVENTS = 7

    data class Event(val step: Int, val atMs: Long, val outcome: String)
    data class Episode(
        val challenge: String,
        val heldAtMs: Long,
        val startedAtMs: Long,
        val step: Int = 0,
        val status: String = "pending",
        val identity: String? = null,
        val documentId: String? = null,
        val events: List<Event> = emptyList(),
        val paintedAtMs: Long? = null,
        val legacyReloads: Int = 0,
        val legacyLaunches: Int = 0,
    )

    /** One attempt per stage, even if the caller dies after persisting but before dispatch. */
    fun next(e: Episode, nowMs: Long): Int? {
        if (e.status != "pending") return null
        if (e.step < STEP_AT_MS.size && nowMs - e.startedAtMs >= STEP_AT_MS[e.step]) return e.step + 1
        return null
    }

    fun finished(e: Episode, nowMs: Long): Boolean =
        e.status == "pending" && e.step == STEP_AT_MS.size && nowMs - e.startedAtMs >= FINISH_AT_MS

    fun accepts(e: Episode, challenge: String?, identity: String?, documentId: String?, frames: Long?,
        visible: Boolean, interactive: Boolean, foreground: Boolean, nativeClear: Boolean = true): Boolean =
        challenge == e.challenge && (e.identity == null || identity == e.identity) && identity != null && identity.matches(Regex("[A-Za-z0-9._:-]{1,64}")) &&
            documentId != null && documentId.matches(Regex("[A-Za-z0-9._:-]{1,64}")) &&
            frames != null && frames in 2..9_007_199_254_740_991L && visible && interactive && foreground && nativeClear

    fun dispatch(step: Int, reassert: () -> Unit, show: () -> Unit, reload: () -> Unit, relaunch: () -> Unit) {
        when (step) {
            1 -> reassert()
            2 -> show()
            3 -> reload()
            4 -> relaunch()
        }
    }

    fun documentStarted(e: Episode, challenge: String, nowMs: Long): Episode =
        e.copy(challenge = challenge, status = "pending", identity = null, documentId = null, paintedAtMs = null,
            startedAtMs = if (e.status == "painted") nowMs else e.startedAtMs)

    fun announce(e: Episode, identity: String, challenge: String, wallMs: Long, nowMs: Long): Episode = when {
        e.identity == identity -> e
        e.identity == null -> e.copy(identity = identity)
        else -> Episode(challenge, wallMs, nowMs, identity = identity).let { event(it, 0, wallMs, "pending") }
    }

    fun event(e: Episode, step: Int, atMs: Long, outcome: String): Episode =
        e.copy(step = step, events = (e.events + Event(step, atMs, outcome)).takeLast(MAX_EVENTS))

    fun legacyAllowed(e: Episode, nowMs: Long, launch: Boolean): Boolean =
        nowMs - e.startedAtMs >= FINISH_AT_MS && (e.status == "painted" || e.step == 4) &&
            if (launch) e.legacyLaunches < 6 else e.legacyReloads < 3

    /** A vendor wake failure must not skip the remaining immediate drawing work. */
    fun bestEffort(wake: () -> Unit, draw: () -> Unit, failed: (Throwable) -> Unit) {
        try { wake() } catch (t: Throwable) { failed(t) }
        try { draw() } catch (t: Throwable) { failed(t) }
    }
}
