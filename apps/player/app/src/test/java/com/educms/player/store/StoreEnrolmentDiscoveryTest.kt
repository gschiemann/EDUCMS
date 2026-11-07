package com.educms.player.store

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

class StoreEnrolmentDiscoveryTest {
    private fun manifest(): JSONObject = JSONObject(javaClass.classLoader!!
        .getResourceAsStream("__fixtures__/store-enrolment-manifest.json")!!.bufferedReader().readText())

    @Test fun `first authenticated source read announces enrolment without a prior native session or web cache`() {
        val seen = ArrayList<Triple<Int, String, Boolean>>()
        lateinit var h: Harness
        h = Harness(onNativeEnrolment = { face, screen, enabled ->
            // The notification must not hold the store monitor while native
            // takes its own monitor (the reverse direction reads this store).
            val read = CountDownLatch(1)
            Thread { h.store.stateBlock(); read.countDown() }.start()
            assertTrue("callback outside store monitor", read.await(1, TimeUnit.SECONDS))
            seen += Triple(face, screen, enabled)
        })
        val clip = Blob("enrolment.mp4", ByteArray(128 * 1024) { 7 })
        h.server.manifests[Kit.SCREEN_0] = manifest()
        h.server.put(clip)
        h.emergencySet(blobs = emptyList())
        h.pump()
        assertEquals(listOf(Triple(0, Kit.SCREEN_0, true)), seen)
        assertTrue("native bytes verified independently of CacheStorage", clip.sha in h.store.readySet())
    }

    @Test fun `a fresh explicit native-first kill switch is announced as false`() {
        val seen = ArrayList<Boolean>()
        val h = Harness(onNativeEnrolment = { _, _, enabled -> seen += enabled })
        h.server.manifests[Kit.SCREEN_0] = manifest().apply { getJSONObject("nativeVideo").put("nativeFirst", false) }
        h.pump()
        assertEquals(listOf(false), seen)
    }

    @Test fun `restart obtains a fresh switch instead of a 304 for the persisted source`() {
        val seen = ArrayList<Boolean>()
        val h = Harness(onNativeEnrolment = { _, _, enabled -> seen += enabled })
        h.server.manifests[Kit.SCREEN_0] = manifest()
        h.pump()
        assertEquals(listOf(true), seen)
        assertNotNull(h.store.lastSelection(0)!!.etag)
        seen.clear()
        h.restart()
        h.pump()
        assertEquals("persisted ETag must not hide enrolment on a new process", listOf(true), seen)
    }

    @Test fun `an emergency read never teaches enrolment or releases the held content set`() {
        var calls = 0
        val h = Harness(onNativeEnrolment = { _, _, _ -> calls++ })
        h.server.manifests[Kit.SCREEN_0] = manifest().put("isEmergency", true)
        h.pump()
        assertEquals(0, calls)
    }

    @Test fun `unbound descriptor fields and absent store authorisation cannot enrol a face`() {
        for ((field, value) in listOf("screenId" to Kit.SCREEN_1, "tenantId" to Kit.TENANT_B,
                "faceIndex" to 1, "store" to false, "nativeFirst" to "true")) {
            var calls = 0
            val h = Harness(onNativeEnrolment = { _, _, _ -> calls++ })
            h.server.manifests[Kit.SCREEN_0] = manifest().apply { getJSONObject("nativeVideo").put(field, value) }
            h.pump()
            assertEquals("invalid $field", 0, calls)
        }
        var calls = 0
        val h = Harness(onNativeEnrolment = { _, _, _ -> calls++ })
        h.server.manifests[Kit.SCREEN_0] = manifest().put("screenId", Kit.SCREEN_1)
        h.pump()
        assertEquals("wrong source identity", 0, calls)
    }
}
