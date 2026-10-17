package com.educms.player.media

import android.view.PixelCopy
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class NativeVideoSurfaceProbeTest {
    @Test fun spatialSamplesKeepTopHazeSeparateFromTheRestOfTheBuffer() {
        val pixels = intArrayOf(0xffffffff.toInt(), 0xffffffff.toInt(),
            0xff006480.toInt(), 0xff006480.toInt(), 0xff000000.toInt(), 0xff000000.toInt())
        assertEquals(listOf(NativeVideoSurfaceProbe.Band(255, 255, 255, 255),
            NativeVideoSurfaceProbe.Band(0, 100, 128, 255), NativeVideoSurfaceProbe.Band(0, 0, 0, 255)),
            NativeVideoSurfaceProbe.bands(pixels, 2, 3))
    }

    @Test fun partialAlphaIsPreservedInSpatialEvidence() {
        val pixels = intArrayOf(0x7fffffff, 0xffffffff.toInt(), 0xff000000.toInt())
        assertEquals(127, NativeVideoSurfaceProbe.bands(pixels, 1, 3).first().alphaMin)
    }

    @Test fun aWhiteDecoderBufferIsDistinctFromBlackAndColour() {
        assertEquals(NativeVideoSurfaceProbe.Sample(3, 3, 0, uniform = false),
            NativeVideoSurfaceProbe.sample(intArrayOf(0xffffffff.toInt(), 0xfff7f7f7.toInt(), 0xfffefefe.toInt())))
        assertEquals(NativeVideoSurfaceProbe.Sample(3, 0, 3, uniform = false),
            NativeVideoSurfaceProbe.sample(intArrayOf(0xff000000.toInt(), 0xff080808.toInt(), 0xff010203.toInt())))
        assertEquals(NativeVideoSurfaceProbe.Sample(3, 0, 0, uniform = false),
            NativeVideoSurfaceProbe.sample(intArrayOf(0xffff0000.toInt(), 0xff00ff00.toInt(), 0xff0000ff.toInt())))
    }

    @Test fun brightColoursAreNotMistakenForUniformWhite() {
        assertEquals(NativeVideoSurfaceProbe.Sample(4, 1, 1, uniform = false),
            NativeVideoSurfaceProbe.sample(intArrayOf(0xffffffff.toInt(), 0xff000000.toInt(), 0xffffff00.toInt(), 0xfff6ffff.toInt())))
    }

    /**
     * Field 2026-10-17 (lead): the M43's first ten seconds of samples read a uniform
     * Y=0/U=0/V=0 buffer (rgb 0/77/0) while callbacks advanced — PixelCopy could not
     * read the surface (an overlay plane), which is NOT "green on the glass".
     */
    @Test fun aUniformBufferOrAFailedCopyIsNotReadableAndNeverAVerdictAboutTheGlass() {
        val m43 = IntArray(18 * 32) { 0xff004d00.toInt() }
        val s = NativeVideoSurfaceProbe.sample(m43)
        assertTrue(s.uniform)
        assertEquals(0, s.bright); assertEquals(0, s.dark)
        assertFalse(NativeVideoSurfaceProbe.readable(PixelCopy.SUCCESS, s))
        val line = NativeVideoSurfaceProbe.describe(PixelCopy.SUCCESS, s, "top=0/77/0/255 middle=0/77/0/255 bottom=0/77/0/255")
        assertTrue(line, line.startsWith("copy=${PixelCopy.SUCCESS} readable=false uniform=true pixels=576 bright=0 dark=0 "))
        assertTrue(line, line.endsWith(" note=${NativeVideoSurfaceProbe.NOT_READABLE}"))
        // A uniform BLACK buffer is "cannot tell" too — never "black on the glass".
        assertTrue(NativeVideoSurfaceProbe.sample(IntArray(6) { 0xff000000.toInt() }).uniform)
        // A real picture reads as readable on a SUCCESS copy only.
        val picture = NativeVideoSurfaceProbe.sample(intArrayOf(0xff102030.toInt(), 0xff405060.toInt(), 0xff708090.toInt()))
        assertFalse(picture.uniform)
        assertTrue(NativeVideoSurfaceProbe.readable(PixelCopy.SUCCESS, picture))
        assertFalse(NativeVideoSurfaceProbe.readable(PixelCopy.ERROR_SOURCE_INVALID, picture))
        val ok = NativeVideoSurfaceProbe.describe(PixelCopy.SUCCESS, picture, "top=1/2/3/255")
        assertTrue(ok, ok.contains("readable=true uniform=false") && !ok.contains("note="))
        assertFalse(NativeVideoSurfaceProbe.sample(IntArray(0)).uniform)
    }
}
