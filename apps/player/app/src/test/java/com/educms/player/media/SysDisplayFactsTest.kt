package com.educms.player.media

import com.educms.player.media.DeviceClassPolicy.SysDisplayFacts
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

/**
 * 1.1.43 — what the panel firmware lists (sysfs), read-only and bounded:
 * the Amlogic `display/mode` + `disp_cap` shape, the Rockchip `fb0/modes`
 * shape, an absent or unreadable path, and every bound on the wire.
 */
class SysDisplayFactsTest {
    private fun reader(files: Map<String, String?>): (String) -> String? = { files[it] }

    @Test fun amlogicModeAndCapabilitiesAreReadInTheirOwnShape() {
        val facts = SysDisplayFacts.read(reader(mapOf(
            "/sys/class/display/mode" to "2160p30hz\n",
            "/sys/class/amhdmitx/amhdmitx0/disp_cap" to "480p60hz\n720p60hz\n1080p60hz\n2160p30hz*\n2160p60hz\n",
        )))
        assertEquals("2160p30hz", facts.mode)
        assertEquals(listOf("480p60hz", "720p60hz", "1080p60hz", "2160p30hz*", "2160p60hz"), facts.caps)
        assertTrue(facts.any)
        val j = facts.writeTo(JSONObject().put("class", "amlogic/android-13"))
        assertEquals("2160p30hz", j.getString("sysDisplayMode"))
        assertEquals(5, j.getJSONArray("sysDisplayCaps").length())
        assertEquals("2160p30hz*", j.getJSONArray("sysDisplayCaps").getString(3))
        assertEquals("amlogic/android-13", j.getString("class"))
    }

    @Test fun rockchipModesAreTheSecondCapabilityPathAndAnAbsentModeStaysAbsent() {
        val facts = SysDisplayFacts.read(reader(mapOf(
            "/sys/class/graphics/fb0/modes" to "U:1920x1080p-60\nU:1920x1080p-50\nU:1280x720p-60\n",
        )))
        assertNull(facts.mode)
        assertEquals(listOf("U:1920x1080p-60", "U:1920x1080p-50", "U:1280x720p-60"), facts.caps)
        val j = facts.writeTo(JSONObject())
        assertFalse(j.has("sysDisplayMode")); assertEquals(3, j.getJSONArray("sysDisplayCaps").length())
        // The Amlogic capability path wins when both exist (one list, never a merge).
        val both = SysDisplayFacts.read(reader(mapOf(
            "/sys/class/amhdmitx/amhdmitx0/disp_cap" to "2160p30hz*\n",
            "/sys/class/graphics/fb0/modes" to "U:1920x1080p-60\n",
        )))
        assertEquals(listOf("2160p30hz*"), both.caps)
    }

    @Test fun nothingReadableIsNothingReportedAndTheReaderNeverThrows() {
        val none = SysDisplayFacts.read(reader(emptyMap()))
        assertNull(none.mode); assertTrue(none.caps.isEmpty()); assertFalse(none.any)
        assertEquals("{}", none.writeTo(JSONObject()).toString())
        val empty = SysDisplayFacts.read(reader(mapOf("/sys/class/display/mode" to "\n\n", "/sys/class/amhdmitx/amhdmitx0/disp_cap" to "")))
        assertNull(empty.mode); assertTrue(empty.caps.isEmpty())
        val throwing = SysDisplayFacts.read { throw IllegalStateException("sysfs exploded") }
        assertFalse(throwing.any)
        // The real reader on a path that does not exist on any build machine: null, never an exception.
        assertNull(SysDisplayFacts.readBounded("/sys/class/this-path-does-not-exist/mode"))
    }

    @Test fun everyStringIsBoundedAndStrippedBeforeItLeavesTheBox() {
        val junk = "2160p30hz\u0000 <script>alert(1)</script> \"quoted\" ; rm -rf /tmp"
        assertEquals("2160p30hzscriptalert1/script", SysDisplayFacts.parseMode(junk + "\n").let { it!!.take(28) })
        assertTrue(SysDisplayFacts.parseMode("x".repeat(400))!!.length == SysDisplayFacts.MODE_MAX)
        val caps = SysDisplayFacts.parseCaps((1..40).joinToString("\n") { "mode-$it-" + "y".repeat(60) })
        assertEquals(SysDisplayFacts.CAPS_MAX, caps.size)
        for (c in caps) assertTrue(c, c.length <= SysDisplayFacts.CAP_MAX && Regex("^[A-Za-z0-9:_.*+/@-]+$").matches(c))
        // Duplicates and blank lines collapse; a CR/LF file reads the same as LF.
        assertEquals(listOf("1080p60hz", "2160p30hz*"), SysDisplayFacts.parseCaps("1080p60hz\r\n\r\n1080p60hz\r\n2160p30hz*\r\n"))
        assertEquals(48, SysDisplayFacts.MODE_MAX); assertEquals(32, SysDisplayFacts.CAP_MAX); assertEquals(16, SysDisplayFacts.CAPS_MAX)
        assertEquals(listOf("/sys/class/display/mode"), SysDisplayFacts.MODE_PATHS)
        assertEquals(listOf("/sys/class/amhdmitx/amhdmitx0/disp_cap", "/sys/class/graphics/fb0/modes"), SysDisplayFacts.CAP_PATHS)
    }
}
