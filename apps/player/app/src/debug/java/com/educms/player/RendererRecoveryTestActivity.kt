package com.educms.player

import android.app.Activity
import android.os.Bundle
import android.view.ViewGroup
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.LinearLayout

/** Debug-only fixture. Never packaged into the production APK. */
@androidx.annotation.RequiresApi(android.os.Build.VERSION_CODES.O)
class RendererRecoveryTestActivity : Activity() {
    val views = mutableListOf<WebView>()
    var deaths = 0
    var successfulLoads = 0
    private lateinit var root: LinearLayout
    override fun onCreate(state: Bundle?) {
        super.onCreate(state)
        root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        setContentView(root)
        repeat(2) { slot ->
            val view = WebView(this)
            views.add(view)
            root.addView(view, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 300))
            configure(view, slot)
            load(view)
        }
    }
    private fun configure(view: WebView, slot: Int) {
        val recovery = RendererRecovery(this, "test-$slot")
        view.webViewClient = object : WebViewClient() {
            override fun onPageFinished(v: WebView, url: String) { successfulLoads += 1 }
            override fun onRenderProcessGone(failed: WebView, detail: RenderProcessGoneDetail): Boolean {
                val (fresh, delay) = recovery.replace(failed, detail.didCrash())
                views[slot] = fresh
                configure(fresh, slot)
                deaths += 1
                fresh.postDelayed({ if (!isDestroyed && views[slot] === fresh) load(fresh) }, delay)
                return true
            }
        }
    }
    private fun load(view: WebView) = view.loadDataWithBaseURL("https://fixture.invalid/", "<html><body>Recovered renderer</body></html>", "text/html", "UTF-8", null)
    override fun onDestroy() {
        views.forEach { root.removeView(it); it.destroy() }
        super.onDestroy()
    }
}
