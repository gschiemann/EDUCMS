package com.educms.player.media

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

class DecodeThreadPriorityTest {
    @Test fun theDecodeThreadAsksForTheDisplayClassFirstAndFallsBackInOrder() {
        // Android's values, pinned (a JVM test cannot read android.os.Process).
        assertArrayEquals(intArrayOf(-8, -4), DecodeThreadPriority.DECODE_LADDER)
        val tried = mutableListOf<Int>()
        assertEquals(-8, DecodeThreadPriority.apply(DecodeThreadPriority.DECODE_LADDER) { tried += it })
        assertEquals(listOf(-8), tried)
        tried.clear()
        assertEquals(-4, DecodeThreadPriority.apply(DecodeThreadPriority.DECODE_LADDER) { tried += it; if (it == -8) throw SecurityException("nice") })
        assertEquals(listOf(-8, -4), tried)
    }

    @Test fun aRefusedPriorityNeverThrowsIntoTheDecoder() {
        assertEquals(DecodeThreadPriority.DEFAULT, DecodeThreadPriority.apply(DecodeThreadPriority.DECODE_LADDER) { throw IllegalArgumentException() })
    }

    @Test fun theEngineWiresTheLadderAndTheBackgroundWorkers() {
        // Source guard: the pump raises itself first thing; downloads/verify and the switch read are background.
        val dir = File("src/main/java/com/educms/player/media")
        val renderer = File(dir, "FaceVideoRenderer.kt").readText()
        assertTrue(renderer.contains("private fun decode() {\n        DecodeThreadPriority.raiseDecodeThread("))
        val box = File(dir, "FaceVideoBox.kt").readText()
        assertTrue(box.contains("Thread(DecodeThreadPriority.background(r), \"face-video-download\")"))
        assertTrue(box.contains("Thread(DecodeThreadPriority.background(r), \"face-video-switch\")"))
    }
}
