package com.educms.player.alertwatch

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.IOException
import java.io.InputStream

/**
 * WHAT ONE MANIFEST BODY PROVES (2026-10-05, player 1.1.22).
 *
 * The native alert watch raises a life-safety hold on the strength of this
 * reader, so every shape has a case: the alert the API emits today, the
 * legacy envelope the page still accepts, every "looks like an alert but is
 * not", and every body that is NOT an answer at all — truncated, garbled, a
 * captive portal's HTML — which must never read as "no alert".
 *
 * The fixtures are cut from the producer: `screens.controller.ts`'s
 * emergency, normal, empty and scoreboard manifests open exactly like this.
 */
class ManifestAlertScannerTest {

    private val cap = 8L * 1024 * 1024

    private fun scan(json: String, max: Long = cap): ManifestScan =
        ManifestAlertScanner.scan(ByteArrayInputStream(json.toByteArray(Charsets.UTF_8)), max)

    // ─── the alert the API emits ─────────────────────────────────────

    @Test
    fun `the emergency manifest is an ALERT`() {
        val body = """{"screenId":"7d0c4a3e-1b2f-4c5d-8e9f-0a1b2c3d4e5f","generatedAt":"2026-10-05T02:14:00.000Z",""" +
            """"isEmergency":true,"emergencyType":"LOCKDOWN","emergencySeverity":"CRITICAL","playlists":[{"id":"DEFAULT_EMERGENCY","items":[]}]}"""
        assertEquals(ManifestScan.ALERT, scan(body))
    }

    @Test
    fun `the normal, empty and scoreboard manifests are NO_ALERT`() {
        assertEquals(
            ManifestScan.NO_ALERT,
            scan("""{"version":"1.0","screenId":"s","tenantId":"t","generatedAt":"x","isEmergency":false,"playlists":[{"items":[{"url":"https://cdn/a.mp4"}]}],"hash":"abc"}"""),
        )
        assertEquals(
            ManifestScan.NO_ALERT,
            scan("""{"screenId":"s","playlists":[],"isEmergency":false,"emergencyStatus":"INACTIVE","emptyReason":"NO_SCHEDULE","hash":"empty"}"""),
        )
        // The scoreboard branch carries no isEmergency key at all.
        assertEquals(ManifestScan.NO_ALERT, scan("""{"version":"1.0","screenId":"s","playlists":[],"hash":"h"}"""))
        assertEquals(ManifestScan.NO_ALERT, scan(" \n{ }\n "))
    }

    @Test
    fun `only the JSON literal true counts — the page tests strict equality`() {
        for (v in listOf("\"true\"", "1", "null", "false", "{}", "[true]", "\"yes\"")) {
            assertEquals("isEmergency: $v", ManifestScan.NO_ALERT, scan("""{"isEmergency":$v}"""))
        }
    }

    @Test
    fun `an isEmergency that is not at the top level is not this screen's alert`() {
        assertEquals(
            ManifestScan.NO_ALERT,
            scan("""{"playlists":[{"isEmergency":true,"template":{"zones":[{"defaultConfig":{"isEmergency":true}}]}}],"isEmergency":false}"""),
        )
        // …and text that merely contains the words is not one either.
        assertEquals(ManifestScan.NO_ALERT, scan("""{"message":"\"isEmergency\":true","isEmergency":false}"""))
    }

    @Test
    fun `an escaped key is the same key, as it is for JSON-parse`() {
        assertEquals(ManifestScan.ALERT, scan("""{"isEmergency":true}"""))
    }

    // ─── the legacy envelope the page still accepts ──────────────────

    @Test
    fun `the legacy envelope is an ALERT when active, ACTIVE or typed`() {
        assertEquals(ManifestScan.ALERT, scan("""{"emergency":{"active":true}}"""))
        assertEquals(ManifestScan.ALERT, scan("""{"override":{"status":"ACTIVE"}}"""))
        assertEquals(ManifestScan.ALERT, scan("""{"emergency":{"severity":"HIGH","type":"LOCKDOWN"}}"""))
        assertEquals(ManifestScan.ALERT, scan("""{"isEmergency":false,"override":{"x":[1,{"y":2}],"type":7}}"""))
    }

    @Test
    fun `a legacy envelope that says nothing is NO_ALERT`() {
        for (envelope in listOf(
            """{}""", """{"active":false}""", """{"active":"true"}""", """{"status":"CLEARED"}""",
            """{"type":""}""", """{"type":null}""", """{"type":false}""", """{"type":0}""", """{"type":0.0}""",
        )) {
            assertEquals(envelope, ManifestScan.NO_ALERT, scan("""{"emergency":$envelope}"""))
        }
        // Not an object: `"yes".active` is undefined in the page too.
        assertEquals(ManifestScan.NO_ALERT, scan("""{"emergency":"yes","override":true}"""))
    }

    @Test
    fun `every ambiguity resolves toward the alert`() {
        // Shapes the server never emits, where JSON-parse and a stream could
        // disagree. The watch can only raise, so it reads them as an alert.
        assertEquals(ManifestScan.ALERT, scan("""{"isEmergency":true,"isEmergency":false}"""))
        assertEquals(ManifestScan.ALERT, scan("""{"emergency":{"active":false},"override":{"active":true}}"""))
    }

    // ─── what is NOT an answer ───────────────────────────────────────

    @Test
    fun `a body that is not a complete manifest is MALFORMED, never NO_ALERT`() {
        for (body in listOf(
            "",
            "   ",
            "<html><body>Sign in to the guest network</body></html>",
            "Bad Gateway",
            "[]",
            "true",
            """{"screenId":"s","isEmergency":false""",          // cut off before the brace
            """{"screenId":"s","isEmergency":false,"playlists":[{"items":[""", // cut off deep
            """{"screenId":"s" "isEmergency":false}""",        // missing comma
            """{"screenId":"s","isEmergency":false}}""",       // trailing brace
            """{"screenId":"s","isEmergency":false} extra""",  // trailing text
            """{"isEmergency":truely}""",
            """{"isEmergency":tru""",
            """{"a":"unterminated}""",
            """{"a":"bad \q escape"}""",
            """{'isEmergency':false}""",
        )) {
            assertEquals(body.take(40), ManifestScan.MALFORMED, scan(body))
        }
    }

    @Test
    fun `an ALERT is read at first sight, even when the rest never arrives`() {
        // The connection dropped right after the field: still the server
        // saying there is an alert.
        assertEquals(ManifestScan.ALERT, scan("""{"screenId":"s","generatedAt":"x","isEmergency":true"""))
        assertEquals(ManifestScan.ALERT, scan("""{"screenId":"s","generatedAt":"x","isEmergency":true,"playlists":[{"ite"""))
    }

    @Test
    fun `a huge manifest is read without being held, and an alert at its head is found without reading it`() {
        val filler = "\"zone\":\"" + "x".repeat(1024) + "\""
        val big = StringBuilder("""{"screenId":"s","isEmergency":false,"playlists":[""")
        repeat(3000) { i -> big.append(if (i == 0) "{" else ",{").append(filler).append("}") }
        big.append("]}")
        assertTrue("fixture should be ~3 MB", big.length > 3_000_000)
        assertEquals(ManifestScan.NO_ALERT, scan(big.toString()))

        // The same body past the cap is not an answer…
        assertEquals(ManifestScan.TOO_LARGE, scan(big.toString(), max = 64 * 1024))

        // …but an ALERT is in the first bytes, cap or no cap, and the stream
        // is not read to its end to find it.
        val alert = big.toString().replace("\"isEmergency\":false", "\"isEmergency\":true")
        val counting = CountingStream(alert.toByteArray())
        assertEquals(ManifestScan.ALERT, ManifestAlertScanner.scan(counting, 64 * 1024))
        assertTrue("read ${counting.served} bytes to find a field at byte ~30", counting.served <= 16 * 1024)
    }

    @Test
    fun `nesting deeper than the bound is refused, not recursed into`() {
        val deep = "{\"a\":" + "[".repeat(5000) + "]".repeat(5000) + "}"
        assertEquals(ManifestScan.MALFORMED, scan(deep))
    }

    @Test
    fun `a failing stream is the caller's failure, not a verdict`() {
        val broken = object : InputStream() {
            private val head = """{"screenId":"s","playl""".toByteArray()
            private var i = 0
            override fun read(): Int = if (i < head.size) head[i++].toInt() else throw IOException("connection reset")
        }
        try {
            ManifestAlertScanner.scan(broken, cap)
            fail("a reset connection must surface as an IOException")
        } catch (_: IOException) {
            // expected — NativeAlertWatch turns it into "no response" → UNKNOWN
        }
    }

    // ─── agreement with a real JSON parser ───────────────────────────

    @Test
    fun `it agrees with org-json on what the page's rule says`() {
        val docs = listOf(
            """{"isEmergency":true}""",
            """{"isEmergency":false}""",
            """{"a":{"b":[1,2,{"c":"d\"e\\f"}]},"isEmergency":false,"n":-12.5e3,"t":true,"z":null}""",
            """{"emergency":{"active":true,"type":"LOCKDOWN"}}""",
            """{"emergency":{"active":false,"status":"ACTIVE"}}""",
            """{"override":{"type":"WEATHER"}}""",
            """{"override":{"type":""},"emergency":null}""",
            """{"text":"line\nbreak é中","isEmergency":false}""",
            """{"emergency":[{"active":true}]}""",
        )
        for (doc in docs) {
            val o = JSONObject(doc)
            fun says(name: String): Boolean {
                val e = o.optJSONObject(name) ?: return false
                val type = e.opt("type")
                val typed = when (type) {
                    null, JSONObject.NULL, false -> false
                    is String -> type.isNotEmpty()
                    is Number -> type.toDouble() != 0.0
                    else -> true
                }
                return e.opt("active") == true || e.opt("status") == "ACTIVE" || typed
            }
            val expected = o.opt("isEmergency") == true || says("emergency") || says("override")
            assertEquals(doc, if (expected) ManifestScan.ALERT else ManifestScan.NO_ALERT, scan(doc))
        }
    }

    // ─── the body deadline ───────────────────────────────────────────

    @Test
    fun `a body still arriving at the deadline is cut off`() {
        var now = 0L
        // A proxy that drips one byte per 9 s never trips a 10 s read timeout.
        val drip = object : InputStream() {
            private val body = """{"screenId":"s","isEmergency":false}""".toByteArray()
            private var i = 0
            override fun read(): Int {
                now += 9_000
                return if (i < body.size) body[i++].toInt() else -1
            }

            // What a socket does: one call hands over what has arrived — one byte.
            override fun read(b: ByteArray, off: Int, len: Int): Int {
                val one = read()
                if (one < 0) return -1
                b[off] = one.toByte()
                return 1
            }
        }
        val bounded = DeadlineInputStream(drip, deadlineMs = 30_000) { now }
        try {
            ManifestAlertScanner.scan(bounded, cap)
            fail("the deadline must end a dripping body")
        } catch (e: IOException) {
            assertTrue(now <= 45_000)
        }
    }

    private class CountingStream(private val bytes: ByteArray) : InputStream() {
        var served = 0
        override fun read(): Int = if (served < bytes.size) bytes[served++].toInt() and 0xFF else -1
        override fun read(b: ByteArray, off: Int, len: Int): Int {
            if (served >= bytes.size) return -1
            val n = minOf(len, bytes.size - served)
            System.arraycopy(bytes, served, b, off, n)
            served += n
            return n
        }
    }
}
