package com.educms.player.media

import android.media.MediaCodec
import org.junit.Assert.*
import org.junit.Test

class SharedVideoPolicyTest {
    @Test fun opaqueSurfaceFramesAreNotDiscardedBecauseSizeIsZero() {
        assertTrue(SharedVideoCodecPolicy.render(0,0))
        assertTrue(SharedVideoCodecPolicy.render(42,MediaCodec.BUFFER_FLAG_END_OF_STREAM))
        assertFalse(SharedVideoCodecPolicy.render(0,MediaCodec.BUFFER_FLAG_END_OF_STREAM))
        assertFalse(SharedVideoCodecPolicy.render(42,MediaCodec.BUFFER_FLAG_CODEC_CONFIG))
    }
    @Test fun publicOutputRotationMatchesEachPhysicalSurfaceWithoutDoubleRotation() {
        assertEquals(0,SharedVideoTransform.degrees("PORTRAIT",0,1080,1920))
        assertEquals(90,SharedVideoTransform.degrees("PORTRAIT",0,1920,1080))
        assertEquals(180,SharedVideoTransform.degrees("PORTRAIT",90,1920,1080))
        assertEquals(270,SharedVideoTransform.degrees("LANDSCAPE",0,1080,1920))
        assertEquals(0,SharedVideoTransform.degrees("LANDSCAPE",90,1080,1920))
        assertEquals(270,SharedVideoTransform.degrees("AUTO",270,1920,1080))
    }
    @Test fun pagesCannotCommitAnotherFaceOrRetiredSession() {
        val gate = SharedVideoCommitGate("pair",setOf(0,1))
        assertFalse(gate.commit(2,"pair"))
        assertFalse(gate.commit(1,"retired"))
        assertFalse(gate.commit(0,"pair"))
        assertFalse(gate.commit(0,"pair"))
        assertTrue(gate.commit(1,"pair"))
        assertFalse(gate.commit(1,"pair"))
    }
    @Test fun softwareDecoderDoesNotPretendToBeAHardwareFix() {
        assertTrue(SharedVideoCodecPolicy.hardwareName("OMX.rk.video_decoder.avc"))
        assertTrue(SharedVideoCodecPolicy.hardwareName("c2.vendor.avc.decoder"))
        assertFalse(SharedVideoCodecPolicy.hardwareName("OMX.google.h264.decoder"))
        assertFalse(SharedVideoCodecPolicy.hardwareName("c2.android.avc.decoder"))
        assertFalse(SharedVideoCodecPolicy.hardwareName("OMX.vendor.sw.avc.decoder"))
        assertFalse(SharedVideoCodecPolicy.hardwareName("unknown"))
    }
    @Test fun mediaOriginAllowsOnlyExactStorageWithoutCredentialForwarding() {
        val origin="https://bhdaxzfalaycfopvcopm.supabase.co"
        assertTrue(SharedVideoSourcePolicy.allowed("$origin/storage/v1/object/public/assets/tenant/file.mp4"))
        for (url in listOf("http://bhdaxzfalaycfopvcopm.supabase.co/storage/v1/object/public/assets/x",
            "$origin.evil.com/storage/v1/object/public/assets/x", "$origin:8443/storage/v1/object/public/assets/x",
            "$origin/storage/v1/object/public/assets/../x", "$origin/storage/v1/object/public/assets/%2e%2e/x",
            "$origin/storage/v1/object/public/other/x", "https://user:pass@bhdaxzfalaycfopvcopm.supabase.co/storage/v1/object/public/assets/x")) {
            assertFalse(url,SharedVideoSourcePolicy.allowed(url))
        }
    }
}
