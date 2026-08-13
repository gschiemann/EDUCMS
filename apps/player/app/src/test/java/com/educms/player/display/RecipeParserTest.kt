package com.educms.player.display

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * End-to-end adversarial tests: hostile JSON in, rejection out.
 *
 * [RecipeValidatorTest] proves the allowlist logic; this proves that the
 * PARSE path cannot be used to smuggle something past it. That
 * distinction matters — the wire format is what a compromised control
 * plane actually controls, and a parser that silently drops an
 * unrecognised `kind` (rather than rejecting) would hand back a recipe
 * whose wake step had quietly vanished.
 *
 * Runs on a plain JVM against a REAL org.json (test-only dependency; see
 * app/build.gradle.kts), not the stubbed android.jar one.
 */
class RecipeParserTest {

    @Test
    fun `path traversal in JSON is rejected whole`() {
        val json = """
        {
          "vendorId": "evil",
          "match": {},
          "brightness": {
            "kind": "sysfs",
            "path": "/sys/class/backlight/../../../data/data/com.educms.player/shared_prefs/edu_player.xml",
            "valueFrom": "percent",
            "scale": [0, 255]
          }
        }
        """.trimIndent()
        val check = RecipeParser.parse(json)
        assertTrue("traversal must be rejected", check is RecipeCheck.Rejected)
        assertNull(check.recipeOrNull())
    }

    @Test
    fun `non-allowlisted broadcast action in JSON is rejected whole`() {
        val json = """
        {
          "vendorId": "evil",
          "match": {},
          "blank": {
            "kind": "broadcast",
            "action": "android.intent.action.MASTER_CLEAR",
            "extras": []
          }
        }
        """.trimIndent()
        assertTrue(RecipeParser.parse(json) is RecipeCheck.Rejected)
    }

    @Test
    fun `settings write cannot name a Secure or Global key by namespacing the key`() {
        // There is no namespace field on the wire — writes are always
        // Settings.System — so the only attack surface is the key
        // itself. Dotted / slashed keys are refused.
        listOf("secure.adb_enabled", "global/airplane_mode_on", "../secure/adb_enabled").forEach { key ->
            val json = """
            {"vendorId":"evil","match":{},
             "brightness":{"kind":"settings","key":"$key","valueFrom":"percent"}}
            """.trimIndent()
            assertTrue("must reject key '$key'", RecipeParser.parse(json) is RecipeCheck.Rejected)
        }
    }

    @Test
    fun `an unknown step kind rejects the recipe instead of silently dropping the step`() {
        // "exec" is the shape an attacker would reach for. There is no
        // exec kind, and — critically — a present-but-unparseable step
        // must REJECT rather than parse to null, or a recipe could ship
        // with its wake step quietly missing.
        val json = """
        {"vendorId":"evil","match":{},
         "blank":{"kind":"broadcast","action":"com.gv.display.SET_POWER","extras":[]},
         "wake":{"kind":"exec","cmd":"reboot"}}
        """.trimIndent()
        val check = RecipeParser.parse(json)
        assertTrue(check is RecipeCheck.Rejected)
    }

    @Test
    fun `garbage and empty input are rejected without throwing`() {
        listOf(null, "", "   ", "not json", "[]", "{", """{"vendorId":""}""").forEach { raw ->
            val check = RecipeParser.parse(raw)
            assertTrue("must reject: '${raw?.take(20)}'", check is RecipeCheck.Rejected)
        }
    }

    @Test
    fun `a well-formed vendor recipe round-trips`() {
        val json = """
        {
          "vendorId": "goodview-ecbox",
          "match": { "manufacturer": "Goodview", "model": "ECBox3576" },
          "brightness": {
            "kind": "sysfs",
            "path": "/sys/class/backlight/panel0/brightness",
            "valueFrom": "percent",
            "scale": [0, 255]
          },
          "blank": {
            "kind": "broadcast",
            "action": "com.gv.display.SET_POWER",
            "extras": [ { "key": "state", "type": "int", "from": "literal", "value": "0" } ]
          },
          "wake": {
            "kind": "broadcast",
            "action": "com.gv.display.SET_POWER",
            "extras": [ { "key": "state", "type": "int", "from": "literal", "value": "1" } ]
          }
        }
        """.trimIndent()
        val recipe = RecipeParser.parse(json).recipeOrNull()
        assertNotNull("well-formed recipe must be accepted", recipe)
        requireNotNull(recipe)
        assertEquals("goodview-ecbox", recipe.vendorId)
        assertEquals(
            setOf(Capability.BRIGHTNESS, Capability.BLANK, Capability.WAKE),
            recipe.declaredCapabilities(),
        )
        val brightness = recipe.stepFor(Capability.BRIGHTNESS)
        assertTrue(brightness is RecipeStep.Sysfs)
        assertEquals(RecipeScale(0, 255), (brightness as RecipeStep.Sysfs).scale)
        assertTrue(recipe.match.matches("goodview", "ecbox3576", "whatever"))
    }

    @Test
    fun `a rejected recipe never reaches the persisted config`() {
        val block = """
        {
          "version": 1,
          "timezone": "America/Los_Angeles",
          "schedules": [
            {"id":"s1","daysOfWeek":["Mon","Tue"],"onTime":"07:00","offTime":"22:00"}
          ],
          "recipe": {
            "vendorId": "evil",
            "match": {},
            "brightness": {"kind":"sysfs","path":"/proc/sys/kernel/core_pattern","value":"x"}
          }
        }
        """.trimIndent()
        val config = DisplayConfigParser.parse(block)
        // The schedules survive — a bad recipe must not disarm the
        // on/off schedule, which is what actually keeps the screen sane.
        assertEquals(1, config.schedules.size)
        assertNull("the hostile recipe must not be installed", config.recipe)
        assertTrue("the operator must be told why", config.warnings.any { it.contains("recipe rejected") })
    }
}
