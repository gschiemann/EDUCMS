package com.educms.player.settings

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The wire format against the REAL org.json parser (it is on the test
 * classpath). The two properties that matter most: a malformed or foreign
 * block changes nothing, and no passphrase is ever written to disk.
 */
class DeviceSettingsWireTest {

    private fun block(json: String) = JSONObject(json)

    @Test fun aFullSetParsesInKeyOrderAndUnknownKeysAreIgnored() {
        val r = DeviceSettingsWire.parseReply(
            block(
                """{"schema":1,"rev":7,"items":{
                  "volume":{"id":"r5","v":40},
                  "brightness":{"id":"r7","v":80},
                  "reboot":{"id":"r7","v":true},
                  "autoTime":{"id":"r2","v":true},
                  "ntpServer":{"id":"r3","v":"time.google.com"},
                  "screenOffTimeoutMs":{"id":"r4","v":2147483647},
                  "attentiveTimeoutMs":{"id":"r4","v":-1},
                  "wifi":{"id":"r6","v":{"ssid":"Lobby","security":"wpa2","hidden":true,"passphrase":"correct horse"}}}}""",
            ),
        ) as DeviceSettingsWire.Reply.Full
        assertEquals(7, r.rev)
        assertEquals(
            listOf(
                DeviceSettingKey.BRIGHTNESS, DeviceSettingKey.VOLUME, DeviceSettingKey.SCREEN_OFF_TIMEOUT,
                DeviceSettingKey.ATTENTIVE_TIMEOUT, DeviceSettingKey.AUTO_TIME, DeviceSettingKey.NTP_SERVER,
                DeviceSettingKey.WIFI,
            ),
            r.items.map { it.key },
        )
        assertEquals(DesiredValue.IntValue(80), r.items[0].value)
        assertEquals(DesiredValue.IntValue(Int.MAX_VALUE), r.items[2].value)
        assertEquals(DesiredValue.IntValue(-1), r.items[3].value)
        assertEquals(DesiredValue.WifiValue("Lobby", "wpa2", true, "correct horse"), r.items.last().value)
    }

    @Test fun sameMeansTheHeldSetIsCurrentAndAnEmptySetMeansManageNothing() {
        assertEquals(DeviceSettingsWire.Reply.Same(7), DeviceSettingsWire.parseReply(block("""{"schema":1,"rev":7,"same":true}""")))
        assertNull("rev 0 cannot be 'same'", DeviceSettingsWire.parseReply(block("""{"schema":1,"rev":0,"same":true}""")))
        val empty = DeviceSettingsWire.parseReply(block("""{"schema":1,"rev":0,"items":{}}""")) as DeviceSettingsWire.Reply.Full
        assertTrue(empty.items.isEmpty())
    }

    @Test fun aMalformedBlockIsNoCommandAtAll() {
        for (bad in listOf(
            """{"schema":2,"rev":7,"items":{}}""",
            """{"rev":7,"items":{}}""",
            """{"schema":1,"rev":-1,"items":{}}""",
            """{"schema":1,"rev":1.5,"items":{}}""",
            """{"schema":1,"rev":"7","items":{}}""",
            """{"schema":1,"rev":7}""",
            """{"schema":1,"rev":7,"items":[]}""",
        )) {
            assertNull(bad, DeviceSettingsWire.parseReply(block(bad)))
        }
        assertNull(DeviceSettingsWire.parseReply(null))
    }

    @Test fun anItemWithoutAProperIdentityIsDroppedAndAWrongTypeIsReportedAsInvalid() {
        val r = DeviceSettingsWire.parseReply(
            block(
                """{"schema":1,"rev":3,"items":{
                  "brightness":{"id":"3","v":80},
                  "volume":{"id":"r3; drop","v":40},
                  "autoTime":{"id":"r3","v":"yes"},
                  "screenOffTimeoutMs":{"id":"r3","v":60000.5},
                  "rotationLock":{"id":"r3","v":true}}}""",
            ),
        ) as DeviceSettingsWire.Reply.Full
        assertEquals(listOf(DeviceSettingKey.SCREEN_OFF_TIMEOUT, DeviceSettingKey.ROTATION_LOCK, DeviceSettingKey.AUTO_TIME).sorted(), r.items.map { it.key }.sorted())
        assertEquals(DesiredValue.Invalid, r.items.first { it.key == DeviceSettingKey.AUTO_TIME }.value)
        assertEquals(DesiredValue.Invalid, r.items.first { it.key == DeviceSettingKey.SCREEN_OFF_TIMEOUT }.value)
    }

    @Test fun theStoredSetNeverContainsAPassphrase() {
        val items = listOf(
            DesiredItem(DeviceSettingKey.WIFI, "r6", DesiredValue.WifiValue("Lobby", "wpa2", false, "correct horse battery")),
            DesiredItem(DeviceSettingKey.BRIGHTNESS, "r7", DesiredValue.IntValue(80)),
        )
        val stored = DeviceSettingsWire.encodeItems(items)
        assertFalse(stored.contains("correct horse"))
        assertFalse(stored.contains("passphrase"))
        val back = DeviceSettingsWire.decodeItems(stored)
        assertEquals(DesiredValue.WifiValue("Lobby", "wpa2", false, null), back.first { it.key == DeviceSettingKey.WIFI }.value)
        assertEquals(DesiredValue.IntValue(80), back.first { it.key == DeviceSettingKey.BRIGHTNESS }.value)
        assertTrue(DeviceSettingsWire.decodeItems("not json").isEmpty())
        assertTrue(DeviceSettingsWire.decodeItems(null).isEmpty())
    }

    @Test fun anAckRoundTripsAndGarbageDecodesToNothing() {
        val a = DeviceSettingsPolicy.Ack("r7", DeviceSettingsPolicy.Status.PENDING, DeviceSettingCodes.NOT_TAKEN, 2, 12_345L, 9, 1_760_000_000_000L)
        assertEquals(a, DeviceSettingsWire.decodeAck(DeviceSettingsWire.encodeAck(a)))
        val bare = DeviceSettingsPolicy.Ack("r1", DeviceSettingsPolicy.Status.APPLIED)
        assertEquals(bare, DeviceSettingsWire.decodeAck(DeviceSettingsWire.encodeAck(bare)))
        for (bad in listOf(null, "", "{}", """{"id":"x","st":"applied"}""", """{"id":"r1","st":"done"}""", "[")) {
            assertNull(bad, DeviceSettingsWire.decodeAck(bad))
        }
    }

    private fun worstCaseReport(): DeviceSettingsWire.Report {
        val acks = DeviceSettingKey.values().associateWith {
            DeviceSettingsPolicy.Ack("r9999999999", DeviceSettingsPolicy.Status.FAILED, DeviceSettingCodes.ALREADY_SET, 99, 1L, 1, Long.MAX_VALUE)
        }
        return DeviceSettingsWire.Report(
            rev = Int.MAX_VALUE,
            need = true,
            sdk = 35,
            capabilities = DeviceSettingKey.values().associateWith { DeviceSettingCodes.NO_SECURE_SETTINGS },
            observed = mapOf(
                DeviceSettingKey.BRIGHTNESS to 100,
                DeviceSettingKey.VOLUME to 100,
                DeviceSettingKey.SCREEN_OFF_TIMEOUT to Int.MAX_VALUE,
                DeviceSettingKey.ATTENTIVE_TIMEOUT to 86_400_000,
                DeviceSettingKey.ROTATION_LOCK to true,
                DeviceSettingKey.AUTO_TIME to false,
                DeviceSettingKey.AUTO_TIME_ZONE to false,
                DeviceSettingKey.NTP_SERVER to ("a".repeat(63) + ".").repeat(3) + "b".repeat(61),
                DeviceSettingKey.WIFI to DeviceSettingsWire.WifiObserved("☕".repeat(10), DeviceSettingsFacts.WIFI_REJECTED),
            ),
            acks = acks,
            load = DeviceLoadMath.Load(6, Long.MAX_VALUE, 10.0, 100, 100, 1_048_576, 1_048_576, true, -40, 16),
            wifi = DeviceSettingsWire.WifiFacts(via = "suggestion", radio = true, dialog = true, wpa3 = true, joined = true),
            net = DeviceSettingsWire.NetStatus(
                transport = "wifi", validated = true, ssid = "☕".repeat(10), rssi = -126, bars = 4,
                ip = "ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff", auto = true, ethernetLink = true,
            ),
        )
    }

    @Test fun aWifiItemCarriesPermanentThroughTheStoreButNeverItsPassphrase() {
        val r = DeviceSettingsWire.parseReply(
            block("""{"schema":1,"rev":8,"items":{"wifi":{"id":"r8","v":{"ssid":"Lobby","security":"wpa2","permanent":true,"passphrase":"correct horse"}}}}"""),
        ) as DeviceSettingsWire.Reply.Full
        val v = r.items.single().value as DesiredValue.WifiValue
        assertTrue(v.permanent)
        val stored = DeviceSettingsWire.encodeItems(r.items)
        assertFalse(stored.contains("correct horse"))
        assertTrue(stored.contains("\"permanent\":true"))
        assertEquals(v.withoutSecret(), DeviceSettingsWire.decodeItems(stored).single().value)
        // An older server never sends it: false, and nothing new is stored.
        val plain = DeviceSettingsWire.parseValue(DeviceSettingKey.WIFI, JSONObject("""{"ssid":"Lobby","security":"open"}""")) as DesiredValue.WifiValue
        assertFalse(plain.permanent)
        assertFalse(DeviceSettingsWire.encodeItems(listOf(DesiredItem(DeviceSettingKey.WIFI, "r1", plain))).contains("permanent"))
        assertFalse(v.toString().contains("correct horse"))
    }

    @Test fun theReportCarriesWifiFactsAndTheConnectionAsOptionalBlocks() {
        val text = DeviceSettingsWire.encodeReport(
            DeviceSettingsWire.Report(
                rev = 3, need = false, sdk = 25, capabilities = emptyMap(), observed = emptyMap(), acks = emptyMap(),
                wifi = DeviceSettingsWire.WifiFacts(via = "legacy", radio = false, dialog = false, wpa3 = false, joined = null),
                net = DeviceSettingsWire.NetStatus(transport = "ethernet", validated = true, ip = "10.0.0.12", auto = null, ethernetLink = true),
            ),
        )
        val o = JSONObject(text)
        val wifi = o.getJSONObject("wifi")
        assertEquals("legacy", wifi.getString("via"))
        assertFalse(wifi.getBoolean("radio"))
        assertFalse("unknown is omitted, never guessed", wifi.has("joined"))
        val net = o.getJSONObject("net")
        assertEquals("ethernet", net.getString("t"))
        assertEquals("10.0.0.12", net.getString("ip"))
        assertFalse(net.has("auto"))
        assertFalse(net.has("ssid"))
    }

    @Test fun theReportStaysUnderTheServersLimitEvenInTheWorstCase() {
        val text = DeviceSettingsWire.encodeReport(worstCaseReport())
        assertTrue("${text.length} chars", text.length <= DeviceSettingsWire.MAX_REPORT_CHARS)
        val o = JSONObject(text)
        assertEquals(1, o.getInt("schema"))
        assertTrue(o.getBoolean("need"))
        assertEquals(DeviceSettingKey.values().size, o.getJSONObject("ack").length())
        // Over the limit, the optional blocks give way before the read-back values.
        assertFalse("the connection line gives way first", o.has("net"))
        assertTrue(o.getJSONObject("obs").has("wifi"))
    }

    @Test fun theHeaderIsPrintableAsciiAndStillCarriesEveryCharacter() {
        val text = DeviceSettingsWire.encodeReport(worstCaseReport())
        assertTrue(text.all { it.code in 0x20..0x7e })
        // The JSON escape reads back as the original SSID.
        assertEquals("☕".repeat(10), JSONObject(text).getJSONObject("obs").getJSONObject("wifi").getString("ssid"))
        assertEquals("plain", DeviceSettingsWire.asciiJson("plain"))
        assertEquals("caf\\u00e9", DeviceSettingsWire.asciiJson("café"))
    }

    @Test fun anUnreadableValueIsOmittedNeverGuessedAndTheLoadBlockIsNumbersOnly() {
        val text = DeviceSettingsWire.encodeReport(
            DeviceSettingsWire.Report(
                rev = 3, need = false, sdk = 33,
                capabilities = mapOf(DeviceSettingKey.VOLUME to DeviceSettingCodes.OK),
                observed = mapOf(DeviceSettingKey.VOLUME to 40),
                acks = emptyMap(),
                load = DeviceLoadMath.Load(thermalStatus = 1, processCpuPercent = 12),
            ),
        )
        val o = JSONObject(text)
        assertEquals(40, o.getJSONObject("obs").getInt("volume"))
        assertFalse(o.getJSONObject("obs").has("brightness"))
        val load = o.getJSONObject("load")
        assertEquals(setOf("thermal", "cpu"), load.keys().asSequence().toSet())
        assertEquals(1, load.getInt("thermal"))
    }

    @Test fun integersAreExactOrNothing() {
        assertEquals(80, DeviceSettingsWire.intOrNull(80))
        assertEquals(80, DeviceSettingsWire.intOrNull(80L))
        assertEquals(80, DeviceSettingsWire.intOrNull(80.0))
        assertNull(DeviceSettingsWire.intOrNull(80.5))
        assertNull(DeviceSettingsWire.intOrNull(Double.NaN))
        assertNull(DeviceSettingsWire.intOrNull(3_000_000_000L))
        assertNull(DeviceSettingsWire.intOrNull("80"))
    }
}
