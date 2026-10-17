package com.educms.player.media

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/**
 * MEASUREMENT THAT CANNOT LIE (plan 2026-10-17 §4E, Astra STAB-01).
 *
 * The decoder counters we had (decoded / submitted / late) say when WE handed
 * a frame over, not when the panel showed it. M43 on .40: 868,296 submitted,
 * 387 late, 0 stalls — and a judder you can see. What the compositor actually
 * did is in the render-callback timestamps (`onFrameRendered`'s `nanos`): the
 * interval between consecutive callbacks is the cadence on the glass side of
 * the decoder. A 30 fps clip on a 60 Hz panel must show 33 ms intervals; a
 * bimodal 17 / 50 ms pattern is the judder.
 *
 * Sixteen buckets, CENTRED on multiples of a quarter frame period P/4, so the
 * ideal interval never sits on a bucket edge: bucket k holds intervals in
 * [(k − ½)·P/4, (k + ½)·P/4). At 30 fps (P = 33.3 ms): bucket 2 ≈ 17 ms,
 * bucket 4 = P ± 4.2 ms (the launch gate's "±4 ms of the source frame
 * period"), bucket 6 ≈ 50 ms, bucket 8 = 2P (one frame dropped on the
 * compositor side), bucket 0 < 4 ms (a duplicate callback), bucket 15 holds
 * everything ≥ 3.6 P. Bounded: 16 longs, however long the session runs.
 */
internal class RenderIntervalHistogram(frameNs: Long) {
    val unitNs: Long = (frameNs / 4).coerceAtLeast(1)
    private val buckets = LongArray(BUCKETS)
    var count = 0L; private set
    var minNs = 0L; private set
    var maxNs = 0L; private set
    var lastNs = 0L; private set
    private var sumNs = 0L

    fun bucketOf(deltaNs: Long): Int = ((deltaNs + unitNs / 2) / unitNs).coerceIn(0L, (BUCKETS - 1).toLong()).toInt()

    /** A non-positive delta is a clock artefact, never a frame interval. */
    fun observe(deltaNs: Long) {
        if (deltaNs <= 0L) return
        buckets[bucketOf(deltaNs)]++
        count++
        if (minNs == 0L || deltaNs < minNs) minNs = deltaNs
        if (deltaNs > maxNs) maxNs = deltaNs
        lastNs = deltaNs
        sumNs += deltaNs
    }

    fun buckets(): LongArray = buckets.clone()
    fun onPeriod(): Long = buckets[PERIOD_BUCKET]
    fun meanNs(): Long = if (count == 0L) 0L else sumNs / count

    fun writeTo(j: JSONObject): JSONObject = j
        .put("intervalUnitNs", unitNs)
        .put("intervalBuckets", JSONArray().also { a -> buckets.forEach { a.put(it) } })
        .put("intervalCount", count)
        .put("intervalMinNs", minNs)
        .put("intervalMaxNs", maxNs)
        .put("intervalLastNs", lastNs)
        .put("intervalMeanNs", meanNs())

    companion object {
        const val BUCKETS = 16
        /** The bucket centred on exactly one source frame period (k = 4 → 4 × P/4). */
        const val PERIOD_BUCKET = 4
        fun forFps(fps: Double): RenderIntervalHistogram =
            RenderIntervalHistogram((1_000_000_000.0 / fps.coerceIn(1.0, 240.0)).toLong())
    }
}

/**
 * Per-session timing that survives the process (STAB-01: "preserve
 * interruption totals through session resets and offline periods with a
 * capped persistent queue and explicit overflow counts"). A small bounded
 * queue of completed-session summaries lives in SharedPreferences; the
 * session in progress is checkpointed as `live` so a crash, an OTA or a
 * kill still leaves its last minute on disk, recovered as its own entry on
 * the next boot (`reason: process-ended`). Beyond [capacity] the oldest
 * entry is dropped and [overflow] counts it — nothing is silently lost.
 *
 * Pure over a [Store]; the SharedPreferences adapter is [prefsStore].
 */
internal class NativeTimingLedger(private val store: Store, private val capacity: Int = CAPACITY) {
    interface Store {
        fun read(): String?
        fun write(value: String)
    }

    private val entries = ArrayList<JSONObject>()
    private var live: JSONObject? = null
    var overflow = 0L; private set

    init {
        runCatching {
            val raw = store.read()
            if (raw != null) {
                val j = JSONObject(raw)
                val arr = j.optJSONArray("entries") ?: JSONArray()
                for (i in 0 until arr.length()) arr.optJSONObject(i)?.let { if (entries.size < capacity) entries.add(it) }
                overflow = j.optLong("overflow", 0L).coerceAtLeast(0L)
                live = j.optJSONObject("live")
            }
        }
    }

    val size: Int get() = entries.size
    val hasLive: Boolean get() = live != null

    /** The session the previous process never closed becomes an entry of its own; false when there was none. */
    @Synchronized fun recoverLive(reason: String, atMs: Long): Boolean {
        val l = live ?: return false
        live = null
        append(JSONObject(l.toString()).put("reason", reason).put("at", atMs).put("recovered", true))
        persist()
        return true
    }

    /** Checkpoint the running session (replaces the previous checkpoint). */
    @Synchronized fun live(entry: JSONObject) {
        live = entry
        persist()
    }

    /** The session ended: its summary is queued and the checkpoint cleared. */
    @Synchronized fun record(entry: JSONObject) {
        live = null
        append(entry)
        persist()
    }

    private fun append(entry: JSONObject) {
        entries.add(entry)
        while (entries.size > capacity) {
            entries.removeAt(0)
            overflow++
        }
    }

    /** Bounded: at most [capacity] entries plus the overflow count. */
    @Synchronized fun snapshot(): JSONObject =
        JSONObject().put("entries", JSONArray(entries.map { JSONObject(it.toString()) })).put("overflow", overflow).put("capacity", capacity)

    private fun persist() {
        runCatching {
            val j = JSONObject().put("entries", JSONArray(entries)).put("overflow", overflow)
            live?.let { j.put("live", it) }
            store.write(j.toString())
        }
    }

    companion object {
        const val CAPACITY = 6
        const val PREFS = "native_video_timing"
        const val KEY = "ledger"
        const val REASON_PROCESS_ENDED = "process-ended"

        fun prefsStore(ctx: Context): Store = object : Store {
            private val prefs = ctx.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            override fun read(): String? = prefs.getString(KEY, null)
            override fun write(value: String) { prefs.edit().putString(KEY, value).apply() }
        }

        @Volatile private var shared: NativeTimingLedger? = null

        /** The process-wide ledger; the first use recovers a checkpoint the previous process left behind. */
        fun shared(ctx: Context): NativeTimingLedger {
            shared?.let { return it }
            synchronized(this) {
                shared?.let { return it }
                val l = NativeTimingLedger(prefsStore(ctx))
                l.recoverLive(REASON_PROCESS_ENDED, System.currentTimeMillis())
                shared = l
                return l
            }
        }
    }
}
