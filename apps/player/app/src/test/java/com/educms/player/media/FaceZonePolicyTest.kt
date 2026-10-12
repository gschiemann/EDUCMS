package com.educms.player.media

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

/** Protocol 3 — positioned native slots (FaceVideoPolicy.kt: FaceZoneMessage / FaceVideoItems / FaceZonePolicy). */
class FaceZonePolicyTest {
    private val screen = "11111111-1111-4111-8111-111111111111"
    private val tenant = "22222222-2222-4222-8222-222222222222"
    private val asset = "33333333-3333-4333-8333-333333333333"
    private val session = "44444444-4444-4444-8444-444444444444"
    private val sha = "a".repeat(64)
    private val url = "https://bhdaxzfalaycfopvcopm.supabase.co/storage/v1/object/public/assets/t/clip.mp4"

    private fun layout(x: Int = 0, y: Int = 0, w: Int = 1920, h: Int = 1080, vw: Int = 1920, vh: Int = 1080, degrees: Int = 0, fit: String = "cover") =
        JSONObject().put("x", x).put("y", y).put("w", w).put("h", h).put("vw", vw).put("vh", vh).put("degrees", degrees).put("fit", fit)

    private fun prepare(slot: String = "item:v1", loop: Boolean = false, mutate: (JSONObject) -> Unit = {}) = JSONObject()
        .put("version", 3).put("op", "prepare").put("screenId", screen).put("revision", "rev-3").put("slot", slot)
        .put("sha256", sha).put("assetId", asset).put("loop", loop).put("layout", layout()).also(mutate).toString()

    private fun items(mutate: (JSONObject) -> Unit = {}) = JSONObject()
        .put("version", 3).put("screenId", screen).put("tenantId", tenant).put("faceIndex", 0).put("revision", "rev-3")
        .put("orientation", "LANDSCAPE")
        .put("items", JSONArray().put(JSONObject().put("slot", "item:v1").put("loop", false)
            .put("asset", JSONObject().put("id", asset).put("url", url).put("sha256", sha).put("size", 1000)
                .put("width", 1920).put("height", 1080).put("fps", 30))))
        .also(mutate)

    @Test fun onlyVersion3MessagesSelectThisEngineAndTheyCarryIdentityNotUrls() {
        val m = FaceZoneMessage.parse(prepare())
        assertTrue(m is FaceZoneMessage.Prepare)
        val r = (m as FaceZoneMessage.Prepare).request
        assertEquals("item:v1", r.slot); assertEquals(0, r.layout.x); assertEquals("cover", r.layout.fit); assertFalse(r.loop)
        // Protocol 1 / 2 requests and garbage flow elsewhere (null).
        assertNull(FaceZoneMessage.parse(JSONObject().put("version", 2).put("screenId", screen).put("revision", "r").put("sha256", sha).put("assetId", asset).toString()))
        assertNull(FaceZoneMessage.parse(JSONObject().put("version", 1).put("screenId", screen).toString()))
        assertNull(FaceZoneMessage.parse("garbage"))
        assertNull(FaceZoneMessage.parse("{" + " ".repeat(4000) + "}"))
        assertNull(FaceZoneMessage.parse(prepare { it.put("op", "steal") }))
        assertNull(FaceZoneMessage.parse(prepare(slot = "video:1")))
        assertNull(FaceZoneMessage.parse(prepare { it.put("screenId", "nope") }))
        assertNull(FaceZoneMessage.parse(prepare { it.put("sha256", "xyz") }))
        // An extra `url` field is ignored: the request never carries where the file lives.
        assertEquals(r, (FaceZoneMessage.parse(prepare { it.put("url", url) }) as FaceZoneMessage.Prepare).request)
        val lay = FaceZoneMessage.parse(JSONObject().put("version", 3).put("op", "layout").put("sessionId", session).put("layout", layout(x = 10, w = 100)).toString())
        assertEquals(10, (lay as FaceZoneMessage.Layout).layout.x)
        assertEquals(session, (FaceZoneMessage.parse(JSONObject().put("version", 3).put("op", "play").put("sessionId", session).toString()) as FaceZoneMessage.Play).sessionId)
        assertNull(FaceZoneMessage.parse(JSONObject().put("version", 3).put("op", "play").put("sessionId", "nope").toString()))
    }

    @Test fun layoutMustBeARightAngleRectInsideTheViewport() {
        for (bad in listOf(layout(w = 1), layout(degrees = 45), layout(fit = "stretch"), layout(x = 1900, w = 100), layout(vw = 0), layout(x = -1)))
            assertNull("$bad", FaceZoneMessage.parse(prepare { it.put("layout", bad) }))
        for (deg in listOf(0, 90, 180, 270)) assertNotNull(FaceZoneMessage.parse(prepare { it.put("layout", layout(degrees = deg)) }))
        for (fit in listOf("cover", "contain", "fill")) assertNotNull(FaceZoneMessage.parse(prepare { it.put("layout", layout(fit = fit)) }))
    }

    @Test fun nativePlaysOnlyASlotThisFacesOwnManifestListedWithTheSameFileIdentity() {
        val d = FaceVideoItems.parse(items())
        val r = (FaceZoneMessage.parse(prepare()) as FaceZoneMessage.Prepare).request
        val item = d.find(r)
        assertNotNull(item)
        val desc = d.descriptor(item!!, "contain")
        assertEquals(screen, desc.screenId); assertEquals(sha, desc.sha256); assertEquals("contain", desc.fit); assertEquals(1920, desc.width)
        assertNull(d.find((FaceZoneMessage.parse(prepare(slot = "item:v2")) as FaceZoneMessage.Prepare).request))
        assertNull(d.find((FaceZoneMessage.parse(prepare { it.put("sha256", "b".repeat(64)) }) as FaceZoneMessage.Prepare).request))
        assertNull(d.find((FaceZoneMessage.parse(prepare { it.put("revision", "rev-9") }) as FaceZoneMessage.Prepare).request))
        assertNull(d.find((FaceZoneMessage.parse(prepare(loop = true)) as FaceZoneMessage.Prepare).request))
        assertNull(d.find((FaceZoneMessage.parse(prepare { it.put("assetId", "55555555-5555-4555-8555-555555555555") }) as FaceZoneMessage.Prepare).request))
    }

    @Test fun manifestItemsFailClosed() {
        assertNotNull(FaceVideoItems.parse(items()))
        fun bad(mutate: (JSONObject) -> Unit) = assertThrows(Exception::class.java) { FaceVideoItems.parse(items(mutate)) }
        bad { it.put("version", 2) }
        bad { it.put("faceIndex", 2) }
        bad { it.put("items", JSONArray()) }
        bad { it.getJSONArray("items").getJSONObject(0).getJSONObject("asset").put("url", "https://evil.example/storage/v1/object/public/assets/x.mp4") }
        bad { it.getJSONArray("items").getJSONObject(0).getJSONObject("asset").put("fps", 60) }
        bad { it.getJSONArray("items").getJSONObject(0).put("slot", "video:1") }
        bad { it.getJSONArray("items").put(it.getJSONArray("items").getJSONObject(0)) } // duplicate slot
        bad { it.put("orientation", "UPSIDE") }
    }

    @Test fun pageRectScalesToTheWebViewAndClampsInsideIt() {
        val l = FaceZoneLayout.parse(layout(x = 100, y = 50, w = 800, h = 400, vw = 1920, vh = 1080))
        // 3× device pixel ratio: a 1920×1080 layout viewport on a 5760×3240 WebView.
        assertArrayEquals(intArrayOf(300, 150, 2400, 1200), FaceZonePolicy.rect(l, 5760, 3240))
        // Same size: identity.
        assertArrayEquals(intArrayOf(100, 50, 800, 400), FaceZonePolicy.rect(l, 1920, 1080))
        // A WebView narrower than the page's viewport scales down and rounds.
        assertArrayEquals(intArrayOf(50, 25, 400, 200), FaceZonePolicy.rect(l, 960, 540))
        assertArrayEquals(intArrayOf(0, 0, 0, 0), FaceZonePolicy.rect(l, 0, 1080))
        // Parked: entirely to the right of the WebView, same size.
        assertArrayEquals(intArrayOf(1920, 50, 800, 400), FaceZonePolicy.parked(intArrayOf(100, 50, 800, 400), 1920))
    }

    @Test fun onlyOverlappingOnGlassSessionsAreSupersededAndOnlyMovesAreLive() {
        assertTrue(FaceZonePolicy.overlaps(intArrayOf(0, 0, 100, 100), intArrayOf(50, 50, 100, 100)))
        assertFalse(FaceZonePolicy.overlaps(intArrayOf(0, 0, 100, 100), intArrayOf(100, 0, 100, 100)))
        assertFalse(FaceZonePolicy.overlaps(intArrayOf(0, 0, 0, 0), intArrayOf(0, 0, 100, 100)))
        val a = FaceZoneLayout.parse(layout())
        assertTrue(FaceZonePolicy.moveOnly(a, FaceZoneLayout.parse(layout(x = 10, w = 100))))
        assertFalse(FaceZonePolicy.moveOnly(a, FaceZoneLayout.parse(layout(degrees = 90))))
        assertFalse(FaceZonePolicy.moveOnly(a, FaceZoneLayout.parse(layout(fit = "contain"))))
    }

    @Test fun decoderBudgetReservesTheLastDecoderForThePictureOnGlass() {
        // Unknown advertised limit: three across the box; a pre-roll stops one short.
        assertTrue(FaceZonePolicy.decoderAllowed(1, 0, preroll = true))
        assertFalse(FaceZonePolicy.decoderAllowed(2, 0, preroll = true))
        assertTrue(FaceZonePolicy.decoderAllowed(2, 0, preroll = false))
        assertFalse(FaceZonePolicy.decoderAllowed(3, 0, preroll = false))
        // An advertised limit replaces it, capped at four.
        assertTrue(FaceZonePolicy.decoderAllowed(3, 16, preroll = false))
        assertFalse(FaceZonePolicy.decoderAllowed(4, 16, preroll = false))
        assertFalse(FaceZonePolicy.decoderAllowed(1, 2, preroll = true))
        assertTrue(FaceZonePolicy.decoderAllowed(1, 2, preroll = false))
        assertFalse(FaceZonePolicy.decoderAllowed(2, 2, preroll = false))
        // Protocol 2's own rule is untouched: one decoder when nothing is advertised, never more than two.
        assertTrue(FaceVideoPolicy.decoderAllowed(0, 0))
        assertFalse(FaceVideoPolicy.decoderAllowed(1, 0))
        assertTrue(FaceVideoPolicy.decoderAllowed(1, 4))
        assertFalse(FaceVideoPolicy.decoderAllowed(2, 4))
        assertEquals(10 * 60 * 1000L, FaceZonePolicy.HOLD_MAX_MS)
    }
}
