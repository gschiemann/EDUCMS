package com.educms.player.display

import com.educms.player.display.VendorBacklightEngine.Call
import com.educms.player.display.VendorBacklightEngine.Connect
import com.educms.player.display.VendorBacklightEngine.Step
import com.educms.player.display.VendorBacklightPolicy.Detection
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * THE RK3576 (EP6N-class) BACKEND OF vendor-backlight, on recording fakes:
 * detection, the backend choice, and the exact sleep / wake call sequence
 * over `getDeviceShallowOnoff` / `setDeviceShallowOnoff`.
 */
class RkSdkApiBackendTest {

    /** A recording RK3576 box: the setter sets, the getter reads. */
    private class Box : VendorBacklightEngine.Ports {
        var now = 0L
        var installed = true
        var connectOutcome: Connect = Connect.Ready
        var on = true
        /** What the getter answers; null = follow [on]. A stale getter keeps answering the old state. */
        var getterOverride: Boolean? = null
        var refuses = false
        /** The transactions, in order: "get", "set:false", "set:true". */
        val calls = mutableListOf<String>()
        val submitted = mutableListOf<() -> Unit>()
        val scheduled = mutableListOf<Long>()
        val darkChanges = mutableListOf<Boolean>()
        var seen = 0

        override fun nowMs() = now
        override fun servicePackageInstalled() = installed
        override fun connect(budgetMs: Long) = connectOutcome
        override fun disconnect() = Unit
        override fun idempotentCommands() = true
        override fun send(requestJson: String, budgetMs: Long): Call {
            if (budgetMs <= 0L) return Call.TimedOut
            if (refuses) return Call.Reply(RkSdkApiPolicy.refusedReply())
            return when (val op = RkSdkApiPolicy.opFor(requestJson)) {
                RkSdkApiPolicy.Op.Read -> {
                    calls += "get"
                    Call.Reply(RkSdkApiPolicy.readReply(getterOverride ?: on))
                }
                is RkSdkApiPolicy.Op.Set -> {
                    calls += "set:${op.on}"
                    on = op.on
                    Call.Reply(RkSdkApiPolicy.setReply())
                }
                null -> Call.Failed("unmapped")
            }
        }
        override fun submit(work: () -> Unit): Boolean { submitted += work; return true }
        override fun schedule(delayMs: Long, work: () -> Unit): Boolean { scheduled += delayMs; return true }
        override fun darkChanged(dark: Boolean) { darkChanges += dark }
        override fun seen() { seen++ }
        override fun log(level: VendorBacklightEngine.Level, message: String) = Unit
    }

    // ─── policy ──────────────────────────────────────────────────────

    @Test
    fun `the engine's three requests map onto the getter and the setter, nothing else`() {
        assertEquals(RkSdkApiPolicy.Op.Read, RkSdkApiPolicy.opFor(VendorBacklightPolicy.getScreenStatusRequest()))
        assertEquals(RkSdkApiPolicy.Op.Set(on = false), RkSdkApiPolicy.opFor(VendorBacklightPolicy.powerOffRequest()))
        assertEquals(RkSdkApiPolicy.Op.Set(on = true), RkSdkApiPolicy.opFor(VendorBacklightPolicy.powerKeyRequest()))
        assertNull(RkSdkApiPolicy.opFor("""{"requestName":"com.seewo.sdk.internal.command.device.CmdSetScreenStatus"}"""))
        assertNull(RkSdkApiPolicy.opFor("not json"))
    }

    @Test
    fun `the re-shaped replies read back as the engine expects`() {
        assertEquals(true, VendorBacklightPolicy.booleanResult(VendorBacklightPolicy.parseReply(RkSdkApiPolicy.readReply(true))))
        assertEquals(false, VendorBacklightPolicy.booleanResult(VendorBacklightPolicy.parseReply(RkSdkApiPolicy.readReply(false))))
        assertTrue(VendorBacklightPolicy.parseReply(RkSdkApiPolicy.setReply())!!.ok)
        assertEquals(Detection.UNSUPPORTED, VendorBacklightPolicy.detectionFrom(VendorBacklightPolicy.parseReply(RkSdkApiPolicy.refusedReply())))
    }

    @Test
    fun `the GUQ's MCU service keeps winning wherever it is installed`() {
        assertEquals("seewo", RkSdkApiPolicy.backendFor(seewoInstalled = true, sdkApiInstalled = true))
        assertEquals("seewo", RkSdkApiPolicy.backendFor(seewoInstalled = true, sdkApiInstalled = false))
        assertEquals("seewo", RkSdkApiPolicy.backendFor(seewoInstalled = false, sdkApiInstalled = false))
        assertEquals("rk-sdkapi", RkSdkApiPolicy.backendFor(seewoInstalled = false, sdkApiInstalled = true))
    }

    @Test
    fun `a setter backend sends unless the reading already matches, whatever the settle window`() {
        for (read in listOf(true, false, null)) for (since in listOf(null, 0L, 100L, 10_000L)) for (wantOn in listOf(true, false)) {
            val expected = if (read == wantOn) VendorBacklightPolicy.PowerStep.ALREADY else VendorBacklightPolicy.PowerStep.SEND
            assertEquals(expected, VendorBacklightPolicy.powerStep(wantOn, read, since, !wantOn, idempotent = true))
        }
        // An unreadable box is still woken (never dark under an alert).
        assertEquals(VendorBacklightPolicy.PowerStep.SEND, VendorBacklightPolicy.powerStep(true, null, null, null, idempotent = true))
        // The GUQ toggle keeps its guards.
        assertEquals(VendorBacklightPolicy.PowerStep.UNKNOWN, VendorBacklightPolicy.powerStep(true, null, null, null))
    }

    // ─── detection ───────────────────────────────────────────────────

    @Test
    fun `a box without the RK3576 service is ABSENT, without a call`() {
        val b = Box().apply { installed = false }
        assertEquals(Detection.ABSENT, VendorBacklightEngine(b).probe())
        assertTrue(b.calls.isEmpty())
    }

    @Test
    fun `the probe is the read-only getter, and an answer makes the mechanism available`() {
        val b = Box()
        val e = VendorBacklightEngine(b)
        assertEquals(Detection.AVAILABLE, e.probe())
        assertEquals(listOf("get"), b.calls)
        assertEquals(1, b.seen)
        assertEquals(setOf(Capability.BLANK, Capability.WAKE), VendorBacklightPolicy.supports(e.detection, false, false, false))
    }

    @Test
    fun `a service that refuses this app is UNSUPPORTED and never asked to set anything`() {
        val b = Box().apply { refuses = true }
        val e = VendorBacklightEngine(b)
        assertEquals(Detection.UNSUPPORTED, e.probe())
        assertTrue(VendorBacklightPolicy.supports(e.detection, false, false, false).isEmpty())
        assertTrue(b.calls.none { it.startsWith("set") })
    }

    @Test
    fun `a bind that never completes is UNREACHABLE`() {
        val b = Box().apply { connectOutcome = Connect.TimedOut }
        assertEquals(Detection.UNREACHABLE, VendorBacklightEngine(b).probe())
    }

    // ─── the sequence ────────────────────────────────────────────────

    @Test
    fun `sleep is read, set false, readback`() {
        val b = Box()
        val e = VendorBacklightEngine(b)
        e.probe(); b.calls.clear()
        val step = e.blank()
        assertEquals(Step.Ok(backlightOff = true), step)
        assertEquals(listOf("get", "set:false", "get"), b.calls)
        assertTrue(e.dark)
        assertEquals(listOf(true), b.darkChanges)
    }

    @Test
    fun `wake is read, set true, readback — never a key`() {
        val b = Box()
        val e = VendorBacklightEngine(b)
        e.blank(); b.calls.clear()
        val step = e.wake()
        assertEquals(Step.Ok(backlightOff = false), step)
        assertEquals(listOf("get", "set:true", "get"), b.calls)
        assertFalse(e.dark)
        assertTrue(b.on)
    }

    @Test
    fun `a wake right after a sleep is sent at once, not deferred`() {
        val b = Box()
        val e = VendorBacklightEngine(b)
        e.blank()
        b.now += 100 // inside the GUQ settle window
        b.calls.clear()
        e.wake()
        assertEquals(listOf("get", "set:true", "get"), b.calls)
        assertTrue(b.scheduled.isEmpty())
        assertTrue(b.on)
    }

    @Test
    fun `a wake to a box that already reads ON sends nothing — the setter reboots this box`() {
        val b = Box()
        val e = VendorBacklightEngine(b)
        e.probe(); b.calls.clear()
        // The box came back from the wake's reboot: on, and our process is new.
        assertEquals(Step.Ok(backlightOff = false), e.wake())
        assertEquals(listOf("get"), b.calls)
        assertTrue(b.on)
    }

    @Test
    fun `an unreadable box is still sent the wake`() {
        val b = Box()
        val e = VendorBacklightEngine(b)
        e.blank()
        b.calls.clear()
        val failingGet = object : VendorBacklightEngine.Ports by b {
            override fun send(requestJson: String, budgetMs: Long): Call =
                if (RkSdkApiPolicy.opFor(requestJson) == RkSdkApiPolicy.Op.Read) Call.Failed("read failed") else b.send(requestJson, budgetMs)
        }
        val e2 = VendorBacklightEngine(failingGet)
        e2.wake()
        assertTrue("set:true" in b.calls)
        assertTrue(b.on)
    }

    @Test
    fun `an emergency while asleep queues the wake and the wake sets the box on`() {
        val b = Box()
        val e = VendorBacklightEngine(b)
        e.probe()
        e.blank()
        assertTrue(e.emergencyOn(quiet = true, seenBefore = true))
        assertEquals(1, b.submitted.size)
        b.calls.clear()
        b.submitted.single().invoke()
        assertEquals(listOf("get", "set:true", "get"), b.calls)
        assertTrue(b.on)
        assertFalse(e.dark)
    }

    @Test
    fun `a failed wake after our own sleep latches the fault, so no further blank is offered`() {
        val b = Box()
        val e = VendorBacklightEngine(b)
        e.probe()
        e.blank()
        b.connectOutcome = Connect.Failed("service died")
        assertTrue(e.wake() is Step.Failed)
        assertTrue(e.faulted != null)
        assertEquals(setOf(Capability.WAKE), VendorBacklightPolicy.supports(e.detection, false, false, e.faulted != null))
    }

    // ─── wiring ──────────────────────────────────────────────────────

    private fun src(rel: String): String {
        val roots = listOf(File("src/main"), File("app/src/main"))
        val root = roots.first { File(it, "AndroidManifest.xml").exists() }
        return File(root, rel).readText()
    }

    @Test
    fun `the provider picks the backend from what is installed, and the manifest can see the service`() {
        val provider = src("java/com/educms/player/display/VendorBacklightProvider.kt")
        assertTrue(provider.contains("RkSdkApiPolicy.backendFor("))
        assertTrue(provider.contains("RkSdkApiPorts(a) else AndroidPorts(a)"))
        assertTrue(provider.contains("override fun idempotentCommands(): Boolean = true"))
        assertTrue(provider.contains("catch (s: SecurityException)"))
        val manifest = src("AndroidManifest.xml")
        val queries = Regex("<queries>([\\s\\S]*?)</queries>").find(manifest)!!.groupValues[1]
        assertTrue(queries.contains("<package android:name=\"com.sdkapi.sdkapiservice\" />"))
        assertTrue(queries.contains("<action android:name=\"com.sdkapi.sdkapiservice.service.sdkapiservice\" />"))
    }
}
