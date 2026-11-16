package com.educms.player.diagnostics

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assume
import org.junit.Test
import java.io.File

/** The panel's hardware serial (2026-11-16). Every serial here is synthetic. */
class HardwareSerialPolicyTest {

    private fun sources(
        sdk: Int,
        owner: Boolean = false,
        phoneState: Boolean = false,
        getSerial: () -> String? = { throw SecurityException("not allowed") },
        legacy: () -> String? = { "unknown" },
        props: Map<String, String> = emptyMap(),
        propsThrow: Boolean = false,
    ) = HardwareSerialPolicy.Sources(
        sdkInt = sdk,
        isDeviceOwner = { owner },
        hasReadPhoneState = { phoneState },
        getSerial = getSerial,
        legacySerial = legacy,
        property = { k -> if (propsThrow) throw SecurityException("selinux") else props[k] ?: "" },
    )

    @Test fun `device owner wins on API 26+`() {
        val r = HardwareSerialPolicy.read(sources(33, owner = true, getSerial = { "TESTSERIAL-DO" }, props = mapOf("ro.serialno" to "TESTSERIAL-PROP")))
        assertEquals(HardwareSerialPolicy.Result("TESTSERIAL-DO", "device-owner"), r)
    }

    @Test fun `Build SERIAL below Android 8`() {
        val r = HardwareSerialPolicy.read(sources(25, legacy = { " TESTSERIAL-7 " }))
        assertEquals(HardwareSerialPolicy.Result("TESTSERIAL-7", "build-serial"), r)
    }

    @Test fun `getSerial on 8 to 9 only with the permission already granted`() {
        assertEquals("get-serial", HardwareSerialPolicy.read(sources(28, phoneState = true, getSerial = { "TESTSERIAL-9" })).source)
        assertEquals("none", HardwareSerialPolicy.read(sources(28, phoneState = false, getSerial = { "TESTSERIAL-9" })).source)
        // Android 10+: never without device owner, even with the permission.
        assertEquals("none", HardwareSerialPolicy.read(sources(30, phoneState = true, getSerial = { "TESTSERIAL-11" })).source)
    }

    @Test fun `properties in order, placeholders skipped`() {
        val r = HardwareSerialPolicy.read(sources(30, props = mapOf("ro.serialno" to "0123456789ABCDEF", "ro.boot.serialno" to "TESTSERIAL-BOOT")))
        assertEquals(HardwareSerialPolicy.Result("TESTSERIAL-BOOT", "prop:ro.boot.serialno"), r)
    }

    @Test fun `every rung failing gives none and never throws`() {
        val r = HardwareSerialPolicy.read(
            HardwareSerialPolicy.Sources(
                sdkInt = 33,
                isDeviceOwner = { throw IllegalStateException() },
                hasReadPhoneState = { throw IllegalStateException() },
                getSerial = { throw SecurityException() },
                legacySerial = { throw NoSuchFieldError() },
                property = { throw ClassNotFoundException() },
            ),
        )
        assertEquals(HardwareSerialPolicy.Result(null, "none"), r)
        assertEquals("none", HardwareSerialPolicy.read(sources(33, propsThrow = true)).source)
    }

    @Test fun `normalize refuses placeholders, control characters and over-long values`() {
        for (p in listOf(null, "", "  ", "unknown", "UNKNOWN", "0123456789ABCDEF", "0000000000000000", "ffff", "null")) {
            assertNull(p, HardwareSerialPolicy.normalize(p))
        }
        assertNull(HardwareSerialPolicy.normalize("TEST\nSERIAL"))
        assertNull(HardwareSerialPolicy.normalize("TESTé"))
        assertNull(HardwareSerialPolicy.normalize("x".repeat(64) + "y"))
        assertEquals(64, HardwareSerialPolicy.normalize("x".repeat(63) + "y")!!.length)
        assertFalse(HardwareSerialPolicy.isPlaceholder("TESTSERIAL0001"))
    }

    @Test fun `header is the JSON the API parses`() {
        val h = JSONObject(HardwareSerialPolicy.headerValue(HardwareSerialPolicy.Result("TEST\"SER\\IAL", "prop:ro.serialno")))
        assertEquals(1, h.getInt("v"))
        assertEquals("TEST\"SER\\IAL", h.getString("s"))
        assertEquals("prop:ro.serialno", h.getString("src"))
        val none = JSONObject(HardwareSerialPolicy.headerValue(HardwareSerialPolicy.Result(null, "none")))
        assertEquals("none", none.getString("src"))
        assertFalse(none.has("s"))
        assertEquals("x-venueos-hardware-serial", HardwareSerialPolicy.HEADER)
    }

    @Test fun `wiring - signed heartbeat only, no permission requested`() {
        var dir: File? = File("").absoluteFile
        var root: File? = null
        while (dir != null && root == null) {
            if (File(dir, "src/main/AndroidManifest.xml").isFile) root = dir
            else if (File(dir, "app/src/main/AndroidManifest.xml").isFile) root = File(dir, "app")
            dir = dir.parentFile
        }
        Assume.assumeTrue("module root not found", root != null)
        val hb = File(root, "src/main/java/com/educms/player/heartbeat/HeartbeatService.kt").readText()
        assertTrue(Regex("""if \(nativeAllowed\) runCatching \{\s*setRequestProperty\(\s*com\.educms\.player\.diagnostics\.HardwareSerialPolicy\.HEADER""").containsMatchIn(hb))
        val manifest = File(root, "src/main/AndroidManifest.xml").readText()
        assertFalse("no runtime permission prompt on an unattended screen", manifest.contains("READ_PHONE_STATE"))
        val glue = File(root, "src/main/java/com/educms/player/diagnostics/HardwareSerial.kt").readText()
        assertFalse(glue.contains("requestPermissions"))
    }
}
