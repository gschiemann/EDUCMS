package com.educms.player

import android.content.Context
import android.view.ViewGroup
import android.webkit.WebView
import com.educms.player.logging.PlayerLogger
import com.educms.player.security.NativeBridgeChannel

/** Owns only one WebView slot. Never recreates the Activity or changes native holds. */
class RendererRecovery(context: Context, private val slot: String) {
    private val prefs = context.getSharedPreferences("renderer_recovery", Context.MODE_PRIVATE)
    private val policy = RendererRecoveryPolicy(
        prefs.getInt("$slot.failures", 0), prefs.getLong("$slot.at", 0),
    )

    fun safeUntil(): Long = policy.lastFailureAt + RendererRecoveryPolicy.SAFE_MODE_MS

    fun recentlyFailed(): Boolean = policy.recentlyFailed(System.currentTimeMillis())

    /** Must run synchronously inside onRenderProcessGone, on the UI thread. */
    fun replace(failed: WebView, didCrash: Boolean): Pair<WebView, Long> {
        val parent = checkNotNull(failed.parent as? ViewGroup) { "Renderer slot detached" }
        val index = parent.indexOfChild(failed)
        val id = failed.id
        val layout = failed.layoutParams
        val visibility = failed.visibility
        val delay = policy.onFailure(System.currentTimeMillis())
        // Bounded state survives both renderer and host-process termination.
        prefs.edit().putInt("$slot.failures", policy.failures)
            .putLong("$slot.at", policy.lastFailureAt).commit()
        PlayerLogger.e("RendererRecovery", "PLAYER_RENDERER_TERMINATED slot=$slot didCrash=$didCrash failures=${policy.failures} retryMs=$delay")
        runCatching { NativeBridgeChannel.detach(failed) }
        parent.removeView(failed)
        // Do not stopLoading, load about:blank, or query a dead renderer.
        runCatching { failed.destroy() }
        val fresh = WebView(parent.context).apply {
            this.id = id
            layoutParams = layout
            this.visibility = visibility
        }
        parent.addView(fresh, index, layout)
        return fresh to delay
    }
}
