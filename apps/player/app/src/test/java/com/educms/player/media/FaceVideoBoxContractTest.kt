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
    fun `a positioned-slot request is refused by the class table before any work, with its stable reason`() {
        val b = code(box)
        val begin = body(b, "private fun begin(")
        val refusal = begin.indexOf("session.refusal?.let { stopSession(host, session, it); return null }")
        assertTrue("the refusal is applied", refusal >= 0)
        assertTrue("…before the emergency / lifecycle checks", refusal < begin.indexOf("DisplayEmergency.isHeld(host.ctx)"))
        assertTrue("…and before the authenticated fetch", refusal < begin.indexOf("meta.execute"))
        assertTrue("the session is registered first so the page reads the reason", refusal > begin.indexOf("host.faceSessions[session.slot] = session"))
        assertTrue("sessions are built from the resolved class", b.contains("DeviceClassPolicy.current(host.ctx)"))
        assertTrue("the advertised protocolMax is the class table's", body(b, "fun state(host: SharedVideoHost)").contains("DeviceClassPolicy.current(host.ctx).protocolMax"))
        assertTrue("the host reply carries the resolved class", body(code(host), "fun stateJson()").contains("policy.toJson()"))
        assertTrue("a refused session never uploads diagnostics", body(b, "private fun queueDiagnostics(").contains("s.refusal != null"))
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
    fun `the watchdog still leaves a foreground player alone every fifteen minutes`() {
        val w = code(read("src/main/java/com/educms/player/watchdog/Watchdog.kt"))
        val guard = w.indexOf("if (MainActivity.isInForeground)")
        val launch = w.indexOf("ctx.startActivity(launch)")
        assertTrue(guard >= 0 && launch > guard)
    }
}
