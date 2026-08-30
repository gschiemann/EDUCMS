package com.educms.player.watchdog

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 2026-08-30 player reliability program, W2-4.
 *
 * A player stuck unauthenticated keeps its JS event loop alive, so it
 * keeps heartbeating, so the 10-minute staleness watchdog is satisfied
 * forever while the glass is dark. This policy is the content-aware
 * second opinion. The first test is the compatibility guarantee that
 * makes it safe to ship mid-rollout: an APK paired with an older web
 * bundle never arms it at all.
 */
class ContentWatchdogPolicyTest {

    private val minute = 60_000L
    private val t0 = 1_000_000L   // arbitrary non-zero base

    @Test
    fun `never armed without a V2 heartbeat`() {
        val p = ContentWatchdogPolicy()
        assertFalse(p.shouldForceReload(t0))
        assertFalse(p.shouldForceReload(t0 + 60 * minute))
        assertFalse(p.shouldForceReload(t0 + 24 * 60 * minute))
    }

    @Test
    fun `a healthy player never fires`() {
        val p = ContentWatchdogPolicy()
        for (i in 0..120) {
            val now = t0 + i * minute
            p.onV2Heartbeat(now, syncOk = true)
            assertFalse("fired at minute $i on a healthy player", p.shouldForceReload(now))
        }
    }

    @Test
    fun `sync going bad for 31 minutes fires once, then respects the cooldown`() {
        val p = ContentWatchdogPolicy()
        p.onV2Heartbeat(t0, syncOk = true)

        // Sync is now failing. Ticks keep arriving (the runtime is alive)
        // but none of them refreshes the reference.
        for (i in 1..30) p.onV2Heartbeat(t0 + i * minute, syncOk = false)
        assertFalse("30 minutes is not yet past the threshold", p.shouldForceReload(t0 + 30 * minute))

        val fireAt = t0 + 31 * minute
        p.onV2Heartbeat(fireAt, syncOk = false)
        assertTrue(p.shouldForceReload(fireAt))
        p.markFired(fireAt)

        // Still broken, but inside the cooldown — must not reload-loop.
        for (i in 32..60) {
            val now = t0 + i * minute
            p.onV2Heartbeat(now, syncOk = false)
            assertFalse("reload-looped at minute $i", p.shouldForceReload(now))
        }

        // Cooldown elapsed and still not OK — fire again.
        val secondFire = fireAt + 31 * minute
        p.onV2Heartbeat(secondFire, syncOk = false)
        assertTrue(p.shouldForceReload(secondFire))
    }

    @Test
    fun `a recovery disarms the policy again`() {
        val p = ContentWatchdogPolicy()
        p.onV2Heartbeat(t0, syncOk = true)
        val fireAt = t0 + 31 * minute
        p.onV2Heartbeat(fireAt, syncOk = false)
        assertTrue(p.shouldForceReload(fireAt))
        p.markFired(fireAt)

        // The reload worked. A recovered player keeps heartbeating OK on
        // its 60-second timer — that is what moves the reference forward.
        for (i in 1..60) {
            val now = fireAt + i * minute
            p.onV2Heartbeat(now, syncOk = true)
            assertFalse("fired $i minutes after a successful recovery", p.shouldForceReload(now))
        }
    }

    @Test
    fun `one OK tick followed by silence still goes stale`() {
        // The companion to the test above, and the reason it has to keep
        // ticking: the reference is the last OK tick, not "was it ever
        // OK". A page that reports OK once and then stops heartbeating
        // entirely is exactly as dark as one reporting failure, so 30
        // minutes after that last good tick the policy fires.
        val p = ContentWatchdogPolicy()
        p.onV2Heartbeat(t0, syncOk = true)
        assertFalse(p.shouldForceReload(t0 + 30 * minute))
        assertTrue(p.shouldForceReload(t0 + 31 * minute))
    }

    @Test
    fun `bad from the very first V2 tick fires 30 minutes after that tick`() {
        val p = ContentWatchdogPolicy()
        p.onV2Heartbeat(t0, syncOk = false)   // never been OK since boot
        assertFalse(p.shouldForceReload(t0 + 29 * minute))
        assertFalse(p.shouldForceReload(t0 + 30 * minute))
        assertTrue(p.shouldForceReload(t0 + 30 * minute + 1))
    }

    @Test
    fun `null syncOk does not refresh the reference`() {
        val p = ContentWatchdogPolicy()
        p.onV2Heartbeat(t0, syncOk = true)
        // Malformed / field-missing ticks for the next 31 minutes. Unknown
        // is not OK — these must not hold the watchdog off.
        for (i in 1..31) p.onV2Heartbeat(t0 + i * minute, syncOk = null)
        assertTrue(p.shouldForceReload(t0 + 31 * minute))
    }

    @Test
    fun `null syncOk arms the policy but does not by itself disarm it`() {
        val p = ContentWatchdogPolicy()
        p.onV2Heartbeat(t0, syncOk = null)    // first V2 tick ever, unknown state
        assertFalse(p.shouldForceReload(t0 + 10 * minute))
        assertTrue(p.shouldForceReload(t0 + 31 * minute))
    }

    @Test
    fun `shouldForceReload does not mutate the cooldown on its own`() {
        // The caller may legitimately decline to act; asking must be free.
        val p = ContentWatchdogPolicy()
        p.onV2Heartbeat(t0, syncOk = false)
        val now = t0 + 31 * minute
        assertTrue(p.shouldForceReload(now))
        assertTrue("asking twice must give the same answer", p.shouldForceReload(now))
        p.markFired(now)
        assertFalse(p.shouldForceReload(now))
    }
}
