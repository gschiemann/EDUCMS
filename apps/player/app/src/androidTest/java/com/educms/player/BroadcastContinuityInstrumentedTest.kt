package com.educms.player

import android.graphics.Bitmap
import android.media.MediaPlayer
import android.view.View
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.educms.player.display.DisplayEmergency
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

@RunWith(AndroidJUnit4::class)
class BroadcastContinuityInstrumentedTest {
    private fun await(scenario: ActivityScenario<BroadcastContinuityTestActivity>, predicate: (BroadcastContinuityTestActivity) -> Boolean) {
        val deadline = System.currentTimeMillis() + 30_000
        val ready = AtomicBoolean(false)
        while (!ready.get() && System.currentTimeMillis() < deadline) {
            scenario.onActivity { ready.set(predicate(it)) }
            if (!ready.get()) Thread.sleep(100)
        }
        assertTrue("native broadcast continuity timed out", ready.get())
    }

    private fun document(scenario: ActivityScenario<BroadcastContinuityTestActivity>): JSONObject {
        val done = CountDownLatch(1)
        var result = "{}"
        scenario.onActivity {
            it.site.evaluateJavascript("JSON.stringify({id:sessionId,ticks:ticks,width:innerWidth,startWidth:startWidth})") { raw ->
                result = org.json.JSONTokener(raw).nextValue() as String
                done.countDown()
            }
        }
        assertTrue("WebView document read timed out", done.await(5, TimeUnit.SECONDS))
        return JSONObject(result)
    }

    private fun capture(name: String) {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val screenshot = instrumentation.uiAutomation.takeScreenshot()
        File(instrumentation.targetContext.cacheDir, name).outputStream().use { screenshot.compress(Bitmap.CompressFormat.PNG, 100, it) }
        screenshot.recycle()
    }

    @Test fun websiteKeepsItsDocumentViewportAndClockWhileNativeLayerResizes() {
        ActivityScenario.launch(BroadcastContinuityTestActivity::class.java).use { scenario ->
            await(scenario) { it.loads == 1 && it.site.width > 0 }
            val before = document(scenario)
            scenario.onActivity { it.broadcast(true) }
            await(scenario) { it.site.scaleY < 1f && it.site.translationY > 0f }
            scenario.onActivity {
                assertTrue(DisplayEmergency.isHeld(it))
                assertFalse("a text banner must retain playback", DisplayEmergency.isPlaybackHeld(it))
                assertEquals(View.VISIBLE, it.site.visibility)
                assertTrue(it.site.translationY >= it.root.height * 0.15f)
                assertEquals(0.84f, it.site.scaleY, 0.001f)
                assertTrue(com.educms.player.media.BroadcastContentViews.emergencyOutputClear(0))
            }
            Thread.sleep(500)
            capture("native-website-banner.png")
            val during = document(scenario)
            assertEquals(before.getString("id"), during.getString("id"))
            assertEquals(before.getInt("width"), during.getInt("width"))
            assertTrue(during.getInt("ticks") > before.getInt("ticks"))
            scenario.onActivity { it.broadcast(true, rotation = 90) }
            scenario.onActivity {
                assertEquals(0f, it.site.translationX, 0.1f)
                assertEquals(it.root.height * 0.08f, it.site.translationY, 1f)
                // A full emergency immediately masks the existing site and
                // cannot be downgraded by another banner geometry message.
                it.takeover(true)
                assertTrue(DisplayEmergency.isPlaybackHeld(it))
                assertEquals(View.INVISIBLE, it.site.visibility)
                assertTrue(com.educms.player.media.BroadcastContentViews.emergencyOutputClear(0))
                it.broadcast(true)
                assertTrue(DisplayEmergency.isPlaybackHeld(it))
                assertEquals(View.INVISIBLE, it.site.visibility)
                it.broadcast(false)
            }
            await(scenario) { it.site.scaleY == 1f && it.site.visibility == View.VISIBLE }
            val after = document(scenario)
            assertEquals(before.getString("id"), after.getString("id"))
            assertEquals(before.getInt("width"), after.getInt("width"))
            assertEquals(after.getInt("startWidth"), after.getInt("width"))
            assertTrue(after.getInt("ticks") >= during.getInt("ticks"))
            scenario.onActivity { assertEquals(1, it.loads) }
        }
    }

    @Test fun nativeSurfaceResizeKeepsTheSamePlayingSessionWithoutSeekOrPrepare() {
        ActivityScenario.launch(BroadcastContinuityTestActivity::class.java).use { scenario ->
            await(scenario) { it.root.width > 0 }
            scenario.onActivity { it.video() }
            await(scenario) { it.error != null || (it.prepares == 1 && it.player?.isPlaying == true && it.player!!.currentPosition > 1000) }
            var samePlayer: MediaPlayer? = null
            var before = 0
            scenario.onActivity {
                assertNull(it.error)
                samePlayer = it.player
                before = it.player!!.currentPosition
                it.broadcast(true)
            }
            await(scenario) { it.box.top >= it.root.height * 0.15 && it.player!!.currentPosition > before + 700 }
            scenario.onActivity {
                assertSame(samePlayer, it.player)
                assertTrue(it.player!!.isPlaying)
                assertEquals(1, it.surfaceCreations)
                assertEquals(0, it.surfaceDestructions)
                assertEquals(1, it.prepares)
                assertEquals(0, it.seeks)
            }
            capture("native-video-banner.png")
            var during = 0
            scenario.onActivity { during = it.player!!.currentPosition; it.broadcast(false) }
            await(scenario) { it.box.top == 0 && it.box.height == it.root.height && it.player!!.currentPosition > during + 700 }
            scenario.onActivity {
                assertSame(samePlayer, it.player)
                assertTrue(it.player!!.isPlaying)
                assertEquals(1, it.surfaceCreations)
                assertEquals(0, it.surfaceDestructions)
                assertEquals(1, it.prepares)
                assertEquals(0, it.seeks)
                assertNull(it.error)
            }
        }
    }
}
