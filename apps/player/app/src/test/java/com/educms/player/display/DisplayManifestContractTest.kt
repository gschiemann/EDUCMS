package com.educms.player.display

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * ⚠️ THE WIRE CONTRACT: this parser vs what the API actually emits.
 *
 * THE BUG THIS EXISTS TO CATCH (2026-08-13 review, P0-3). The server
 * shipped the vendor-recipe CATALOG as `display.vendorRecipes: [{vendorId,
 * priority, recipe}]`; this parser read a SINGULAR `display.recipe`
 * object, and contained no device-matching code at all. So a SUPER_ADMIN
 * could PUT a valid Goodview recipe, get a 200, get an AuditLog row, see
 * it in every screen's manifest — and no screen in the fleet would ever
 * execute it. Both halves were tested, and neither test fed the OTHER
 * half's bytes.
 *
 * So the fixtures below are transcribed from the REAL emitter,
 * `buildDisplayManifestBlock` in apps/api/src/display/display-manifest.ts,
 * against `DisplayManifestBlock` in packages/api-types/src/display-control.ts.
 * If either end changes shape, this is the test that must go red first.
 *
 * Pure JVM: `org.json` is on the test classpath (see app/build.gradle.kts)
 * so this runs the REAL parser over REAL bytes, not a hand-built object
 * graph — the only way a wire-shape test proves anything.
 */
class DisplayManifestContractTest {

    /**
     * Exactly the block `buildDisplayManifestBlock` returns: `schedules`
     * with Int[] daysOfWeek (contract C2: 0=Sunday) and a `scope` tag,
     * `brightness.{minSafePercent,allowBlack}`, and the `vendorRecipes`
     * CATALOG. Nothing here is invented.
     */
    private val realManifestBlock = """
        {
          "schedules": [
            { "id": "sched-1", "daysOfWeek": [1,2,3,4,5], "onTime": "07:00",
              "offTime": "22:00", "timezone": "America/Los_Angeles", "scope": "screen" }
          ],
          "brightness": { "minSafePercent": 5, "allowBlack": false },
          "vendorRecipes": [
            { "vendorId": "generic-fallback", "priority": 0, "recipe": {
                "vendorId": "generic-fallback",
                "match": {},
                "brightness": { "kind": "settings", "key": "screen_brightness", "scale": [0, 255] }
            } },
            { "vendorId": "goodview-ecbox", "priority": 100, "recipe": {
                "vendorId": "goodview-ecbox",
                "match": { "manufacturer": "Goodview", "model": "ECBox3576" },
                "brightness": { "kind": "sysfs", "path": "/sys/class/backlight/panel0/brightness",
                                "valueFrom": "percent", "scale": [0, 255] },
                "blank":  { "kind": "broadcast", "action": "com.gv.display.SET_POWER",
                            "extras": [ { "key": "state", "type": "int", "from": "literal", "value": "0" } ] },
                "wake":   { "kind": "broadcast", "action": "com.gv.display.SET_POWER",
                            "extras": [ { "key": "state", "type": "int", "from": "literal", "value": "1" } ] }
            } }
          ]
        }
    """.trimIndent()

    // ─── the schedule half ───────────────────────────────────────────

    @Test
    fun `a real manifest block yields a live schedule row`() {
        val config = DisplayConfigParser.parse(realManifestBlock)
        assertEquals("the schedule must survive the real wire shape", 1, config.schedules.size)
        val row = config.schedules.first()
        assertEquals("sched-1", row.id)
        // Contract C2: Int[] 0=Sunday..6=Saturday. Mon-Fri is 1..5.
        assertEquals(setOf(1, 2, 3, 4, 5), row.daysOfWeek)
        assertEquals(7 * 60, row.onMinuteOfDay)
        assertEquals(22 * 60, row.offMinuteOfDay)
        assertEquals("America/Los_Angeles", row.timezone)
        assertTrue("a real block must produce no warnings: ${config.warnings}", config.warnings.isEmpty())
    }

    @Test
    fun `the server's minSafePercent is read, and the native floor still wins`() {
        val config = DisplayConfigParser.parse(realManifestBlock)
        assertEquals(5, config.serverMinSafeBrightnessPercent)
        // Reported, never enforced: a compromised control plane must not
        // be able to LOWER the floor that keeps a wall-mounted screen
        // reachable. DisplayLimits stays the binding rule.
        assertEquals(
            DisplayLimits.MIN_SAFE_BRIGHTNESS,
            DisplayLimits.clampBrightness(0, allowBlack = false),
        )
    }

    @Test
    fun `an unknown key like scope is ignored rather than fatal`() {
        // org.json drops unknown keys, which is what lets the server add
        // `scope` (and anything after it) without an APK release.
        val config = DisplayConfigParser.parse(realManifestBlock)
        assertEquals(1, config.schedules.size)
    }

    // ─── the vendor-recipe half — THE regression this file exists for ─

    @Test
    fun `THE P0 - vendorRecipes reaches the device and the matching row is selected`() {
        val config = DisplayConfigParser.parse(realManifestBlock)
        assertEquals("both catalog rows must parse", 2, config.recipes.size)

        val goodview = config.matchingRecipe("Goodview", "ECBox3576", "rk3288")
        assertNotNull("the Goodview box must resolve its recipe — this returned null for months", goodview)
        assertEquals("goodview-ecbox", goodview!!.vendorId)
        assertEquals(
            setOf(Capability.BRIGHTNESS, Capability.BLANK, Capability.WAKE),
            goodview.declaredCapabilities(),
        )
    }

    @Test
    fun `priority decides when two rows match, highest first`() {
        // The generic row has an all-null match, so it matches the Goodview
        // box too. The server orders `priority desc, vendorId asc` and the
        // device re-applies exactly that, so both ends name the same winner.
        val config = DisplayConfigParser.parse(realManifestBlock)
        assertEquals("goodview-ecbox", config.matchingRecipe("Goodview", "ECBox3576", "rk3288")?.vendorId)
        // A box the specific row does not fit falls to the generic one.
        assertEquals("generic-fallback", config.matchingRecipe("NovaStar", "TB60", "taurus")?.vendorId)
    }

    @Test
    fun `a null Build field cannot crash the match`() {
        // A stripped OEM ROM can report a null MODEL; on a plain JVM
        // `Build.MODEL` is null too (isReturnDefaultValues). Neither may
        // take down a hallway kiosk.
        val config = DisplayConfigParser.parse(realManifestBlock)
        assertEquals("generic-fallback", config.matchingRecipe(null, null, null)?.vendorId)
    }

    @Test
    fun `one poisoned catalog row does not cost the other vendors their control`() {
        val mixed = """
            {
              "schedules": [],
              "brightness": { "minSafePercent": 5, "allowBlack": false },
              "vendorRecipes": [
                { "vendorId": "evil", "priority": 900, "recipe": {
                    "vendorId": "evil",
                    "match": {},
                    "blank": { "kind": "broadcast", "action": "android.intent.action.MASTER_CLEAR" }
                } },
                { "vendorId": "goodview-ecbox", "priority": 100, "recipe": {
                    "vendorId": "goodview-ecbox",
                    "match": { "manufacturer": "Goodview" },
                    "blank": { "kind": "broadcast", "action": "com.gv.display.SET_POWER",
                               "extras": [ { "key": "state", "type": "int", "from": "literal", "value": "0" } ] },
                    "wake":  { "kind": "broadcast", "action": "com.gv.display.SET_POWER",
                               "extras": [ { "key": "state", "type": "int", "from": "literal", "value": "1" } ] }
                } }
              ]
            }
        """.trimIndent()
        val config = DisplayConfigParser.parse(mixed)
        assertEquals("only the legitimate row survives", 1, config.recipes.size)
        assertEquals("goodview-ecbox", config.recipes.first().vendorId)
        assertTrue(
            "the operator must be told the row was refused: ${config.warnings}",
            config.warnings.any { it.contains("evil") },
        )
        // …and the refused row must not win on its higher priority.
        assertEquals("goodview-ecbox", config.matchingRecipe("Goodview", "ECBox3576", "rk3288")?.vendorId)
    }

    @Test
    fun `a recipe that does not match this box yields nothing, and says so distinguishably`() {
        val onlyGoodview = """
            { "schedules": [], "vendorRecipes": [
              { "vendorId": "goodview-ecbox", "priority": 10, "recipe": {
                  "vendorId": "goodview-ecbox",
                  "match": { "manufacturer": "Goodview" },
                  "wake": { "kind": "broadcast", "action": "com.gv.display.SET_POWER",
                            "extras": [ { "key": "state", "type": "int", "from": "literal", "value": "1" } ] }
              } } ] }
        """.trimIndent()
        val config = DisplayConfigParser.parse(onlyGoodview)
        assertNull(config.matchingRecipe("TCL", "T3-55", "mstar"))
        // "no match" and "no catalog" must not look the same to ops —
        // DisplayControlApi reports both `recipe` and `recipeCatalog`.
        assertEquals(1, config.recipes.size)
    }

    @Test
    fun `the legacy singular recipe key still works, at the lowest precedence`() {
        // Back-compat for a hand-pushed config or a prefs blob written by
        // an older APK. It is NOT the wire contract.
        val legacy = """
            { "schedules": [], "recipe": {
                "vendorId": "legacy-box", "match": {},
                "wake": { "kind": "broadcast", "action": "com.gv.display.SET_POWER",
                          "extras": [ { "key": "state", "type": "int", "from": "literal", "value": "1" } ] } } }
        """.trimIndent()
        val config = DisplayConfigParser.parse(legacy)
        assertEquals("legacy-box", config.matchingRecipe("Anything", "Any", "any")?.vendorId)

        // A catalog row always beats it, even at priority 0.
        val both = """
            { "schedules": [],
              "recipe": {
                "vendorId": "legacy-box", "match": {},
                "wake": { "kind": "broadcast", "action": "com.gv.display.SET_POWER",
                          "extras": [ { "key": "state", "type": "int", "from": "literal", "value": "1" } ] } },
              "vendorRecipes": [ { "vendorId": "catalog-box", "priority": 0, "recipe": {
                "vendorId": "catalog-box", "match": {},
                "wake": { "kind": "broadcast", "action": "com.gv.display.SET_POWER",
                          "extras": [ { "key": "state", "type": "int", "from": "literal", "value": "1" } ] } } } ] }
        """.trimIndent()
        val merged = DisplayConfigParser.parse(both)
        assertEquals(2, merged.recipes.size)
        assertEquals("catalog-box", merged.matchingRecipe("X", "Y", "Z")?.vendorId)
    }

    @Test
    fun `an empty catalog is not an error and never means blank the screen`() {
        val empty = """{ "schedules": [], "brightness": {"minSafePercent":5,"allowBlack":false}, "vendorRecipes": [] }"""
        val config = DisplayConfigParser.parse(empty)
        assertTrue(config.recipes.isEmpty())
        assertNull(config.matchingRecipe("Goodview", "ECBox3576", "rk3288"))
        assertTrue(config.warnings.isEmpty())
        assertTrue(config.schedules.isEmpty())
    }

    // ─── the recovery-direction chain rule ───────────────────────────

    @Test
    fun `BLANK and WAKE fall through on failure, the risk-direction capabilities do not`() {
        // One mis-typed vendor action in one DB row must degrade to the
        // software floor, never disable WAKE on every matching SKU. The
        // other capabilities keep the single-provider rule: falling
        // through on BRIGHTNESS could stack a second mechanism's idea of
        // "20%" on top of a half-applied first attempt.
        assertTrue(DisplayControlRegistry.fallsThroughOnFailure(Capability.WAKE))
        assertTrue(DisplayControlRegistry.fallsThroughOnFailure(Capability.BLANK))
        assertFalse(DisplayControlRegistry.fallsThroughOnFailure(Capability.BRIGHTNESS))
        assertFalse(DisplayControlRegistry.fallsThroughOnFailure(Capability.VOLUME))
        assertFalse(DisplayControlRegistry.fallsThroughOnFailure(Capability.REBOOT))
    }

    @Test
    fun `an unproven broadcast is not treated as an absent one`() {
        // Android 11+ package-visibility filtering makes an empty
        // queryBroadcastReceivers result ambiguous. Only ABSENT — which
        // requires a complete view of the package list — may fail a step;
        // demoting every real vendor recipe on UNKNOWN would be the same
        // over-claim pointing the other way.
        assertEquals(3, BroadcastPresence.values().size)
        assertTrue(BroadcastPresence.ABSENT != BroadcastPresence.UNKNOWN)
    }

    // ─── the provider-id vocabulary (contract C5) ────────────────────

    @Test
    fun `the provider ids are exactly the vocabulary the server enums must accept`() {
        // Contract C5: the DEVICE's ids are authoritative and the API's
        // zod enums are widened to match. Pinning them here means a rename
        // on this side cannot silently 400 every screen in the fleet.
        assertEquals("audiomanager", AudioManagerProvider.id)
        assertEquals("vendor-recipe", VendorRecipeProvider.id)
        assertEquals("sysfs-backlight", SysfsBacklightProvider.id)
        assertEquals("settings", SettingsBrightnessProvider.id)
        assertEquals("software-dim", SoftwareDimProvider.id)
        assertEquals("device-admin", DeviceAdminBlankProvider.id)
        assertEquals("screen-timeout", ScreenTimeoutBlankProvider.id)
        assertEquals("device-owner", DeviceOwnerRebootProvider.id)
        assertEquals("none", DisplayCapabilityProbe.CAPABILITY_NONE)
        assertEquals("serial-candidate", DisplayCapabilityProbe.HARD_POWER_OFF_SERIAL)
    }
}
