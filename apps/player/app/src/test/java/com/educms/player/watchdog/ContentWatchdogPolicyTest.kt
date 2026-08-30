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
            p.onV2Heartbeat(now, syncOk = true, networkUp = true)
            assertFalse("fired at minute $i on a healthy player", p.shouldForceReload(now))
        }
    }

    @Test
    fun `sync going bad for 31 minutes fires once, then respects the cooldown`() {
        val p = ContentWatchdogPolicy()
        p.onV2Heartbeat(t0, syncOk = true, networkUp = true)

        // Sync is now failing. Ticks keep arriving (the runtime is alive)
        // but none of them refreshes the reference.
        for (i in 1..30) p.onV2Heartbeat(t0 + i * minute, syncOk = false, networkUp = true)
        assertFalse("30 minutes is not yet past the threshold", p.shouldForceReload(t0 + 30 * minute))

        val fireAt = t0 + 31 * minute
        p.onV2Heartbeat(fireAt, syncOk = false, networkUp = true)
        assertTrue(p.shouldForceReload(fireAt))
        p.markFired(fireAt)

        // Still broken, but inside the cooldown — must not reload-loop.
        for (i in 32..60) {
            val now = t0 + i * minute
            p.onV2Heartbeat(now, syncOk = false, networkUp = true)
            assertFalse("reload-looped at minute $i", p.shouldForceReload(now))
        }

        // Cooldown elapsed and still not OK — fire again.
        val secondFire = fireAt + 31 * minute
        p.onV2Heartbeat(secondFire, syncOk = false, networkUp = true)
        assertTrue(p.shouldForceReload(secondFire))
    }

    @Test
    fun `a recovery disarms the policy again`() {
        val p = ContentWatchdogPolicy()
        p.onV2Heartbeat(t0, syncOk = true, networkUp = true)
        val fireAt = t0 + 31 * minute
        p.onV2Heartbeat(fireAt, syncOk = false, networkUp = true)
        assertTrue(p.shouldForceReload(fireAt))
        p.markFired(fireAt)

        // The reload worked. A recovered player keeps heartbeating OK on
        // its 60-second timer — that is what moves the reference forward.
        for (i in 1..60) {
            val now = fireAt + i * minute
            p.onV2Heartbeat(now, syncOk = true, networkUp = true)
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
        p.onV2Heartbeat(t0, syncOk = true, networkUp = true)
        assertFalse(p.shouldForceReload(t0 + 30 * minute))
        assertTrue(p.shouldForceReload(t0 + 31 * minute))
    }

    @Test
    fun `bad from the very first V2 tick fires 30 minutes after that tick`() {
        val p = ContentWatchdogPolicy()
        p.onV2Heartbeat(t0, syncOk = false, networkUp = true)   // never been OK since boot
        assertFalse(p.shouldForceReload(t0 + 29 * minute))
        assertFalse(p.shouldForceReload(t0 + 30 * minute))
        assertTrue(p.shouldForceReload(t0 + 30 * minute + 1))
    }

    @Test
    fun `null syncOk does not refresh the reference`() {
        val p = ContentWatchdogPolicy()
        p.onV2Heartbeat(t0, syncOk = true, networkUp = true)
        // Malformed / field-missing ticks for the next 31 minutes. Unknown
        // is not OK — these must not hold the watchdog off.
        for (i in 1..31) p.onV2Heartbeat(t0 + i * minute, syncOk = null, networkUp = true)
        assertTrue(p.shouldForceReload(t0 + 31 * minute))
    }

    @Test
    fun `null syncOk arms the policy but does not by itself disarm it`() {
        val p = ContentWatchdogPolicy()
        p.onV2Heartbeat(t0, syncOk = null, networkUp = true)    // first V2 tick ever, unknown state
        assertFalse(p.shouldForceReload(t0 + 10 * minute))
        assertTrue(p.shouldForceReload(t0 + 31 * minute))
    }

    @Test
    fun `shouldForceReload does not mutate the cooldown on its own`() {
        // The caller may legitimately decline to act; asking must be free.
        val p = ContentWatchdogPolicy()
        p.onV2Heartbeat(t0, syncOk = false, networkUp = true)
        val now = t0 + 31 * minute
        assertTrue(p.shouldForceReload(now))
        assertTrue("asking twice must give the same answer", p.shouldForceReload(now))
        p.markFired(now)
        assertFalse(p.shouldForceReload(now))
    }

    // ─── C-P0-1: offline is not evidence about the glass ──────────────
    //
    // A screen playing CACHED content through a WAN outage reports
    // syncOk=false for exactly the same reason a credential-dead screen
    // does. Reloading cannot fix an outage and — without a healthy service
    // worker — turns a playing screen into an error page for the duration.
    // The operator's rule is absolute: once content is live, it stays live,
    // even if the damn internet drops.

    @Test
    fun `an offline screen never fires however long the outage runs`() {
        val p = ContentWatchdogPolicy()
        p.onV2Heartbeat(t0, syncOk = true, networkUp = true)
        // Uplink dies one minute later; the page keeps heartbeating with
        // syncOk=false because its manifest fetch keeps failing.
        for (i in 1..600) {
            val now = t0 + i * minute
            p.onV2Heartbeat(now, syncOk = false, networkUp = false)
            assertFalse("fired at minute $i of a 10-hour outage", p.shouldForceReload(now))
        }
    }

    @Test
    fun `offline ticks are inert whatever they claim about sync`() {
        // The service worker can serve a good manifest from cache, so an
        // offline page may honestly report syncOk=true — and an offline
        // page whose fetch failed reports syncOk=false. NEITHER is evidence
        // about the glass, so an offline tick must behave exactly like a
        // null one: arm, and otherwise change nothing.
        val optimistic = ContentWatchdogPolicy()
        val pessimistic = ContentWatchdogPolicy()
        for (i in 0..40) {
            val now = t0 + i * minute
            optimistic.onV2Heartbeat(now, syncOk = true, networkUp = false)
            pessimistic.onV2Heartbeat(now, syncOk = false, networkUp = false)
            assertFalse("optimistic offline tick fired at minute $i", optimistic.shouldForceReload(now))
            assertFalse("pessimistic offline tick fired at minute $i", pessimistic.shouldForceReload(now))
        }
        // …and both land in the same state once the uplink returns: one
        // full fresh window, then an honest verdict.
        val backOnline = t0 + 41 * minute
        for (p in listOf(optimistic, pessimistic)) {
            p.onNetworkState(backOnline, up = true)
            assertFalse(p.shouldForceReload(backOnline + 30 * minute))
            assertTrue(p.shouldForceReload(backOnline + 31 * minute))
        }
    }

    @Test
    fun `regaining the network resets the clock — offline time is not stale time`() {
        val p = ContentWatchdogPolicy()
        p.onV2Heartbeat(t0, syncOk = true, networkUp = true)

        // 60 minutes of outage — twice STALE_MS.
        for (i in 1..60) p.onV2Heartbeat(t0 + i * minute, syncOk = false, networkUp = false)

        // The instant the uplink returns the screen gets a FULL fresh
        // window to re-sync. Without this it would be reloaded on the very
        // first online tick, which is the worst possible moment: the page
        // is mid-recovery and the reload throws that away.
        val backOnline = t0 + 61 * minute
        p.onV2Heartbeat(backOnline, syncOk = false, networkUp = true)
        assertFalse("reloaded the instant the network came back", p.shouldForceReload(backOnline))
        assertFalse(p.shouldForceReload(backOnline + 30 * minute))

        // Still not syncing 31 minutes AFTER the network returned — now it
        // is a real content failure and the policy fires honestly.
        assertTrue(p.shouldForceReload(backOnline + 31 * minute))
    }

    @Test
    fun `the network signal works without any heartbeat at all`() {
        // A page whose JS has wedged stops heartbeating entirely. If the
        // last thing it ever said was "offline" the policy would stay
        // disarmed forever, so the native caller pushes connectivity on
        // every watchdog tick independently of the bridge.
        val p = ContentWatchdogPolicy()
        p.onV2Heartbeat(t0, syncOk = false, networkUp = true)   // armed, never OK
        p.onNetworkState(t0 + 1 * minute, up = false)           // uplink dies
        assertFalse(p.shouldForceReload(t0 + 31 * minute))      // rule 5 holds it off

        p.onNetworkState(t0 + 40 * minute, up = true)           // uplink returns
        assertFalse("no fresh window after the outage", p.shouldForceReload(t0 + 60 * minute))
        assertTrue(p.shouldForceReload(t0 + 71 * minute + 1))
    }

    @Test
    fun `a flapping uplink leaves live content alone`() {
        // Deliberate: a screen whose network flaps faster than STALE_MS is
        // one this policy cannot judge, so it declines to. Documented in
        // onNetworkState — the bias is always toward not touching a screen
        // that may well be playing.
        val p = ContentWatchdogPolicy()
        p.onV2Heartbeat(t0, syncOk = false, networkUp = true)
        for (i in 1..20) {
            val down = t0 + (i * 20L) * minute
            p.onNetworkState(down, up = false)
            p.onNetworkState(down + 5 * minute, up = true)
            assertFalse("fired across flap $i", p.shouldForceReload(down + 19 * minute))
        }
    }

    @Test
    fun `an outage does not disarm the policy permanently`() {
        // The mirror of the test above: once the uplink is genuinely
        // stable again, a screen that still cannot sync IS reloaded. The
        // offline suppression is a pause, never an off switch.
        val p = ContentWatchdogPolicy()
        p.onV2Heartbeat(t0, syncOk = true, networkUp = true)
        for (i in 1..20) p.onV2Heartbeat(t0 + i * minute, syncOk = false, networkUp = false)
        val backOnline = t0 + 21 * minute
        for (i in 0..40) {
            p.onV2Heartbeat(backOnline + i * minute, syncOk = false, networkUp = true)
        }
        assertTrue(p.shouldForceReload(backOnline + 31 * minute))
    }

    @Test
    fun `the first V2 tick still arms the policy even if it arrives offline`() {
        // Rule 1 is about the WEB BUNDLE VERSION, not connectivity. A
        // screen that boots into an outage must still be armed, or it
        // would need a reboot to ever gain content supervision.
        val p = ContentWatchdogPolicy()
        p.onV2Heartbeat(t0, syncOk = false, networkUp = false)
        assertFalse("fired while still offline", p.shouldForceReload(t0 + 31 * minute))
        p.onNetworkState(t0 + 40 * minute, up = true)
        assertTrue(p.shouldForceReload(t0 + 71 * minute))
    }

    // NOTE — the EMERGENCY-HOLD suppression is caller-side by design and
    // is therefore NOT testable here. `MainActivity.watchdogTicker` checks
    // `DisplayEmergency.isHeld(...)` BEFORE `markFired` + the reload, so
    // declining does not burn the cooldown (the same contract the
    // `shouldForceReload does not mutate` test above pins). It lives there
    // rather than in this class because it must also guard the STALENESS
    // watchdog's reload, which this policy knows nothing about.
}
