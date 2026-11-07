package com.educms.player.security

import org.json.JSONObject
import org.json.JSONArray
import org.junit.Assert.*
import org.junit.Test
import java.io.File

class BridgeNonceDeliveryTest {
    private fun accept(delivery: BridgeNonceDelivery, checkpoint: Long): BridgeNonceDelivery.Attempt {
        val attempt = delivery.next(checkpoint)!!
        assertTrue(delivery.acknowledge(attempt, JSONObject.quote(attempt.acknowledgement)))
        return attempt
    }

    @Test fun `commit and same-URL reload each need delivery even after outgoing page acknowledged`() {
        val delivery = BridgeNonceDelivery()
        val nonce = BridgeNonce()
        accept(delivery, delivery.begin()) // start may run in outgoing same-origin document
        nonce.arm()
        repeat(3) { // commit, finish, same-URL reload: no lifetime armed shortcut
            val checkpoint = delivery.begin()
            assertTrue(nonce.armed())
            assertTrue(delivery.pending(checkpoint))
            accept(delivery, checkpoint)
            assertFalse(delivery.pending(checkpoint))
            assertNull(delivery.next(checkpoint))
        }
    }

    @Test fun `old document and out-of-order attempts cannot acknowledge the current checkpoint`() {
        val delivery = BridgeNonceDelivery()
        val old = delivery.next(delivery.begin())!!
        val current = delivery.begin()
        val first = delivery.next(current)!!
        val second = delivery.next(current)!!
        assertFalse(delivery.acknowledge(old, JSONObject.quote(old.acknowledgement)))
        assertFalse(delivery.acknowledge(first, JSONObject.quote(first.acknowledgement)))
        assertTrue(delivery.pending(current))
        assertTrue(delivery.acknowledge(second, JSONObject.quote(second.acknowledgement)))
    }

    @Test fun `renderer replacement and destruction retire callbacks and retries`() {
        val delivery = BridgeNonceDelivery()
        val oldCheckpoint = delivery.begin()
        val old = delivery.next(oldCheckpoint)!!
        delivery.invalidate()
        assertFalse(delivery.isCurrent(oldCheckpoint))
        assertFalse(delivery.acknowledge(old, JSONObject.quote(old.acknowledgement)))
        assertNull(delivery.next(oldCheckpoint))
        accept(delivery, delivery.begin())
    }

    @Test fun `failed or missing injection acknowledgements exhaust a bounded budget without opening gate`() {
        val delivery = BridgeNonceDelivery(3)
        val checkpoint = delivery.begin()
        val nonce = BridgeNonce()
        for (result in listOf(null, "1", "\"prefix1suffix\"")) {
            val attempt = delivery.next(checkpoint)!!
            assertFalse(delivery.acknowledge(attempt, result))
            assertFalse(nonce.accepts(null))
            assertFalse(nonce.accepts("wrong"))
        }
        assertNull(delivery.next(checkpoint))
        assertFalse(delivery.pending(checkpoint))
        assertFalse(delivery.isDelivered(checkpoint))
    }

    @Test fun `only exact JSON acknowledgement from the latest attempt counts`() {
        val delivery = BridgeNonceDelivery()
        val attempt = delivery.next(delivery.begin())!!
        for (wrong in listOf(null, attempt.acknowledgement, "\"${attempt.acknowledgement}extra\"", "true", "1")) {
            assertFalse(delivery.acknowledge(attempt, wrong))
        }
        assertTrue(delivery.acknowledge(attempt, JSONObject.quote(attempt.acknowledgement)))
    }

    @Test fun `origin checks reject redirect hosts lookalikes ports schemes and opaque documents`() {
        val origin = "https://venue-os.app"
        for (url in listOf("https://venue-os.app/player", "https://venue-os.app:443/player", "https://VENUE-OS.APP/player?a=1")) {
            assertTrue(url, BridgeNonceDelivery.trustedUrl(url, origin))
        }
        for (url in listOf(null, "https://venue-os.app.evil.test", "https://sub.venue-os.app/player", "https://venue-os.app:444/player",
            "http://venue-os.app/player", "about:blank", "data:text/html,test", "https://venue-os.app@evil.test", "https://user@venue-os.app", "not a URL")) {
            assertFalse(url, BridgeNonceDelivery.trustedUrl(url, origin))
        }
    }

    @Test fun `injection refuses malformed values and never contains an ungated retrieval method`() {
        assertNull(BridgeNonceDelivery.script("wrong", "https://venue-os.app", "test"))
        assertNull(BridgeNonceDelivery.script("a".repeat(64), "null", "test"))
        val script = BridgeNonceDelivery.script("a".repeat(64), "https://venue-os.app", "checkpoint-test")!!
        assertTrue(script.contains("window.top!==window"))
        assertTrue(script.contains("window.location.origin!==\"https://venue-os.app\""))
        // Browser acceptance uses the actual compiled producer, never a
        // hand-written copy of its security-sensitive injection script.
        val fixture = JSONObject().put("origin", "https://trusted-player.test")
            .put("script", BridgeNonceDelivery.script("a".repeat(64), "https://trusted-player.test", "checkpoint-test"))
            .put("global", BridgeNonce.JS_GLOBAL).put("acknowledgement", "checkpoint-test")
        fixture.put("defaultPorts", JSONArray(listOf("https://TRUSTED-PLAYER.test:443", "http://trusted-player.test:80").map { configured ->
            JSONObject().put("origin", BridgeNonceDelivery.canonicalOrigin(configured))
                .put("script", BridgeNonceDelivery.script("a".repeat(64), configured, "checkpoint-test"))
        }))
        File("build/nonce-delivery-fixture.json").writeText(fixture.toString())
    }
}
