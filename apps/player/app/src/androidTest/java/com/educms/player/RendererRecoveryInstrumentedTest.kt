package com.educms.player

import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.atomic.AtomicBoolean

@androidx.test.filters.SdkSuppress(minSdkVersion = 26)
@RunWith(AndroidJUnit4::class)
class RendererRecoveryInstrumentedTest {
    private fun await(scenario: ActivityScenario<RendererRecoveryTestActivity>, predicate: (RendererRecoveryTestActivity) -> Boolean) {
        val deadline = System.currentTimeMillis() + 30_000
        val ready = AtomicBoolean(false)
        while (!ready.get() && System.currentTimeMillis() < deadline) {
            scenario.onActivity { ready.set(predicate(it)) }
            Thread.sleep(100)
        }
        assertTrue("renderer recovery timed out", ready.get())
    }
    @Test fun sharedRendererDeathReplacesEveryAffectedViewAndResumesRendering() {
        ActivityScenario.launch(RendererRecoveryTestActivity::class.java).use { scenario ->
            await(scenario) { it.successfulLoads >= 2 }
            var old: android.webkit.WebView? = null
            scenario.onActivity {
                old = it.views[0]
                it.views[0].loadUrl("chrome://crash") // Android's documented renderer-death test.
            }
            await(scenario) { it.deaths >= 1 && it.successfulLoads >= 2 + it.deaths }
            scenario.onActivity {
                assertNotSame(old, it.views[0])
                assertNull(old?.parent)
                assertFalse(it.isFinishing)
                assertFalse(it.isDestroyed)
                it.views.forEach { view -> assertNotNull(view.parent) }
            }
        }
    }
}
