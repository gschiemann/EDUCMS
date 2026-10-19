package com.educms.player.media

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assume
import org.junit.Test
import java.io.File

/**
 * ONE COMPOSITING CONTRACT — THE WIRING, as source facts (1.1.41, plan §4A).
 *
 * [SoloVideoLayerTest] and [DeviceClassPolicyTest] prove the decisions; this
 * proves the view code honours them: the WebView is never made transparent,
 * a static solo surface takes its z-order before its child window exists,
 * an emergency hold reaches every native session and the hide-and-remove of
 * an elevated surface runs on the main thread without waiting for a post,
 * the WebView is restored (visible, opaque) FIRST, and a positioned-slot
 * request is refused by the class table before any network or surface.
 *
 * Same shape as `UserStandbyWiringTest`: skipped, not failed, when the
 * sources are not on disk. Every assertion here was red on the .40 tree.
 */
class FaceVideoBoxContractTest {
    private val moduleRoot: File? by lazy {
        var dir: File? = File("").absoluteFile
        while (dir != null) {
            if (File(dir, "src/main/AndroidManifest.xml").isFile) return@lazy dir
            val nested = File(dir, "app/src/main/AndroidManifest.xml")
            if (nested.isFile) return@lazy File(dir, "app")
            dir = dir.parentFile
        }
        null
    }

    private fun read(relative: String): String {
        val root = moduleRoot
        Assume.assumeTrue("module root not on disk", root != null)
        val f = File(root, relative)
        Assume.assumeTrue("source not on disk: $relative", f.isFile)
        return f.readText()
    }

    private val box get() = read("src/main/java/com/educms/player/media/FaceVideoBox.kt")
    private val host get() = read("src/main/java/com/educms/player/media/SharedVideoHost.kt")
    private val emergency get() = read("src/main/java/com/educms/player/display/DisplayEmergency.kt")
    private val activity get() = read("src/main/java/com/educms/player/MainActivity.kt")

    /** Kotlin source with comments removed, so a fact is never satisfied by prose. */
    private fun code(src: String): String =
        src.replace(Regex("/\\*[\\s\\S]*?\\*/"), "").lines().joinToString("\n") { it.substringBefore("//") }

    /**
     * The body of `fun name(` up to the next member declaration. An
     * `override fun` inside an anonymous object (a SurfaceHolder.Callback)
     * is part of the body, not its end.
     */
    private fun body(src: String, signature: String): String {
        val at = src.indexOf(signature)
        assertTrue("`$signature` not found", at >= 0)
        val next = Regex("\\n\\s*(?:@Synchronized )?(?:private |internal |public )?fun ").find(src, at + signature.length)
        return src.substring(at, next?.range?.first ?: src.length)
    }

    @Test
    fun `the WebView is never made transparent by either native engine`() {
        for ((name, src) in listOf("FaceVideoBox" to code(box), "SharedVideoHost" to code(host))) {
            assertFalse("$name: a WebView must never get Color.TRANSPARENT", Regex("web\\.setBackgroundColor\\(\\s*Color\\.TRANSPARENT").containsMatchIn(src))
            assertFalse("$name: no conditional transparency either", Regex("setBackgroundColor\\(if \\(").containsMatchIn(src))
        }
        val b = code(box)
        assertTrue("commit re-asserts opaque black", body(b, "fun commit(").contains("host.web.setBackgroundColor(Color.BLACK)"))
        assertTrue("stopSession re-asserts opaque black unconditionally",
            body(b, "private fun stopSession(").contains("host.web.setBackgroundColor(Color.BLACK)"))
        assertFalse("the restore is not gated on 'no other live session'",
            body(b, "private fun stopSession(").contains("none { it.alive && it.attached }"))
        // The only TRANSPARENT left is the SURFACE's container, never the WebView.
        val transparent = Regex("\\w+\\.setBackgroundColor\\(Color\\.TRANSPARENT\\)").findAll(b).map { it.value }.toList()
        assertEquals(listOf("container.setBackgroundColor(Color.TRANSPARENT)"), transparent)
    }

    @Test
    fun `the pair engine refuses with composition-unavailable before any network, surface or decoder`() {
        val prepare = body(code(host), "fun prepare(host: SharedVideoHost,json: String)")
        assertTrue(prepare.contains("SoloVideoLayer.REASON_COMPOSITION_UNAVAILABLE"))
        assertTrue(prepare.contains("host.state = \"failed\""))
        for (forbidden in listOf("SharedVideoSource(", "io.execute", "SharedVideoRenderer(", "addView(")) {
            assertFalse("prepare must not reach $forbidden", prepare.contains(forbidden))
        }
        assertFalse("no decoder pipeline is left in the pair engine", code(host).contains("SharedVideoRenderer("))
    }

    @Test
    fun `a static solo surface takes its z-order before its child window exists`() {
        val attach = body(code(box), "private fun attachSurface(")
        val zorder = attach.indexOf("sv.setZOrderOnTop(s.layer.staticAbove)")
        val added = attach.indexOf("box.addView(surface, lp)")
        assertTrue("setZOrderOnTop must be set at SurfaceView construction", zorder >= 0)
        assertTrue("…and before the view is added to the tree", added > zorder)
    }

    @Test
    fun `an emergency hold reaches every native session and hides the surface synchronously on the main thread`() {
        val e = code(emergency)
        val enforce = body(e, "fun enforceNow(")
        assertTrue("enforceNow suppresses native video while held", enforce.contains("SharedVideoHost.suppressForEmergency()"))
        val h = code(host)
        val suppress = body(h, "fun suppressForEmergency()")
        assertTrue(suppress.contains("FaceVideoBox.suppress(\"emergency-held\")"))
        assertTrue(suppress.contains("SharedVideoBox.suppress(\"emergency-held\")"))
        val b = code(box)
        val stop = body(b, "private fun stopSession(")
        assertTrue("the surface is hidden", stop.contains("s.surface?.visibility = View.GONE"))
        assertTrue("…and removed", stop.contains("removeView(s.surface)"))
        assertTrue("a main-thread retirement runs the view work inline, never waiting for a post",
            stop.contains("if (Looper.myLooper() == Looper.getMainLooper()) removeOutput.run() else main.post(removeOutput)"))
        assertTrue("the layer is retired before any view work", stop.indexOf("s.layer.retire()") < stop.indexOf("val removeOutput"))
        assertTrue("suppress stops every session of every host", body(b, "fun suppress(").contains("hosts.values.forEach"))
    }

    @Test
    fun `the WebView comes back visible and opaque FIRST on any end, before the surface work`() {
        val stop = body(code(box), "private fun stopSession(")
        val removeOutput = stop.substring(stop.indexOf("val removeOutput"))
        val visible = removeOutput.indexOf("host.web.visibility = View.VISIBLE")
        val gone = removeOutput.indexOf("s.surface?.visibility = View.GONE")
        val black = removeOutput.indexOf("host.web.setBackgroundColor(Color.BLACK)")
        assertTrue("visibility is restored", visible >= 0)
        assertTrue("…before the surface is hidden", gone > visible)
        assertTrue("…and the opaque background is re-asserted", black > gone)
        // Experiment 1 can only hide the WebView once native is confirmed on the glass, and only if the guard allows it.
        val updated = body(code(box), "private fun updated(")
        val hide = updated.indexOf("host.web.visibility = View.INVISIBLE")
        assertTrue(hide >= 0)
        val confirm = updated.indexOf("s.layer.confirm(")
        assertTrue("hidden only after confirm", hide > confirm)
        assertTrue(updated.substring(confirm, hide).contains("experiments.allows(NativeVideoExperiments.WEBVIEW_INVISIBLE)"))
        assertTrue(updated.substring(confirm, hide).contains("d.experiments.webviewInvisible"))
    }

    @Test
    fun `a session the class table refuses is stopped with its stable reason before any work`() {
        val b = code(box)
        val begin = body(b, "private fun begin(")
        val refusal = begin.indexOf("session.refusal?.let { stopSession(host, session, it); return null }")
        assertTrue("the refusal is applied", refusal >= 0)
        assertTrue("…before the emergency / lifecycle checks", refusal < begin.indexOf("DisplayEmergency.isHeld(host.ctx)"))
        assertTrue("…and before the authenticated fetch", refusal < begin.indexOf("meta.execute"))
        assertTrue("the session is registered first so the page reads the reason", refusal > begin.indexOf("host.faceSessions[session.key] = session"))
        assertTrue("sessions are built from the resolved class", b.contains("DeviceClassPolicy.current(host.ctx)"))
        assertTrue("the advertised protocolMax is the class table's", body(b, "fun state(host: SharedVideoHost)").contains("protocolMax(host, DeviceClassPolicy.current(host.ctx))"))
        val max = body(b, "internal fun protocolMax(")
        assertTrue("…4 only where the class AND this face's enrolment allow it",
            max.contains("val manifest = switchValue(host.ctx, host.face)") && max.contains("return policy.protocolMax(policy.nativeFirst(manifest))"))
        assertTrue("a screen that is not enrolled makes no new request", max.contains("if (policy.nativeSolo && manifest == true) maybeRefreshSwitch(host)"))
        assertTrue("the host reply carries the resolved class", body(code(host), "fun stateJson()").contains("policy.toJson()"))
        assertTrue("a refused session never uploads diagnostics", body(b, "private fun queueDiagnostics(").contains("s.refusal != null"))
    }

    @Test
    fun `a positioned slot is above the window from creation, parked beyond the display, and revealed only at play`() {
        val b = code(box)
        val attach = body(b, "private fun attachSurface(")
        // The slot's layer is the static shape, so the same creation-time z-order line serves it.
        assertTrue(attach.contains("sv.setZOrderOnTop(s.layer.staticAbove)"))
        assertTrue("a slot is parked by the display-aware rule, not merely right of the WebView",
            attach.contains("SoloVideoLayer.parkingLeft(parent.width, displaySize.x, parentScreen[0], fitted[0])"))
        val rect = body(b, "private fun boxRect(")
        assertTrue(rect.contains("if (s.onGlass) r else FaceZonePolicy.parked(r, maxOf(parentW, s.parkLeft))"))
        // The reveal is `play`: supersede the on-glass session it covers and move the box in ONE UI pass.
        val play = body(b, "fun play(")
        val superseded = play.indexOf("stopSession(host, it, \"superseded\")")
        val onGlass = play.indexOf("s.onGlass = true")
        val moved = play.indexOf("applyRect(host, s)")
        val released = play.indexOf("s.renderer?.release()")
        assertTrue(superseded >= 0 && onGlass > superseded && moved > onGlass && released > moved)
        // A slot never enters the solo reveal state machine: its first frame is "presenting" while parked.
        val updated = body(b, "private fun updated(")
        val slot = updated.indexOf("if (s.protocol == 3) {")
        assertTrue(slot >= 0 && slot < updated.indexOf("s.layer.phase == SoloVideoLayer.Phase.ABOVE_WINDOW) {"))
        assertTrue(updated.substring(slot, updated.indexOf("} else if", slot)).contains("s.state = \"presenting\""))
        // No hole, no transparency: the WebView is never touched for a slot.
        assertFalse(play.contains("setBackgroundColor"))
        assertFalse(play.contains("visibility"))
    }

    @Test
    fun `experiment 3 is only ever a value of the existing setOrientation bridge method`() {
        val a = code(activity)
        assertTrue(a.contains("ORIENTATION_NATURAL   -> ActivityInfo.SCREEN_ORIENTATION_NOSENSOR"))
        assertTrue(a.contains("const val ORIENTATION_NATURAL = \"NATURAL\""))
        val bridge = read("src/main/java/com/educms/player/WebAppBridge.kt")
        assertFalse("no new bridge method (rule 9)", Regex("fun (setNaturalOrientation|nativeVideoExperiment)").containsMatchIn(bridge))
    }

    @Test
    fun `the 60 Hz request is automatic at a session boundary, before the surface exists, once per process, never for a slot, never under a hold`() {
        val b = code(box)
        val attach = body(b, "private fun attachSurface(")
        val read = attach.indexOf("DisplayModePolicy.read(parent.display)")
        val gate = attach.indexOf("val mode = d.experiments.prefer60hz")
        val holdRead = attach.indexOf("val held = DisplayEmergency.isHeld(host.ctx)")
        val off = attach.indexOf("if (mode == Prefer60Hz.OFF) {")
        val held = attach.indexOf("} else if (held) {")
        val block = attach.indexOf("val blockedUntil = Prefer60HzBlock.blockedUntil(host.ctx, nowMs)")
        val request = attach.indexOf("PreferredDisplayMode.request(host.face, window, active, modes, blockedUntil, nowMs)")
        val withdraw = attach.indexOf("PreferredDisplayMode.withdraw(host.face, window)")
        val armed = attach.indexOf("armModeSafetyNet(host, s, it)")
        val surface = attach.indexOf("SurfaceView(host.web.context)")
        assertTrue("the supported modes are read unconditionally …", read >= 0 && gate > read)
        assertTrue("… inside the first-attach branch", attach.substring(0, read).contains("if (s.surface == null) {"))
        assertTrue("the hold is read before either branch can touch the display mode", holdRead > gate && holdRead < off)
        assertTrue("the kill switch (OFF) reverts at the boundary; nothing else is asked then", off > holdRead && withdraw > off && withdraw < held)
        assertTrue("… but never under a hold: a withdraw is a mode switch too", attach.contains("if (!otherAttached && !held) PreferredDisplayMode.withdraw(host.face, window)"))
        assertTrue("an emergency hold at the boundary asks nothing", held > off && held < request)
        assertTrue("the request is behind the persisted 24 h block, always", block > held && block < request)
        assertFalse("no manifest key walks past the block (tokens only remove behaviour)", attach.contains("Prefer60Hz.AUTO") || attach.contains("FORCE"))
        assertTrue("the request is made …", request > block)
        assertTrue("… and the safety net is armed the moment it is applied", armed > request)
        assertTrue("all of it happens BEFORE this session's SurfaceView exists", surface > armed && surface > withdraw)
        assertTrue("only a solo session on the DEFAULT display's face asks (a slot never does; face 1's panel has no frame proof of its own)",
            attach.substring(read, gate).contains("if (s.protocol == 2 && host.face == DisplayEmergency.PRIMARY_FACE) {"))
        assertEquals(0, com.educms.player.display.DisplayEmergency.PRIMARY_FACE)
        assertTrue("another attached session makes the boundary mid-session: nothing is asked", attach.contains("otherAttached"))
        assertTrue("the window is the FACE's (Activity or Presentation), never a guess", attach.contains("val window = host.window()"))
        // The safety net: a Choreographer watch for the window, then the verdict on the UI thread; ONE revert path.
        val verify = body(b, "private fun verifyPreferredMode(")
        assertTrue(verify.contains("PreferredDisplayMode.verdict(p, activeNow, modeFrames.lastFrameNs, System.nanoTime())"))
        assertTrue("a request already confirmed, reverted or withdrawn is left alone", verify.contains("if (PreferredDisplayMode.pending !== p)"))
        assertTrue(verify.contains("revertPreferredMode(host, s, verdict)"))
        val revert = body(b, "private fun revertPreferredMode(")
        assertTrue("the revert blocks the automatic request for 24 h", revert.contains("Prefer60HzBlock.block(host.ctx, System.currentTimeMillis() + PreferredDisplayMode.BLOCK_MS, verdict)"))
        assertTrue("the window write runs on the UI thread, the bookkeeping at once", revert.contains("if (Looper.myLooper() == Looper.getMainLooper()) revert.run() else main.post(revert)"))
        assertEquals("exactly one caller of PreferredDisplayMode.revert", 1, Regex("PreferredDisplayMode\\.revert\\(").findAll(b).count())
        assertEquals("exactly one block writer", 1, Regex("Prefer60HzBlock\\.block\\(").findAll(b).count())
        // The first native frame after the request confirms it (updated); a stall before it is the switch's failure (stopSession).
        assertTrue(body(b, "private fun updated(").contains("if (PreferredDisplayMode.confirm(host.face)) {"))
        val stop = body(b, "private fun stopSession(")
        assertTrue(stop.contains("reason in MODE_SWITCH_FAULTS && (s.modeReverted || PreferredDisplayMode.pending?.face == host.face)"))
        assertTrue(stop.contains("REASON_DISPLAY_MODE_REVERTED"))
        assertTrue("the re-grade happens before anything else in stopSession", stop.indexOf("MODE_SWITCH_FAULTS") < stop.indexOf("s.alive = false"))
        assertEquals("display-mode-reverted", FaceVideoBox.REASON_DISPLAY_MODE_REVERTED)
        assertTrue("… and that code is TRANSIENT on this side", NativeEndGrade.retries(FaceVideoBox.REASON_DISPLAY_MODE_REVERTED))
        // The one place the preferred mode id is ever written is the window half of DisplayModePolicy.kt.
        assertFalse(b.contains("preferredDisplayModeId"))
        val policy = code(read("src/main/java/com/educms/player/media/DisplayModePolicy.kt"))
        assertEquals(1, Regex("lp\\.preferredDisplayModeId = modeId").findAll(policy).count())
        for ((name, src) in listOf("SharedVideoHost" to code(host), "FaceVideoRenderer" to code(read("src/main/java/com/educms/player/media/FaceVideoRenderer.kt")))) {
            assertFalse("$name never touches the display mode", src.contains("preferredDisplayModeId"))
        }
        val h = code(host)
        assertTrue("the Activity hands its window to face 0", code(activity).contains("window = { window }, operatorUiClear = ::nativeVideoUiClear"))
        assertTrue("a face Presentation hands its own window", code(read("src/main/java/com/educms/player/face/FacePresentation.kt")).contains("host.configure(root, window)"))
        assertTrue(h.contains("internal val window: () -> Window?"))
        // The panel firmware facts are read-only: no sysfs write anywhere in the engine.
        val device = code(read("src/main/java/com/educms/player/media/DeviceClassPolicy.kt"))
        assertFalse(Regex("(writeText|outputStream|FileWriter|FileOutputStream)").containsMatchIn(device))
        assertTrue(device.contains("if (!f.isFile || !f.canRead()) return@runCatching null"))
    }

    @Test
    fun `the vsync snap acquires the grid before the renderer exists, only on the default display, and releases it with the session`() {
        val b = code(box)
        val ready = body(b, "fun surfaceReady(")
        val gate = ready.indexOf("if (d.experiments.vsyncSnap && s.protocol == 2 && experiments.allows(NativeVideoExperiments.VSYNC_SNAP))")
        val acquire = ready.indexOf("grid = vsync.acquire(")
        val renderer = ready.indexOf("FaceVideoRenderer(file, d, sv.holder.surface")
        assertTrue(gate >= 0 && acquire > gate && renderer > acquire)
        assertTrue("snapped only on the display Choreographer samples", ready.substring(gate, acquire).contains("android.view.Display.DEFAULT_DISPLAY"))
        assertTrue("the renderer receives the grid", ready.contains("vsync = grid)"))
        val stop = body(b, "private fun stopSession(")
        assertTrue(stop.contains("vsync.release()"))
        assertTrue(stop.contains("experiments.ended(NativeVideoExperiments.VSYNC_SNAP, why)"))
        // The emergency ordering is untouched: the grid release happens before the view pass, which still restores the WebView first.
        assertTrue(stop.indexOf("vsync.release()") < stop.indexOf("val removeOutput"))
        // The release path keeps the late / drop policy and uses the schedule's snapped timestamp.
        val r = code(read("src/main/java/com/educms/player/media/FaceVideoRenderer.kt"))
        val drain = body(r, "fun drain(")
        assertTrue(drain.contains("schedule.shouldDrop(due, now)"))
        assertTrue(drain.contains("schedule.observe(due, now)"))
        assertTrue(drain.contains("val at = schedule.releaseTime(due, now)"))
        assertTrue(drain.contains("c.releaseOutputBuffer(index, at)"))
        assertTrue(drain.indexOf("schedule.observe(due, now)") < drain.indexOf("schedule.releaseTime(due, now)"))
    }

    // ─── NATIVE-FIRST (protocol 4, design §4 + §7) ─────────────────────

    @Test
    fun `E1 - suppression reaches every v4 session - pre-roll, held predecessor and unattended alike`() {
        val b = code(box)
        val suppress = body(b, "fun suppress(")
        assertTrue(suppress.contains("hosts.values.forEach { h -> h.faceSessions.values.toList().forEach { stopSession(h, it, why) } }"))
        assertFalse("no filter of any kind in front of the hold", suppress.contains("v4") || suppress.contains("key") || suppress.contains("lease"))
        // The pre-roll and the held predecessor are REGISTERED sessions, so the loop above reaches them.
        assertTrue(body(b, "private fun begin(").contains("host.faceSessions[session.key] = session"))
        assertTrue(body(b, "private fun swap(").contains("host.faceSessions[PREV] = it"))
        assertTrue(b.contains("b.key = NEXT"))
        // An unattended session has no separate registry: the lease only gates the page, never suppress.
        assertFalse(b.contains("unattendedSessions"))
        // The emergency path into it is unchanged.
        assertTrue(body(code(emergency), "fun enforceNow(").contains("SharedVideoHost.suppressForEmergency()"))
        assertTrue(body(code(host), "fun suppressForEmergency()").contains("FaceVideoBox.suppress(\"emergency-held\")"))
    }

    @Test
    fun `E1 - the view pass order is unchanged for every v4 end, and the bookkeeping runs before it`() {
        val stop = body(code(box), "private fun stopSession(")
        val end = stop.indexOf("if (s.v4) endV4(host, s, why)")
        val removeOutput = stop.indexOf("val removeOutput")
        assertTrue("v4 bookkeeping first, then the same view pass", end in 0 until removeOutput)
        assertTrue("…which still runs inline on the main thread",
            stop.contains("if (Looper.myLooper() == Looper.getMainLooper()) removeOutput.run() else main.post(removeOutput)"))
        assertTrue("v4 ends report closed-table codes only", stop.contains("val why = if (s.v4) NativeEndReasons.normalize(graded) else graded"))
        assertTrue("the layer is retired before the bookkeeping", stop.indexOf("s.layer.retire()") < end)
    }

    @Test
    fun `E2 - nothing v4 starts under a hold, and the WebView stays visible and opaque under every v4 session`() {
        val b = code(box)
        val intend = body(b, "private fun intend(")
        assertTrue("the hold is part of the decision", intend.contains("held = DisplayEmergency.isHeld(host.ctx)"))
        assertTrue("…and an intent under it is kept suspended", intend.contains("ints.put(face, intent.copy(suspendedByHold = true))"))
        assertTrue(body(b, "private fun begin(").contains("if (DisplayEmergency.isHeld(host.ctx)) { stopSession(host, session, \"emergency-held\"); return null }"))
        val start = body(b, "private fun startNow(")
        assertTrue(start.indexOf("DisplayEmergency.isHeld(host.ctx)") in 0 until start.indexOf("s.renderer?.start()"))
        assertTrue("opaque black, set-to-known-value", start.contains("host.web.setBackgroundColor(Color.BLACK)"))
        val ready = body(b, "private fun v4Ready(")
        assertTrue("not even a hidden pre-roll decoder starts under a hold",
            ready.indexOf("DisplayEmergency.isHeld(host.ctx)") in 0 until ready.indexOf("s.renderer?.start()"))
        // Experiment 1 can never hide the WebView under a v4 session (it may outlive its page).
        val updated = body(b, "private fun updated(")
        val hide = updated.indexOf("host.web.visibility = View.INVISIBLE")
        assertTrue(updated.substring(updated.indexOf("s.layer.confirm("), hide).contains("!s.v4"))
        // Its fault guard keys on the lease lapse: VISIBLE again and off for the process.
        val lapsed = body(b, "private fun leaseLapsed(")
        assertTrue(lapsed.contains("host.web.visibility = View.VISIBLE"))
        assertTrue(lapsed.contains("experiments.ended(NativeVideoExperiments.WEBVIEW_INVISIBLE, \"page-lease-expired\")"))
        assertTrue("page-lease-expired trips the guard", "page-lease-expired" in NativeExperimentGuard.FAULTS)
    }

    @Test
    fun `no page event ends a v4 session - document change, silence and a renderer loss leave it presenting`() {
        val b = code(box)
        val invalidate = body(b, "fun invalidate(")
        assertTrue("v2 / v3 end as before; v4 does not", invalidate.contains("if (!it.v4) stopSession(host, it, why)"))
        assertTrue("…the outgoing document's lease is absent at once instead", invalidate.contains("lease.onDocumentChange(now)"))
        val watch = body(b, "private fun watch(")
        assertTrue(watch.contains("!s.v4 && now - s.lastPoll > 10_000 -> \"page-lease-expired\""))
        assertTrue("every tick reads the session's CURRENT host", watch.contains("val host = s.host"))
        val attach = body(b, "fun attach(host: SharedVideoHost)")
        assertTrue(attach.contains("PlaybackSessionPolicy.v4(PlaybackSessionPolicy.Event.RENDERER_LOST, rehomeable)"))
        assertTrue("re-homed, not restarted", attach.contains("s.host = host"))
        assertTrue("only into the same surviving parent", attach.contains("parent === host.web.parent"))
        assertTrue("the lease is absent at once on a renderer loss", attach.contains("it.retire(now)"))
        assertTrue("a v4 session has no commit", body(b, "fun commit(").contains("if (s.v4) return"))
        // Renderer callbacks never trust a captured host.
        val ready = body(b, "fun surfaceReady(")
        assertTrue(ready.contains("failed = { why -> synchronized(this) { if (liveNow(s)) stopSession(s.host, s, why) } }"))
        assertTrue(ready.contains("rendered = { nanos, pts -> synchronized(this) { if (liveNow(s)) updated(s.host, s, nanos, pts) } }"))
        // …but the page still ends it explicitly, the operator UI and the lifecycle still end it.
        assertTrue(body(b, "fun stop(host: SharedVideoHost, id: String)").contains("\"page-requested\""))
        val pageStopped = body(b, "private fun pageStopped(")
        assertTrue(pageStopped.contains("\"lifecycle-not-ready\"") && pageStopped.contains("\"operator-ui\""))
        assertTrue(body(b, "fun yieldToUi(").contains("if (it.v4) pageStopped(host, it) else why"))
        // A LIVE page that never adopts is not the controller: after the grace, the session goes and so
        // does the intent — a face whose page is alive is never left "unattended" for the alert watch.
        val poll = body(b, "fun onStatePoll(")
        assertTrue(poll.contains("if (lease.renew(now))"))
        assertTrue(poll.contains("val intent = intentsMemo?.get(host.face)"))
        assertTrue(poll.contains("PlaybackSessionPolicy.ADOPT_GRACE_MS"))
        assertTrue(poll.contains("intents(host.ctx).put(host.face, null)"))
        assertTrue(poll.contains("v4Sessions.forEach { stopSession(host, it, \"document-retired\") }"))
    }

    @Test
    fun `protocol 4 rides the existing sharedVideoPrepare and the reply stays under the page's bound`() {
        val h = code(host)
        val prepare = body(h, "fun prepare(json: String)")
        assertTrue(prepare.contains("NativeFirstMessage.parse(json)?.let { FaceVideoBox.onV4(this, it); return }"))
        val state = body(h, "fun stateJson()")
        assertTrue("every poll renews the lease", state.indexOf("FaceVideoBox.onStatePoll(this)") in 0 until state.indexOf("val j ="))
        assertTrue(state.contains("FaceVideoBox.writeNativeFirst(this, j, max, policy)"))
        assertTrue(state.contains("return ReplyBudget.fit(j.put(\"protocol\",2)).toString()"))
        val bridge = code(read("src/main/java/com/educms/player/WebAppBridge.kt"))
        assertFalse("no new bridge method (rule 9)", Regex("fun (sharedVideoIntend|sharedVideoRelease|nativeFirst|sharedVideoLease)").containsMatchIn(bridge))
        assertEquals("the four methods, and only those", 4, Regex("fun sharedVideo(Prepare|Commit|Stop|State)\\(nonce").findAll(bridge).count())
    }

    @Test
    fun `the watchdog still leaves a foreground player alone every fifteen minutes`() {
        val w = code(read("src/main/java/com/educms/player/watchdog/Watchdog.kt"))
        val guard = w.indexOf("if (MainActivity.isInForeground)")
        val launch = w.indexOf("ctx.startActivity(launch)")
        assertTrue(guard >= 0 && launch > guard)
    }
}
