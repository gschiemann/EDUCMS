package com.educms.player.alertwatch

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Base64

/**
 * The engine's STATUS — what the stamp tells the companion Manager after a
 * pass (2026-11-08, wave 5). Read-only facts; the existing engine tests prove
 * the decisions are unchanged.
 */
class NativeAlertWatchStatusTest {

    private val screenId = "7d0c4a3e-1b2f-4c5d-8e9f-0a1b2c3d4e5f"

    private fun jwt(): String {
        val enc = Base64.getUrlEncoder().withoutPadding()
        return enc.encodeToString("""{"alg":"HS256","typ":"JWT"}""".toByteArray()) + "." +
            enc.encodeToString("""{"sub":"$screenId","kind":"device"}""".toByteArray()) + "." +
            enc.encodeToString(ByteArray(32) { 1 })
    }

    private inner class Sim : NativeAlertWatchEngine.Ports {
        var now = 0L
        var interactive = false
        var apiRoot: String? = "https://api.example.test"
        var apiRootAllowed = true
        var targets = listOf(NativeAlertWatchPolicy.targetOf(0, jwt())!!)
        var held = false

        override fun nowMs() = now
        override fun panelInteractive() = interactive
        override fun plan() = NativeAlertWatchEngine.WatchPlan(apiRoot, apiRootAllowed, targets)
        override fun fetchManifest(target: WatchTarget, ifNoneMatch: String?) = PollOutcome(200, ManifestScan.NO_ALERT, etag = "e", sentEtag = ifNoneMatch)
        override fun holdHeld() = held
        override fun pageRaisedAtMs(face: Int): Long? = null
        override fun raise(face: Int, firstForThisAlert: Boolean) { held = true }
        override fun playerInForeground() = true
        override fun bringPlayerForward(attempt: Int) = Unit
        override fun reloadPage(face: Int, attempt: Int, why: String) = Unit
        override fun pageLoadStartedAtMs(face: Int): Long? = null
        override fun cpuLock(hold: Boolean) = Unit
        override fun log(level: NativeAlertWatchEngine.Level, message: String) = Unit
    }

    @Test
    fun `a fresh engine is idle`() {
        val e = NativeAlertWatchEngine(Sim())
        assertEquals(NativeAlertWatchEngine.WatchStatus.IDLE, e.status)
        assertEquals(0, e.watchedFaces)
        assertNull(e.statusReason)
    }

    @Test
    fun `dark and paired is WATCHING with the face count`() {
        val s = Sim()
        val e = NativeAlertWatchEngine(s)
        s.targets = listOf(NativeAlertWatchPolicy.targetOf(0, jwt())!!, NativeAlertWatchPolicy.targetOf(1, jwt())!!)
        assertTrue(e.pass() != null)
        assertEquals(NativeAlertWatchEngine.WatchStatus.WATCHING, e.status)
        assertEquals(2, e.watchedFaces)
        assertNull(e.statusReason)
    }

    @Test
    fun `the panel on is IDLE by design, with no reason`() {
        val s = Sim()
        val e = NativeAlertWatchEngine(s)
        e.pass()
        s.interactive = true
        assertNull(e.pass())
        assertEquals(NativeAlertWatchEngine.WatchStatus.IDLE, e.status)
        assertEquals(0, e.watchedFaces)
        assertNull(e.statusReason)
    }

    @Test
    fun `dark but not paired is NOT_WATCHABLE with the policy's own reason`() {
        val s = Sim()
        s.targets = emptyList()
        val e = NativeAlertWatchEngine(s)
        assertNull(e.pass())
        assertEquals(NativeAlertWatchEngine.WatchStatus.NOT_WATCHABLE, e.status)
        assertEquals("this screen is not paired (no usable device token)", e.statusReason)
        s.targets = listOf(NativeAlertWatchPolicy.targetOf(0, jwt())!!)
        s.apiRootAllowed = false
        assertNull(e.pass())
        assertEquals(NativeAlertWatchEngine.WatchStatus.NOT_WATCHABLE, e.status)
        assertEquals("the stored API root is not an allowed VenueOS API host", e.statusReason)
        s.apiRoot = null
        assertNull(e.pass())
        assertEquals("no API root yet (the page has never bootstrapped this install)", e.statusReason)
    }

    @Test
    fun `status is a fact about the pass and moves with it`() {
        val s = Sim()
        val e = NativeAlertWatchEngine(s)
        e.pass()
        assertEquals(NativeAlertWatchEngine.WatchStatus.WATCHING, e.status)
        s.interactive = true
        e.pass()
        assertEquals(NativeAlertWatchEngine.WatchStatus.IDLE, e.status)
        s.interactive = false
        s.now += 60_000L
        e.pass()
        assertEquals(NativeAlertWatchEngine.WatchStatus.WATCHING, e.status)
        assertEquals(1, e.watchedFaces)
    }
}
