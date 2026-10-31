package com.educms.player

import android.annotation.SuppressLint
import android.app.Activity
import android.graphics.Color
import android.media.MediaPlayer
import android.os.Bundle
import android.view.SurfaceHolder
import android.view.SurfaceView
import android.view.View
import android.view.ViewGroup
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.TextView
import com.educms.player.display.DisplayEmergency
import com.educms.player.media.BroadcastBanner
import com.educms.player.media.BroadcastContentViews
import com.educms.player.media.BroadcastVideoLayout

/** Offline, debug-only fixture for real WebView and SurfaceView continuity.
 * MediaPlayer permits the emulator's software codec; production's hardware
 * decoder requirements are unchanged. No API, credential or pairing path. */
class BroadcastContinuityTestActivity : Activity() {
    lateinit var root: FrameLayout
    lateinit var site: WebView
    lateinit var box: FrameLayout
    lateinit var surface: SurfaceView
    lateinit var banner: TextView
    var player: MediaPlayer? = null
    var loads = 0
    var prepares = 0
    var seeks = 0
    var surfaceCreations = 0
    var surfaceDestructions = 0
    var error: String? = null
    private var wantsSite = true

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(state: Bundle?) {
        super.onCreate(state)
        DisplayEmergency.setHold(this, 0, false)
        BroadcastBanner.clear(0)
        root = FrameLayout(this).apply { setBackgroundColor(Color.BLACK) }
        setContentView(root)
        // Beneath native output, as the real browser-rendered banner is.
        banner = TextView(this).apply {
            text = "Broadcast • Content keeps playing"
            textSize = 18f
            setTextColor(Color.WHITE)
            setBackgroundColor(Color.rgb(180, 83, 9))
            gravity = android.view.Gravity.CENTER
            visibility = View.GONE
        }
        root.addView(banner, FrameLayout.LayoutParams(-1, 100))
        site = WebView(this).apply {
            settings.javaScriptEnabled = true
            webViewClient = object : WebViewClient() {
                override fun onPageFinished(view: WebView, url: String) { loads++ }
            }
        }
        root.addView(site, FrameLayout.LayoutParams(-1, -1))
        BroadcastContentViews.register(0, site) { wantsSite }
        site.loadDataWithBaseURL("https://fixture.invalid/", """
            <html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head>
            <body style="margin:0;background:#e0f2fe;color:#0c4a6e;font:24px sans-serif;display:grid;place-items:center;height:100vh">
            <div>Website session <span id="ticks"></span></div><script>
            window.sessionId=Math.random().toString(36);window.ticks=0;window.startWidth=innerWidth;
            setInterval(function(){document.getElementById('ticks').textContent=++window.ticks},50);
            </script></body></html>
        """.trimIndent(), "text/html", "UTF-8", null)
    }

    fun video() {
        wantsSite = false
        site.visibility = View.GONE
        box = FrameLayout(this).apply { setBackgroundColor(Color.BLACK) }
        surface = SurfaceView(this).apply { setZOrderOnTop(true) }
        box.addView(surface, FrameLayout.LayoutParams(-1, -1))
        root.addView(box, FrameLayout.LayoutParams(-1, -1))
        surface.holder.addCallback(object : SurfaceHolder.Callback {
            override fun surfaceCreated(holder: SurfaceHolder) {
                surfaceCreations++
                val media = MediaPlayer()
                player = media
                media.setDisplay(holder)
                media.setOnPreparedListener { prepares++; it.start() }
                media.setOnSeekCompleteListener { seeks++ }
                media.setOnErrorListener { _, what, extra -> error = "$what/$extra"; true }
                assets.openFd("broadcast-continuity.mp4").use { media.setDataSource(it.fileDescriptor, it.startOffset, it.length) }
                media.prepareAsync()
            }
            override fun surfaceChanged(holder: SurfaceHolder, format: Int, width: Int, height: Int) = Unit
            override fun surfaceDestroyed(holder: SurfaceHolder) { surfaceDestructions++ }
        })
    }

    fun broadcast(active: Boolean, rotation: Int = 0) {
        if (active) {
            check(BroadcastBanner.set(0, true, 0.16, DisplayEmergency.holdingFaces(this), rotation))
            check(DisplayEmergency.setHold(this, 0, true, bannerOnly = true))
        } else {
            check(DisplayEmergency.setHold(this, 0, false))
            BroadcastBanner.clear(0)
        }
        // The fixture, rather than MainActivity, owns the foreground window.
        // Settle the normal wake check so it cannot launch the real player
        // (and its pairing/network flows) over this isolated test surface.
        com.educms.player.wake.WakeRecovery.onActivityResumed(this)
        banner.visibility = if (active) View.VISIBLE else View.GONE
        banner.layoutParams = FrameLayout.LayoutParams(-1, (root.height * 0.16).toInt())
        BroadcastContentViews.refresh()
        if (::surface.isInitialized) {
            val rect = BroadcastBanner.rect(root.width, root.height, if (active) 0.16 else 0.0, rotation)
            BroadcastVideoLayout.apply(box, surface, "contain", 160, 90, 0, rect)
        }
    }

    fun takeover(active: Boolean) {
        check(DisplayEmergency.setHold(this, 0, active))
        com.educms.player.wake.WakeRecovery.onActivityResumed(this)
        BroadcastContentViews.refresh()
    }

    override fun onDestroy() {
        BroadcastContentViews.unregister(0, site)
        DisplayEmergency.setHold(this, 0, false)
        BroadcastBanner.clear(0)
        player?.release()
        player = null
        (site.parent as? ViewGroup)?.removeView(site)
        site.destroy()
        super.onDestroy()
    }
}
