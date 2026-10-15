package com.educms.player.media

/** All operations stay on the codec thread and must be nonblocking. */
internal class VideoDecodePump(
    private val feed: () -> Boolean,
    private val drain: () -> Boolean,
) {
    fun step(): Boolean {
        var progress = false
        // Release ready output before reading more compressed bytes from disk.
        // A full input queue must never delay the output that frees its space.
        for (i in 0 until 8) {
            if (!drain()) break
            progress = true
        }
        // Fill free input buffers rather than requiring one packet per output
        // frame. Reordering codecs can need several packets before any output.
        for (i in 0 until 8) {
            if (!feed()) break
            progress = true
        }
        return progress
    }
}

/** Surface timestamps use nanoTime; never change the media clock to hide lag. */
internal class VideoFrameSchedule(frameUs: Long, refreshRate: Float) {
    private val frameNs = frameUs.coerceAtLeast(1) * 1000
    private val hz = refreshRate.takeIf { it.isFinite() && it >= 20f && it <= 240f } ?: 60f
    val leadNs = (2_000_000_000.0 / hz).toLong().coerceAtMost(50_000_000L)
    private var originNs: Long? = null
    private var firstPtsUs = 0L
    private var lastSubmittedNs: Long? = null
    private var lastPresentationNs: Long? = null
    var lateFrames = 0L; private set
    var lastLateUs = 0L; private set
    var maxLateUs = 0L; private set
    var maxSubmitGapMs = 0L; private set

    fun start(ptsUs: Long, nowNs: Long) {
        originNs = nowNs
        firstPtsUs = ptsUs
        lastSubmittedNs = nowNs
        lastPresentationNs = nowNs
    }

    fun due(ptsUs: Long, nowNs: Long): Long {
        if (originNs == null) start(ptsUs, nowNs)
        return originNs!! + (ptsUs - firstPtsUs) * 1000
    }

    fun shouldDrop(dueNs: Long, nowNs: Long): Boolean =
        nowNs - dueNs > frameNs &&
            lastSubmittedNs?.let { nowNs - it < 250_000_000L } == true

    fun observe(dueNs: Long, nowNs: Long) {
        lastLateUs = ((nowNs - dueNs) / 1000).coerceAtLeast(0)
        if (lastLateUs > 0) lateFrames++
        maxLateUs = maxOf(maxLateUs, lastLateUs)
    }

    fun submitted(nowNs: Long, presentationNs: Long = nowNs) {
        lastSubmittedNs?.let { maxSubmitGapMs = maxOf(maxSubmitGapMs, (nowNs - it) / 1_000_000) }
        lastSubmittedNs = nowNs
        lastPresentationNs = presentationNs
    }

    /** An empty EOS may follow a future-scheduled last picture immediately. */
    fun endDeadline(nowNs: Long): Long = lastPresentationNs?.let { it + frameNs } ?: nowNs
}
