package com.educms.player.health

import org.json.JSONArray
import org.json.JSONObject

/**
 * The `x-venueos-process-health` header body (2026-11-09) — pure, so
 * `ProcessHealthReportTest` pins the wire shape the API's zod schema
 * (`apps/api/src/screens/process-health.ts`) accepts:
 *
 *   {"v":1,
 *    "mem":{"n":3,"max":15,"last":15,"ageMs":40000,"frees":1,"rssMb":310,"availMb":420,"low":false},
 *    "main":{"openMs":0,"n":2,"maxMs":14000,"lastMs":11000,"ageMs":600000,"starved":0,"stack":"…"},
 *    "exits":[{"at":1762700000000,"r":6,"st":0,"imp":100,"pssKb":0,"rssKb":0,"desc":"…"}],
 *    "th":0}
 *
 * Every age is the device's own clock at the moment the heartbeat leaves.
 * Bounded: [MAX_CHARS]; over that the stack, then the exits are dropped.
 * Telemetry only — the server never acts on it.
 */
object ProcessHealthReport {

    const val HEADER = "x-venueos-process-health"
    const val MAX_CHARS = 1536

    fun build(
        mem: MemoryPressurePolicy.Record,
        main: MainThreadStallPolicy.State,
        exits: JSONArray?,
        nowElapsedMs: Long,
        nowUptimeMs: Long,
        rssMb: Long?,
        availMb: Long?,
        lowMemory: Boolean?,
        thermalStatus: Int?,
    ): String {
        val m = JSONObject().put("n", mem.count).put("max", mem.maxLevel).put("last", mem.lastLevel).put("frees", mem.frees)
        mem.lastAtMs?.let { m.put("ageMs", (nowElapsedMs - it).coerceAtLeast(0)) }
        rssMb?.let { m.put("rssMb", it.coerceAtLeast(0)) }
        availMb?.let { m.put("availMb", it.coerceAtLeast(0)) }
        lowMemory?.let { m.put("low", it) }

        val t = JSONObject()
            .put("openMs", main.openStallMs(nowUptimeMs))
            .put("n", main.stalls)
            .put("maxMs", main.maxStallMs)
            .put("lastMs", main.lastStallMs)
            .put("starved", main.starved)
        main.lastStallEndAtMs?.let { t.put("ageMs", (nowUptimeMs - it).coerceAtLeast(0)) }
        main.stack?.let { t.put("stack", it) }

        val out = JSONObject().put("v", 1).put("mem", m).put("main", t)
        if (exits != null && exits.length() > 0) out.put("exits", exits)
        if (thermalStatus != null && thermalStatus in 0..6) out.put("th", thermalStatus)

        var s = out.toString()
        if (s.length > MAX_CHARS) { t.remove("stack"); s = out.toString() }
        if (s.length > MAX_CHARS) { out.remove("exits"); s = out.toString() }
        return s
    }
}
