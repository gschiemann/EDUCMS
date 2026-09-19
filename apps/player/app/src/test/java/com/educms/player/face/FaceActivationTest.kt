package com.educms.player.face

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * The server → native activation path. The rule that matters most: a reply
 * that does not SAY must never change what is hosted.
 */
class FaceActivationTest {

    @Test
    fun `reads the side count out of a real heartbeat reply`() {
        val body = """{"screenId":"s1","paired":true,"name":"DH43","faceCount":2,"pairingCode":null,"forceUpdatePending":false}"""
        assertEquals(2, FaceActivation.faceCountFrom(body))
        assertEquals(1, FaceActivation.faceCountFrom("""{"paired":true, "faceCount" : 1 }"""))
    }

    @Test
    fun `SILENCE IS NOT ONE - an older API or a failed count changes nothing`() {
        assertNull(FaceActivation.faceCountFrom(null))
        assertNull(FaceActivation.faceCountFrom(""))
        assertNull(FaceActivation.faceCountFrom("""{"screenId":"s1","paired":true,"forceUpdatePending":false}"""))
        assertNull(FaceActivation.faceCountFrom("<html>502 Bad Gateway</html>"))
    }

    @Test
    fun `never more sides than this build can host`() {
        assertEquals(FaceDisplayMap.MAX_FACES, FaceActivation.faceCountFrom("""{"faceCount":40}"""))
        assertEquals(FaceDisplayMap.MAX_FACES, FaceActivation.faceCountFrom("""{"faceCount":99}"""))
    }

    @Test
    fun `junk is silence, never a number`() {
        for (body in listOf(
            """{"faceCount":0}""", """{"faceCount":-2}""", """{"faceCount":"2"}""", """{"faceCount":2.5}""",
            """{"faceCount":2e3}""", """{"faceCount":null}""", """{"faceCount":true}""", """{"faceCount":}""",
            """{"xfaceCount":2}""".replace("xfaceCount", "face_count"),
        )) {
            assertNull("accepted <$body>", FaceActivation.faceCountFrom(body))
        }
    }
}
