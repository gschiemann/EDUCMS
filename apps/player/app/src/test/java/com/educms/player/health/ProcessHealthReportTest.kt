package com.educms.player.health

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class ProcessHealthReportTest {

    @Test fun `the wire shape the API schema accepts`() {
        val mem = MemoryPressurePolicy.Record(count = 3, maxLevel = 15, lastLevel = 15, lastAtMs = 1_000, frees = 1, lastFreeAtMs = 1_000)
        val main = MainThreadStallPolicy.State(postedAtMs = 50_000, stallOpen = true, stalls = 2, maxStallMs = 14_000, lastStallMs = 11_000, lastStallEndAtMs = 20_000, stack = "A.b:1")
        val exits = JSONArray().put(JSONObject().put("at", 5L).put("r", 6).put("st", 0).put("imp", 100).put("pssKb", 0).put("rssKb", 0))
        val o = JSONObject(ProcessHealthReport.build(mem, main, exits, 41_000, 80_000, 310, 420, false, 0))
        assertEquals(1, o.getInt("v"))
        assertEquals(40_000L, o.getJSONObject("mem").getLong("ageMs"))
        assertEquals(310L, o.getJSONObject("mem").getLong("rssMb"))
        assertEquals(30_000L, o.getJSONObject("main").getLong("openMs"))
        assertEquals(60_000L, o.getJSONObject("main").getLong("ageMs"))
        assertEquals("A.b:1", o.getJSONObject("main").getString("stack"))
        assertEquals(1, o.getJSONArray("exits").length())
        assertEquals(0, o.getInt("th"))
    }

    @Test fun `absent facts are omitted, never invented`() {
        val o = JSONObject(ProcessHealthReport.build(MemoryPressurePolicy.Record(), MainThreadStallPolicy.State(), null, 0, 0, null, null, null, null))
        assertFalse(o.has("th"))
        assertFalse(o.has("exits"))
        assertFalse(o.getJSONObject("mem").has("ageMs"))
        assertFalse(o.getJSONObject("mem").has("rssMb"))
        assertEquals(0L, o.getJSONObject("main").getLong("openMs"))
    }

    @Test fun `bounded - the stack then the exits go first`() {
        val exits = JSONArray()
        repeat(4) { exits.put(JSONObject().put("at", it.toLong()).put("r", 6).put("desc", "x".repeat(160))) }
        val main = MainThreadStallPolicy.State(stack = "y".repeat(2000))
        val s = ProcessHealthReport.build(MemoryPressurePolicy.Record(), main, exits, 0, 0, 1, 1, true, 9)
        assertTrue(s.length <= ProcessHealthReport.MAX_CHARS)
        assertFalse(JSONObject(s).getJSONObject("main").has("stack"))
        assertFalse(JSONObject(s).has("th")) // 9 is not a thermal status
    }
}
