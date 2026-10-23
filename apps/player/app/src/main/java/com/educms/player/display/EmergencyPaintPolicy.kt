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

    /**
     * How long the hold path waits for a vendor WAKE provider before it goes on
     * without it (1.1.51). A provider that BLOCKS in a binder/kernel call (not
     * one that throws) used to run synchronously under the hold lock on the
     * bridge thread, where the page's own paint receipts queue behind it.
     */
    const val WAKE_BUDGET_MS = 2_000L

    /**
     * A vendor wake failure must not skip the remaining immediate drawing work,
     * and a vendor wake that HANGS must not delay it either: [wake] runs on its
     * own daemon thread and is given [wakeBudgetMs]; past that the drawing goes
     * ahead while the wake finishes (or never does) in the background. A throw
     * inside the wake is reported through [failed] exactly as before.
     */
    fun bestEffort(
        wake: () -> Unit,
        draw: () -> Unit,
        failed: (Throwable) -> Unit,
        wakeBudgetMs: Long = WAKE_BUDGET_MS,
        timedOut: (Long) -> Unit = {},
    ) {
        val waker = Thread({
            try { wake() } catch (t: Throwable) { runCatching { failed(t) } }
        }, "emergency-registry-wake").apply { isDaemon = true }
        try {
            waker.start()
            waker.join(wakeBudgetMs.coerceAtLeast(1L))
            if (waker.isAlive) runCatching { timedOut(wakeBudgetMs) }
        } catch (t: Throwable) {
            // The thread could not even start (an exhausted ROM): run it inline, bounded by nothing but the try.
            runCatching { failed(t) }
            try { wake() } catch (w: Throwable) { runCatching { failed(w) } }
        }
        try { draw() } catch (t: Throwable) { failed(t) }
    }

    /**
     * Is the WebView's background opaque, as far as a View can tell (1.1.51)?
     *
     * `WebView.setBackgroundColor` hands the colour to the Chromium provider and
     * does NOT set the View's background drawable, so on every real WebView the
     * drawable is null — and the previous acceptance rule (`background?.alpha ==
     * 255`) could never be satisfied: no paint was ever accepted natively, and
     * every alert climbed the ladder to a reload and a relaunch (steps 3–4)
     * before ending "unconfirmed". A null drawable means the WebView paints its
     * own base layer (black, which the host sets) — that is opaque. A drawable
     * that IS present must itself be opaque.
     *
     * @param hasDrawable whether `View.background` is non-null
     * @param drawableAlpha that drawable's `alpha` (0–255) when present
     * @param colorAlpha the alpha of a `ColorDrawable`'s colour when it is one (0–255)
     */
    fun opaqueBackground(hasDrawable: Boolean, drawableAlpha: Int?, colorAlpha: Int?): Boolean {
        if (!hasDrawable) return true
        if (drawableAlpha == null || drawableAlpha < 255) return false
        return colorAlpha == null || colorAlpha >= 255
    }
}
