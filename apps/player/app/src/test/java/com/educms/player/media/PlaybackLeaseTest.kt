package com.educms.player.media

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * NATIVE-FIRST, STREAM B — THE APP OWNS THE PLAYBACK SESSION (design
 * NATIVE-FIRST-ONE-STORE §3.5, §4). The decisions FaceVideoBox acts on, on a
 * virtual clock: the page's lease, the persisted intent, what ends a v4
 * session and what does not, and the version-4 grammar on the existing
 * `sharedVideoPrepare`. Every case here is a row of §4.1 / §4.2 / §4.3.
 *
 * What this does NOT prove: that a surface survives a real WebView
 * replacement, or the order of a real drill on a compositor — that is the
 * emulator and the glass (§11), and the PR says so.
 */
class PlaybackLeaseTest {

    private val screen = "7d0c4a3e-1b2f-4c5d-8e9f-0a1b2c3d4e5f"
    private val asset = "1a2b3c4d-5e6f-4a1b-8c2d-3e4f5a6b7c8d"
    private val shaA = "a".repeat(64)
    private val shaB = "b".repeat(64)

    private fun intend(sha: String = shaA, lease: String = "lease-doc-one", start: String = "now"): String =
        JSONObject().put("version", 4).put("op", "intend").put("screenId", screen).put("revision", "rev-1")
            .put("sha256", sha).put("assetId", asset).put("start", start).put("lease", lease).toString()

    private class MapStore : IntentStore {
        val values = HashMap<Int, String?>()
        override fun read(face: Int): String? = values[face]
        override fun write(face: Int, value: String?): Boolean { values[face] = value; return true }
    }

    // ─── §4.1 the lease ──────────────────────────────────────────────

    @Test
    fun `a lease that is not renewed for 10 s lapses, and the session goes UNATTENDED — never ended`() {
        val lease = PlaybackLease(createdAtMs = 0L)
        assertEquals(PlaybackLease.Verdict.ADOPTED, lease.accept("lease-doc-one", 1_000L))
        assertTrue(lease.live(1_000L))
        // The page polls every 500 ms while a session matters: each poll renews.
        var t = 1_000L
        while (t < 6_000L) { t += 500L; assertTrue(lease.renew(t)) }
        assertTrue(lease.live(t + PlaybackLease.BOUND_MS))
        assertFalse("10 s of silence: absent", lease.live(t + PlaybackLease.BOUND_MS + 1))
        assertEquals(t + PlaybackLease.BOUND_MS, lease.absentSince(t + 30_000L))
        // An absent lease does NOT end the session: the policy keeps it presenting, unattended.
        assertEquals(PlaybackSessionPolicy.Outcome.CONTINUE_UNATTENDED, PlaybackSessionPolicy.v4(PlaybackSessionPolicy.Event.PAGE_SILENT))
        // The same document polling again makes it live again (a throttled page, not a new one).
        assertTrue(lease.renew(t + 30_000L))
        assertTrue(lease.live(t + 30_000L))
        assertNull(lease.absentSince(t + 30_000L))
    }

    @Test
    fun `a main-frame document change - the lease is absent AT ONCE and the session continues`() {
        val lease = PlaybackLease(0L)
        lease.accept("lease-doc-one", 100L)
        lease.retire(5_000L)
        assertFalse(lease.live(5_000L))
        assertEquals("absent from the very moment of the change", 5_000L, lease.absentSince(5_001L))
        assertEquals(PlaybackSessionPolicy.Outcome.CONTINUE_UNATTENDED, PlaybackSessionPolicy.v4(PlaybackSessionPolicy.Event.DOCUMENT_CHANGED))
        // ...whereas a v2 / v3 session ends exactly as before.
        assertEquals(PlaybackSessionPolicy.Outcome.END_DISCARD_INTENT, PlaybackSessionPolicy.v2(PlaybackSessionPolicy.Event.DOCUMENT_CHANGED))
        // Polls from the new document renew nothing until it adopts.
        assertFalse(lease.renew(5_100L))
        assertFalse(lease.live(5_100L))
    }

    @Test
    fun `the three document callbacks of ONE navigation never retire the lease its new document just adopted`() {
        // onMainFrameDocument fires on page started, commit visible AND page finished; the new
        // document's script can adopt in between. Only the outgoing document's lease is retired.
        val lease = PlaybackLease(0L)
        lease.accept("lease-doc-one", 0L)
        val started = 120_000L
        assertTrue("page started: the old document's lease goes at once", lease.onDocumentChange(started))
        assertFalse("commit visible: nothing left to retire", lease.onDocumentChange(started + 400L))
        assertEquals(PlaybackLease.Verdict.ADOPTED, lease.accept("lease-doc-two", started + 2_000L))
        assertFalse("page finished: the NEW document's lease survives", lease.onDocumentChange(started + 9_000L))
        assertTrue(lease.live(started + 9_000L))
        assertEquals("lease-doc-two", lease.id)
        // The next real reload, later, retires it like any outgoing document's.
        assertTrue(lease.onDocumentChange(started + 2_000L + PlaybackLease.DOCUMENT_SHIELD_MS))
        assertEquals(PlaybackLease.Verdict.RETIRED, lease.accept("lease-doc-two", started + 40_000L))
    }

    @Test
    fun `a new document adopts with its own lease, and the retired one can never act again`() {
        val lease = PlaybackLease(0L)
        lease.accept("lease-doc-one", 0L)
        lease.retire(1_000L)
        assertEquals(PlaybackLease.Verdict.ADOPTED, lease.accept("lease-doc-two", 2_000L))
        assertEquals("lease-doc-two", lease.id)
        assertEquals(PlaybackLease.Verdict.RETIRED, lease.accept("lease-doc-one", 2_100L))
        assertEquals("the retired lease changed nothing", "lease-doc-two", lease.id)
        // A third document that adopts without the second being retired first supersedes it, for good.
        assertEquals(PlaybackLease.Verdict.ADOPTED, lease.accept("lease-doc-three", 3_000L))
        assertEquals(PlaybackLease.Verdict.RETIRED, lease.accept("lease-doc-two", 3_100L))
        assertEquals(PlaybackLease.Verdict.RENEWED, lease.accept("lease-doc-three", 3_200L))
        assertEquals(3L, lease.adoptions)
    }

    @Test
    fun `a retired lease stays retired however many documents come after it, within the bound`() {
        val lease = PlaybackLease(0L)
        lease.accept("lease-doc-zero", 0L)
        for (i in 1 until PlaybackLease.RETIRED_MAX) {
            lease.retire(i * 10L)
            lease.accept("lease-doc-$i".padEnd(10, 'x'), i * 10L + 1)
        }
        assertEquals(PlaybackLease.Verdict.RETIRED, lease.accept("lease-doc-zero", 10_000L))
    }

    @Test
    fun `a renderer loss re-homes a v4 session when its surface parent survives, else it ends and keeps the intent`() {
        assertEquals(PlaybackSessionPolicy.Outcome.REHOME, PlaybackSessionPolicy.v4(PlaybackSessionPolicy.Event.RENDERER_LOST, rehomeable = true))
        assertEquals(PlaybackSessionPolicy.Outcome.END_KEEP_INTENT, PlaybackSessionPolicy.v4(PlaybackSessionPolicy.Event.RENDERER_LOST, rehomeable = false))
        assertEquals("host-replaced", PlaybackSessionPolicy.reason(PlaybackSessionPolicy.Event.RENDERER_LOST))
        assertTrue("…and that end is transient: native again when the new page intends", NativeEndReasons.isTransient("host-replaced"))
    }

    // ─── §4.2 what still ends a v4 session ──────────────────────────

    @Test
    fun `operator UI, the lifecycle and an Activity pause still end a v4 session, and the intent waits for the page`() {
        for ((event, code) in listOf(
            PlaybackSessionPolicy.Event.OPERATOR_UI to "operator-ui",
            PlaybackSessionPolicy.Event.LIFECYCLE_NOT_READY to "lifecycle-not-ready",
            PlaybackSessionPolicy.Event.ACTIVITY_PAUSED to "activity-paused",
        )) {
            assertEquals(event.name, PlaybackSessionPolicy.Outcome.END_KEEP_INTENT, PlaybackSessionPolicy.v4(event))
            assertEquals(code, PlaybackSessionPolicy.reason(event))
            assertTrue("$code is a member of the closed table", code in NativeEndReasons.ALL)
            assertTrue("$code is never a verdict on the file", NativeEndReasons.isTransient(code))
            assertEquals(PlaybackSessionPolicy.Outcome.END_KEEP_INTENT, PlaybackSessionPolicy.fateOf(code))
        }
    }

    @Test
    fun `an emergency hold ends every v4 session and keeps the intent as suspended-by-hold`() {
        assertEquals(PlaybackSessionPolicy.Outcome.END_SUSPEND_INTENT, PlaybackSessionPolicy.v4(PlaybackSessionPolicy.Event.EMERGENCY_HOLD))
        assertEquals(PlaybackSessionPolicy.Outcome.END_SUSPEND_INTENT, PlaybackSessionPolicy.fateOf("emergency-held"))
        assertEquals("emergency-held", PlaybackSessionPolicy.reason(PlaybackSessionPolicy.Event.EMERGENCY_HOLD))
    }

    @Test
    fun `hold, suspended, restore — nothing starts under the hold, the page's intend after release starts it once`() {
        // Under the hold: a new intend is SUSPENDED (begin() would refuse it too).
        assertEquals(PlaybackSessionPolicy.IntendAction.SUSPEND, PlaybackSessionPolicy.onIntend(
            sameAsCurrent = false, sameAsNext = false, currentPresenting = false, switchOn = true, blocked = false, held = true))
        // The intent is persisted suspended and survives the store.
        val store = MapStore()
        val ints = PlaybackIntents(store)
        val m = NativeFirstMessage.parse(intend()) as NativeFirstMessage.Intend
        ints.put(0, PlaybackIntent.of(m, 1_700_000_000_000L).copy(suspendedByHold = true))
        assertTrue(PlaybackIntents(store).get(0)!!.suspendedByHold)
        // After the release the page restores (§4.3: "intend X, start: now"): the session ended with the
        // hold, so nothing presents, and the decision is a START — one start, no web lap.
        assertEquals(PlaybackSessionPolicy.IntendAction.START, PlaybackSessionPolicy.onIntend(
            sameAsCurrent = false, sameAsNext = false, currentPresenting = false, switchOn = true, blocked = false, held = false))
        // D5: the app never restarts content by itself — no outcome of the end table is a start; only
        // the page's intend (onIntend) can START, and only with the hold down.
        assertTrue(PlaybackSessionPolicy.Outcome.values().none { it.name.contains("START") || it.name.contains("RESTORE") })
        for (e in PlaybackSessionPolicy.Event.values()) {
            val o = PlaybackSessionPolicy.v4(e, reason = "codec-failed")
            assertTrue("$e → $o", o != PlaybackSessionPolicy.Outcome.REHOME || e == PlaybackSessionPolicy.Event.RENDERER_LOST)
        }
    }

    @Test
    fun `release at the boundary — the intent is gone, the end is deliberate, and the grammar demands a stated boundary`() {
        val r = NativeFirstMessage.parse("""{"version":4,"op":"release","lease":"lease-doc-one","at":"boundary"}""")
        assertEquals(NativeFirstMessage.Release("lease-doc-one", StartPolicy.BOUNDARY), r)
        assertEquals(StartPolicy.NOW, (NativeFirstMessage.parse("""{"version":4,"op":"release","lease":"lease-doc-one","at":"now"}""") as NativeFirstMessage.Release).at)
        assertNull("no `at`, no release", NativeFirstMessage.parse("""{"version":4,"op":"release","lease":"lease-doc-one"}"""))
        assertEquals(PlaybackSessionPolicy.Outcome.END_DISCARD_INTENT, PlaybackSessionPolicy.v4(PlaybackSessionPolicy.Event.RELEASED))
        assertEquals("released", PlaybackSessionPolicy.reason(PlaybackSessionPolicy.Event.RELEASED))
        assertTrue("released" in PlaybackSessionPolicy.DELIBERATE)
        // At the boundary A keeps presenting until its loop end, bounded like today's hand-off wait.
        assertEquals(60_000L, NativeFirstBoundary.BOUNDARY_WAIT_MS)
    }

    @Test
    fun `a credential that names another screen ends the session and discards the intent`() {
        assertEquals(PlaybackSessionPolicy.Outcome.END_DISCARD_INTENT, PlaybackSessionPolicy.v4(PlaybackSessionPolicy.Event.CREDENTIAL_IDENTITY))
        assertEquals(PlaybackSessionPolicy.Outcome.END_DISCARD_INTENT, PlaybackSessionPolicy.fateOf("credential-identity"))
    }

    @Test
    fun `a live page that never adopts a presenting v4 session is not its controller, and the intent goes`() {
        assertEquals(PlaybackSessionPolicy.Outcome.END_DISCARD_INTENT, PlaybackSessionPolicy.v4(PlaybackSessionPolicy.Event.UNADOPTED))
        assertEquals("document-retired", PlaybackSessionPolicy.reason(PlaybackSessionPolicy.Event.UNADOPTED))
        assertTrue("generous: a re-attaching page reads state before it mounts anything", PlaybackSessionPolicy.ADOPT_GRACE_MS >= 30_000L)
    }

    @Test
    fun `a fault discards the intent, a not-ready end keeps it`() {
        assertEquals(PlaybackSessionPolicy.Outcome.END_DISCARD_INTENT, PlaybackSessionPolicy.fateOf("codec-failed"))
        assertEquals(PlaybackSessionPolicy.Outcome.END_DISCARD_INTENT, PlaybackSessionPolicy.fateOf("hardware-codec-unavailable"))
        // A raw network code is normalised first: an offline read is NOT a fault.
        assertEquals(PlaybackSessionPolicy.Outcome.END_KEEP_INTENT, PlaybackSessionPolicy.fateOf("manifest-http-503"))
        assertEquals(PlaybackSessionPolicy.Outcome.END_KEEP_INTENT, PlaybackSessionPolicy.fateOf("authorization-failed"))
        assertEquals(PlaybackSessionPolicy.Outcome.END_KEEP_INTENT, PlaybackSessionPolicy.fateOf("not-in-store"))
    }

    // ─── §4.3 the intend decision ───────────────────────────────────

    @Test
    fun `an adopt outranks everything — a switch flip or a block never restarts what presents`() {
        for (switchOn in listOf(true, false)) for (blocked in listOf(true, false)) {
            assertEquals(PlaybackSessionPolicy.IntendAction.ADOPT, PlaybackSessionPolicy.onIntend(
                sameAsCurrent = true, sameAsNext = false, currentPresenting = true, switchOn = switchOn, blocked = blocked, held = false))
        }
        assertEquals(PlaybackSessionPolicy.IntendAction.ADOPT_NEXT, PlaybackSessionPolicy.onIntend(
            sameAsCurrent = false, sameAsNext = true, currentPresenting = true, switchOn = false, blocked = false, held = false))
        assertEquals(PlaybackSessionPolicy.IntendAction.REFUSE_SWITCH_OFF, PlaybackSessionPolicy.onIntend(
            sameAsCurrent = false, sameAsNext = false, currentPresenting = true, switchOn = false, blocked = false, held = false))
        assertEquals(PlaybackSessionPolicy.IntendAction.REFUSE_BLOCKED, PlaybackSessionPolicy.onIntend(
            sameAsCurrent = false, sameAsNext = false, currentPresenting = false, switchOn = true, blocked = true, held = false))
        assertEquals(PlaybackSessionPolicy.IntendAction.PREROLL, PlaybackSessionPolicy.onIntend(
            sameAsCurrent = false, sameAsNext = false, currentPresenting = true, switchOn = true, blocked = false, held = false))
        // The hold is checked before any boundary: nothing pre-rolls under it either.
        assertEquals(PlaybackSessionPolicy.IntendAction.SUSPEND, PlaybackSessionPolicy.onIntend(
            sameAsCurrent = false, sameAsNext = false, currentPresenting = true, switchOn = true, blocked = false, held = true))
    }

    // ─── §4.1 the persisted intent ──────────────────────────────────

    @Test
    fun `the intent survives a simulated process death, byte for byte`() {
        val store = MapStore()
        val before = PlaybackIntents(store)
        val m = NativeFirstMessage.parse(intend(start = "boundary")) as NativeFirstMessage.Intend
        val intent = PlaybackIntent.of(m, 1_760_000_000_000L)
        assertTrue(before.put(0, intent))
        // The process dies: nothing in memory survives, only the store.
        val after = PlaybackIntents(store)
        assertEquals(intent, after.get(0))
        assertEquals(StartPolicy.BOUNDARY, after.get(0)!!.start)
        assertEquals(m.identity, after.get(0)!!.identity)
        assertNull("the other face holds nothing", after.get(1))
        // A release clears it, and that survives too.
        after.put(0, null)
        assertNull(PlaybackIntents(store).get(0))
    }

    @Test
    fun `a damaged intent store reads as no intent — never a guess`() {
        val store = MapStore()
        for (raw in listOf("{", "{}", """{"v":2}""", """{"v":1,"screenId":"x"}""",
            JSONObject(PlaybackIntent.of(NativeFirstMessage.parse(intend())as NativeFirstMessage.Intend, 1L).toJson().toString()).put("sha256", "nope").toString())) {
            store.values[0] = raw
            assertNull(raw, PlaybackIntents(store).get(0))
        }
    }

    // ─── §3.5 the grammar ───────────────────────────────────────────

    @Test
    fun `version 4 carries identity only — a URL or a credential refuses the whole message`() {
        val ok = NativeFirstMessage.parse(intend()) as NativeFirstMessage.Intend
        assertEquals(listOf(screen, "rev-1", shaA, asset), ok.identity)
        assertEquals(StartPolicy.NOW, ok.start)
        for (key in NativeFirstMessage.FORBIDDEN_KEYS) {
            assertNull(key, NativeFirstMessage.parse(JSONObject(intend()).put(key, "https://example.test/x.mp4").toString()))
        }
        assertNull("not a v4 message", NativeFirstMessage.parse(JSONObject(intend()).put("version", 2).toString()))
        assertNull("unknown op", NativeFirstMessage.parse(JSONObject(intend()).put("op", "play").toString()))
        assertNull("bad start", NativeFirstMessage.parse(JSONObject(intend()).put("start", "later").toString()))
        assertNull("bad lease", NativeFirstMessage.parse(JSONObject(intend()).put("lease", "x").toString()))
        assertNull("bad digest", NativeFirstMessage.parse(intend(sha = "z".repeat(64))))
        assertNull("bad screen", NativeFirstMessage.parse(JSONObject(intend()).put("screenId", "../x").toString()))
        assertNull("oversized", NativeFirstMessage.parse(JSONObject(intend()).put("pad", "x".repeat(1100)).toString()))
        // An upper-case digest is the same file.
        assertEquals(shaA, (NativeFirstMessage.parse(intend(sha = shaA.uppercase())) as NativeFirstMessage.Intend).sha256)
    }

    @Test
    fun `sync is a nudge with no lease, rate-limited, single-flight, the latest tag wins`() {
        val s = NativeFirstMessage.parse("""{"version":4,"op":"sync","manifestTag":"W/\"abc\"","emergencySetHash":"e1"}""")
        assertEquals(NativeFirstMessage.Sync("W/\"abc\"", "e1"), s)
        assertNull((NativeFirstMessage.parse("""{"version":4,"op":"sync","manifestTag":"t1"}""") as NativeFirstMessage.Sync).emergencySetHash)
        assertNull(NativeFirstMessage.parse("""{"version":4,"op":"sync","manifestTag":"has space"}"""))
        val gate = SyncGate(minIntervalMs = 2_000L)
        val t1 = NativeFirstMessage.Sync("t1", null)
        val t2 = NativeFirstMessage.Sync("t2", null)
        val t3 = NativeFirstMessage.Sync("t3", null)
        assertTrue(gate.offer(t1, 0L))
        assertFalse("single-flight", gate.offer(t2, 100L))
        assertFalse(gate.offer(t3, 200L))
        assertEquals("the latest tag waits", t3, gate.done())
        assertFalse("rate-limited", gate.offer(t3, 1_000L))
        assertEquals(t3, gate.takePending())
        assertTrue(gate.offer(t3, 2_000L))
    }

    // ─── the reply bound ────────────────────────────────────────────

    @Test
    fun `the state reply is trimmed under the page's 16 KB bound — history first, never state, lease or intent`() {
        val history = JSONObject().put("entries", org.json.JSONArray().apply { repeat(60) { put(JSONObject().put("pad", "x".repeat(200))) } })
        val reply = JSONObject().put("version", 1).put("state", "presenting").put("protocol", 2).put("protocolMax", 4)
            .put("timing", JSONObject().put("lateFrames", 3).put("history", history))
            .put("sessions", org.json.JSONArray().put(JSONObject().put("slot", "").put("timing", JSONObject().put("history", history))))
            .put("lease", JSONObject().put("id", "lease-doc-one").put("live", true))
            .put("intent", JSONObject().put("sha256", shaA).put("status", "presenting"))
            .put("store", JSONObject().put("mode", "active").put("ready", org.json.JSONArray().apply { repeat(64) { put(shaB) } }))
        assertTrue(reply.toString().length > 16_384)
        val fit = ReplyBudget.fit(reply)
        assertTrue(fit.toString().length <= ReplyBudget.MAX_CHARS)
        assertEquals("presenting", fit.getString("state"))
        assertEquals("lease-doc-one", fit.getJSONObject("lease").getString("id"))
        assertEquals(shaA, fit.getJSONObject("intent").getString("sha256"))
        assertEquals(3, fit.getJSONObject("timing").getInt("lateFrames"))
        // A reply already under the bound is returned untouched.
        val small = JSONObject().put("version", 1).put("timing", JSONObject().put("history", JSONObject()))
        assertTrue(ReplyBudget.fit(small).getJSONObject("timing").has("history"))
    }

    // ─── §3.4 the app's 24 h block ──────────────────────────────────

    @Test
    fun `a real fault blocks the file for 24 h on this face and this build only`() {
        var stored: String? = null
        val kv = object : NativeFaultBlocks.Kv {
            override fun get(): String? = stored
            override fun put(value: String) { stored = value }
        }
        val blocks = NativeFaultBlocks(kv, "1.1.44")
        blocks.block(shaA, 0, 1_000L)
        assertNotNull(blocks.blockedUntil(shaA, 0, 2_000L))
        assertNull("another face", blocks.blockedUntil(shaA, 1, 2_000L))
        assertNull("another file", blocks.blockedUntil(shaB, 0, 2_000L))
        assertNull("a new build gets a fresh chance", NativeFaultBlocks(kv, "1.1.45").blockedUntil(shaA, 0, 2_000L))
        assertNull("it expires", blocks.blockedUntil(shaA, 0, 1_000L + NativeFaultBlocks.BLOCK_MS))
        // Bounded: never more than MAX entries, the newest kept.
        for (i in 0 until 50) blocks.block(i.toString(16).padStart(64, '0'), 0, 10_000L + i)
        assertTrue(JSONObject(stored!!).length() <= NativeFaultBlocks.MAX)
    }
}
