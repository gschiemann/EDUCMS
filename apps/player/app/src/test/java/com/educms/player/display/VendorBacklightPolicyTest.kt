package com.educms.player.display

import com.educms.player.display.VendorBacklightPolicy.Detection
import com.educms.player.standby.RestoreBlankPolicy
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * TRUE STANDBY ON A GOODVIEW GUQ — the rules (player 1.1.52).
 *
 * One test per rule in [VendorBacklightPolicy]: who may offer the mechanism,
 * what the wire looks like, how a reply is read, when the alert path asks for
 * the backlight, what a failed blank may fall through to, and what a blank
 * proves. Pure Kotlin — none of this needs an emulator.
 */
class VendorBacklightPolicyTest {

    private val blankAndWake = setOf(Capability.BLANK, Capability.WAKE)

    // ─── rule 1: auto-detected, no setting ───────────────────────────────

    @Test
    fun `offered only once the vendor service has answered on this box`() {
        assertEquals(blankAndWake, VendorBacklightPolicy.supports(Detection.AVAILABLE, seenBefore = false, killSwitchOff = false, faulted = false))
        // Most of the fleet: no vendor package → the chain is exactly 1.1.51's.
        for (d in listOf(Detection.ABSENT, Detection.UNREACHABLE, Detection.UNSUPPORTED)) {
            assertTrue(d.name, VendorBacklightPolicy.supports(d, seenBefore = true, killSwitchOff = false, faulted = false).isEmpty())
        }
        // Not asked yet, never seen: nothing is claimed.
        assertTrue(VendorBacklightPolicy.supports(Detection.PROBING, seenBefore = false, killSwitchOff = false, faulted = false).isEmpty())
    }

    @Test
    fun `a box that proved the service once is trusted through the next boot's probe`() {
        // So a persisted blank re-applied at process start is not handed to a worse mechanism.
        assertEquals(blankAndWake, VendorBacklightPolicy.supports(Detection.PROBING, seenBefore = true, killSwitchOff = false, faulted = false))
        // …but a finished probe that says the service is gone wins over the memory.
        assertTrue(VendorBacklightPolicy.supports(Detection.ABSENT, seenBefore = true, killSwitchOff = false, faulted = false).isEmpty())
    }

    // ─── rule 5: the kill switch only removes ────────────────────────────

    @Test
    fun `the kill switch removes the mechanism whatever the probe found`() {
        assertTrue(VendorBacklightPolicy.supports(Detection.AVAILABLE, seenBefore = true, killSwitchOff = true, faulted = false).isEmpty())
    }

    @Test
    fun `the manifest key is a kill switch only when it is exactly false`() {
        fun parse(block: String) = DisplayConfigParser.parse(block).vendorBacklightDisabled
        assertTrue(parse("""{"schedules":[],"vendorBacklight":false}"""))
        assertFalse(parse("""{"schedules":[]}"""))
        assertFalse(parse("""{"schedules":[],"vendorBacklight":true}"""))
        // Garbage can never switch anything — a typo on the API disables nothing.
        assertFalse(parse("""{"schedules":[],"vendorBacklight":"false"}"""))
        assertFalse(parse("""{"schedules":[],"vendorBacklight":0}"""))
        assertFalse(parse("""{"schedules":[],"vendorBacklight":null}"""))
        assertFalse(DisplayConfig.EMPTY.vendorBacklightDisabled)
    }

    // ─── rule 4: a fault steps aside for darkening only ──────────────────

    @Test
    fun `after a failed ON the mechanism offers WAKE but no further BLANK`() {
        assertEquals(setOf(Capability.WAKE), VendorBacklightPolicy.supports(Detection.AVAILABLE, seenBefore = true, killSwitchOff = false, faulted = true))
    }

    // ─── probing cadence ─────────────────────────────────────────────────

    @Test
    fun `a probe runs once at start, retries an unreachable service a bounded number of times, and never re-asks a settled answer`() {
        assertTrue(VendorBacklightPolicy.probeDue(Detection.PROBING, probes = 0, lastProbeAtMs = null, nowMs = 0L))
        assertTrue(VendorBacklightPolicy.probeDue(Detection.UNREACHABLE, probes = 1, lastProbeAtMs = 0L, nowMs = VendorBacklightPolicy.PROBE_RETRY_MS))
        assertFalse(VendorBacklightPolicy.probeDue(Detection.UNREACHABLE, probes = 1, lastProbeAtMs = 0L, nowMs = VendorBacklightPolicy.PROBE_RETRY_MS - 1))
        assertFalse(VendorBacklightPolicy.probeDue(Detection.UNREACHABLE, probes = VendorBacklightPolicy.MAX_PROBES, lastProbeAtMs = 0L, nowMs = 10 * VendorBacklightPolicy.PROBE_RETRY_MS))
        for (d in listOf(Detection.AVAILABLE, Detection.ABSENT, Detection.UNSUPPORTED)) {
            assertFalse(d.name, VendorBacklightPolicy.probeDue(d, probes = 1, lastProbeAtMs = 0L, nowMs = 10 * VendorBacklightPolicy.PROBE_RETRY_MS))
        }
    }

    // ─── the wire, as the vendor's own player writes it ─────────────────

    @Test
    fun `the service, action and transaction codes are the vendor player's`() {
        assertEquals("com.seewo.mcuservice", VendorBacklightPolicy.SERVICE_PACKAGE)
        assertEquals("com.ifpdos.opensdk.SERVICE_MANAGER", VendorBacklightPolicy.SERVICE_MANAGER_ACTION)
        assertEquals("com.seewo.sdk.internal.model.ISDKServiceManager", VendorBacklightPolicy.SERVICE_MANAGER_DESCRIPTOR)
        assertEquals("com.seewo.sdk.internal.model.ISDKService", VendorBacklightPolicy.SDK_SERVICE_DESCRIPTOR)
        assertEquals(1, VendorBacklightPolicy.TX_GET_SERVICE)
        assertEquals(1, VendorBacklightPolicy.TX_GET_TOKEN)
        assertEquals(3, VendorBacklightPolicy.TX_SEND_MESSAGE)
    }

    @Test
    fun `a set-screen-status request is an SDKRequest naming CmdSetScreenStatus with its fastjson fields`() {
        val off = JSONObject(VendorBacklightPolicy.setScreenStatusRequest(false))
        assertEquals("com.seewo.sdk.internal.command.device.CmdSetScreenStatus", off.getString("requestName"))
        val params = JSONObject(off.getString("paramsJson"))
        assertEquals(false, params.getBoolean("on"))
        assertEquals(false, params.getBoolean("isOn"))
        assertEquals(true, params.getBoolean("isAllowIntercept"))
        val on = JSONObject(JSONObject(VendorBacklightPolicy.setScreenStatusRequest(true)).getString("paramsJson"))
        assertEquals(true, on.getBoolean("on"))

        val get = JSONObject(VendorBacklightPolicy.getScreenStatusRequest())
        assertEquals("com.seewo.sdk.internal.command.device.CmdGetScreenStatus", get.getString("requestName"))
        assertEquals("{}", get.getString("paramsJson"))
    }

    @Test
    fun `an SDKResponse is read by its status, and only a SUCCESS carries a result`() {
        val ok = VendorBacklightPolicy.parseReply("""{"status":"SUCCESS","responseName":"RespBooleanResult","paramsJson":"{\"result\":true}"}""")!!
        assertTrue(ok.ok)
        assertEquals("RespBooleanResult", ok.responseName)
        assertEquals(true, VendorBacklightPolicy.booleanResult(ok))
        assertEquals(false, VendorBacklightPolicy.booleanResult(VendorBacklightPolicy.parseReply("""{"status":"SUCCESS","paramsJson":"{\"result\":false}"}""")))
        // A void reply (RespVoidResult) is a success with no boolean.
        val void = VendorBacklightPolicy.parseReply("""{"status":"SUCCESS","responseName":"RespVoidResult","paramsJson":"{}"}""")!!
        assertTrue(void.ok)
        assertNull(VendorBacklightPolicy.booleanResult(void))
        // A refusal is never a result.
        val refused = VendorBacklightPolicy.parseReply("""{"status":"HANDLER_NOT_FOUND","responseName":"","paramsJson":""}""")!!
        assertFalse(refused.ok)
        assertNull(VendorBacklightPolicy.booleanResult(refused))
        // Not an SDK reply at all.
        assertNull(VendorBacklightPolicy.parseReply(null))
        assertNull(VendorBacklightPolicy.parseReply(""))
        assertNull(VendorBacklightPolicy.parseReply("not json"))
        assertNull(VendorBacklightPolicy.parseReply("""{"foo":1}"""))
        assertNull(VendorBacklightPolicy.booleanResult(null))
    }

    @Test
    fun `the probe's reply decides the detection`() {
        assertEquals(Detection.AVAILABLE, VendorBacklightPolicy.detectionFrom(VendorBacklightPolicy.parseReply("""{"status":"SUCCESS","paramsJson":"{\"result\":true}"}""")))
        assertEquals(Detection.UNSUPPORTED, VendorBacklightPolicy.detectionFrom(VendorBacklightPolicy.parseReply("""{"status":"HANDLER_NOT_FOUND"}""")))
        assertEquals(Detection.UNREACHABLE, VendorBacklightPolicy.detectionFrom(VendorBacklightPolicy.parseReply("""{"status":"SERVICE_NOT_FOUND"}""")))
        assertEquals(Detection.UNREACHABLE, VendorBacklightPolicy.detectionFrom(null))
    }

    // ─── rule 3: emergency first ─────────────────────────────────────────

    @Test
    fun `the first enforce of a hold always asks for the backlight, a quiet re-raise only while we hold it off`() {
        // The loud engage asks even when our record says lit: the MCU may hold it off for a reason that is not ours.
        assertTrue(VendorBacklightPolicy.emergencyOnWanted(reachable = true, darkByUs = false, quiet = false))
        assertTrue(VendorBacklightPolicy.emergencyOnWanted(reachable = true, darkByUs = true, quiet = true))
        // A long alert on a lit panel costs the MCU nothing.
        assertFalse(VendorBacklightPolicy.emergencyOnWanted(reachable = true, darkByUs = false, quiet = true))
        // Nothing is asked of a box without the service.
        assertFalse(VendorBacklightPolicy.emergencyOnWanted(reachable = false, darkByUs = true, quiet = false))
    }

    // ─── rule 6: a failed vendor blank never becomes a latch-prone lock ──

    @Test
    fun `a failed vendor-backlight blank may not fall through to a lock below Android 13`() {
        for (lock in RestoreBlankPolicy.LOCK_FAMILY) {
            assertFalse(lock, VendorBacklightPolicy.fallThroughAllows(VendorBacklightPolicy.PROVIDER_ID, lock, sdkInt = 30, model = "M55GUQ"))
            assertTrue(lock, VendorBacklightPolicy.fallThroughAllows(VendorBacklightPolicy.PROVIDER_ID, lock, sdkInt = 33, model = "M43"))
        }
        assertTrue(VendorBacklightPolicy.fallThroughAllows(VendorBacklightPolicy.PROVIDER_ID, "screen-timeout", sdkInt = 30, model = "M55GUQ"))
        assertTrue(VendorBacklightPolicy.fallThroughAllows(VendorBacklightPolicy.PROVIDER_ID, "software-dim", sdkInt = 30, model = "M55GUQ"))
        // Every OTHER fall-through is exactly as before.
        assertTrue(VendorBacklightPolicy.fallThroughAllows("vendor-recipe", "device-admin", sdkInt = 30, model = "G43"))
    }

    @Test
    fun `the after-alert restore may use the vendor backlight on every Android`() {
        // It is not in the lock family: Android stays awake, nothing latches.
        assertTrue(RestoreBlankPolicy.allows(VendorBacklightPolicy.PROVIDER_ID, 25, "rk3288"))
        assertTrue(RestoreBlankPolicy.allows(VendorBacklightPolicy.PROVIDER_ID, 30, "M55GUQ"))
        assertTrue(RestoreBlankPolicy.allows(VendorBacklightPolicy.PROVIDER_ID, 33, "M43"))
    }

    // ─── what a blank proves ─────────────────────────────────────────────

    @Test
    fun `a vendor blank proves off only by the MCU's readback, and the sleep proof reads it at once`() {
        assertEquals(SleepProofPolicy.OUTCOME_OFF, VendorBacklightPolicy.blankOutcome(backlightOffConfirmed = true))
        assertEquals(SleepProofPolicy.OUTCOME_ON, VendorBacklightPolicy.blankOutcome(backlightOffConfirmed = false))
        assertEquals(SleepProofPolicy.OUTCOME_UNKNOWN, VendorBacklightPolicy.blankOutcome(backlightOffConfirmed = null))
        // Android stays interactive by design, so there is no settle window to wait for.
        assertNull(SleepProofPolicy.settleMsFor(VendorBacklightPolicy.PROVIDER_ID))
        assertEquals(SleepProofPolicy.OUTCOME_OFF, SleepProofPolicy.immediateOutcomeFor(VendorBacklightPolicy.PROVIDER_ID, SleepProofPolicy.OUTCOME_OFF))
        assertEquals(SleepProofPolicy.OUTCOME_ON, SleepProofPolicy.immediateOutcomeFor(VendorBacklightPolicy.PROVIDER_ID, SleepProofPolicy.OUTCOME_ON))
        assertEquals(SleepProofPolicy.OUTCOME_UNKNOWN, SleepProofPolicy.immediateOutcomeFor(VendorBacklightPolicy.PROVIDER_ID, null))
        // Never "off" on a claim that is not a readback.
        assertEquals(SleepProofPolicy.OUTCOME_UNKNOWN, SleepProofPolicy.immediateOutcomeFor(VendorBacklightPolicy.PROVIDER_ID, "black"))
        // The other mechanisms are untouched.
        assertEquals(SleepProofPolicy.OUTCOME_BLACK, SleepProofPolicy.immediateOutcomeFor("software-dim"))
        assertNull(SleepProofPolicy.immediateOutcomeFor("device-admin"))
    }
}
