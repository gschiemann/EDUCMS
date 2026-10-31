package com.educms.player.security

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class BridgeLifelineTest {
    private fun args(raw: Any) = JSONArray().put(raw)
    private fun banner(active: Boolean, rotation: Int) =
        """{"version":4,"op":"banner","active":$active,"inset":0.1,"rotation":$rotation}"""

    @Test fun holdsNeverWaitForTheNormalWorker() {
        for (args in listOf(JSONArray(), JSONArray().put(true), JSONArray().put(false))) {
            assertTrue(BridgeLifeline.accepts("displayEmergencyHold", args))
        }
    }

    @Test fun bannerStartResizeAndClearStayOrderedWithTheirHold() {
        for (active in listOf(true, false)) for (rotation in listOf(0, 90, 180, 270)) {
            assertTrue(BridgeLifeline.accepts("sharedVideoPrepare", args(banner(active, rotation))))
        }
    }

    @Test fun slowMediaAndDisplayOperationsNeverJoinTheEmergencyLane() {
        for (method in listOf("displayApply", "displaySetSchedule", "getRecentLogs", "ctsSerialConnect", "sharedVideoCommit", "sharedVideoStop")) {
            assertFalse(method, BridgeLifeline.accepts(method, args(banner(true, 0))))
        }
        for (raw in listOf(
            """{"version":4,"op":"intend","url":"https://example.com/video.mp4"}""",
            """{"version":3,"op":"prepare","url":"https://example.com/video.mp4"}""",
            """{"version":4,"op":"release"}""",
        )) assertFalse(BridgeLifeline.accepts("sharedVideoPrepare", args(raw)))
    }

    @Test fun malformedOrUnboundedPayloadsStayOutsideTheEmergencyLane() {
        val valid = banner(true, 0)
        for (raw in listOf(
            "", "not json", valid + " ".repeat(1024),
            valid.replace("0.1", "0.9"), valid.replace("true", "\"true\""),
            valid.replace("\"rotation\":0", "\"rotation\":45"),
            valid.dropLast(1) + """, "url":"https://example.com"}""",
            valid.dropLast(1) + """, "token":"credential"}""",
        )) assertFalse(raw.take(100), BridgeLifeline.accepts("sharedVideoPrepare", args(raw)))
        assertFalse(BridgeLifeline.accepts("sharedVideoPrepare", JSONArray()))
        assertFalse(BridgeLifeline.accepts("sharedVideoPrepare", args(JSONObject(valid))))
    }
}
