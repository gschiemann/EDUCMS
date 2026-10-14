package com.educms.player.media

import org.junit.Assert.assertEquals
import org.junit.Test

class NativeVideoSurfaceProbeTest {
    @Test fun aWhiteDecoderBufferIsDistinctFromBlackAndColour() {
        assertEquals(NativeVideoSurfaceProbe.Sample(3, 3, 0),
            NativeVideoSurfaceProbe.sample(intArrayOf(0xffffffff.toInt(), 0xfff7f7f7.toInt(), 0xfffefefe.toInt())))
        assertEquals(NativeVideoSurfaceProbe.Sample(3, 0, 3),
            NativeVideoSurfaceProbe.sample(intArrayOf(0xff000000.toInt(), 0xff080808.toInt(), 0xff010203.toInt())))
        assertEquals(NativeVideoSurfaceProbe.Sample(3, 0, 0),
            NativeVideoSurfaceProbe.sample(intArrayOf(0xffff0000.toInt(), 0xff00ff00.toInt(), 0xff0000ff.toInt())))
    }

    @Test fun brightColoursAreNotMistakenForUniformWhite() {
        assertEquals(NativeVideoSurfaceProbe.Sample(4, 1, 1),
            NativeVideoSurfaceProbe.sample(intArrayOf(0xffffffff.toInt(), 0xff000000.toInt(), 0xffffff00.toInt(), 0xfff6ffff.toInt())))
    }
}
