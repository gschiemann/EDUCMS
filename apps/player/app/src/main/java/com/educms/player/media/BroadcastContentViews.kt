package com.educms.player.media

import android.os.Looper
import android.view.View
import com.educms.player.display.DisplayEmergency
import java.lang.ref.WeakReference

/** Native website layers follow the same canvas transform as video and the
 * page. Transform the existing view, preserving its document and viewport. */
internal object BroadcastContentViews {
    private class Entry(val face: Int, view: View, val desired: () -> Boolean) {
        val view = WeakReference(view)
        var masked = false
        var listener: View.OnLayoutChangeListener? = null
    }
    private val entries = mutableMapOf<Int, Entry>()

    fun register(face: Int, view: View, desired: () -> Boolean) {
        val entry = Entry(face, view, desired)
        val previous = synchronized(entries) { entries.put(face, entry) }
        previous?.view?.get()?.let { old -> previous.listener?.let(old::removeOnLayoutChangeListener) }
        entry.listener = View.OnLayoutChangeListener { _, _, _, _, _, _, _, _, _ -> apply(entry) }
        view.addOnLayoutChangeListener(entry.listener)
        apply(entry)
    }

    fun unregister(face: Int, view: View) {
        val entry = synchronized(entries) {
            entries[face]?.takeIf { it.view.get() === view }?.also { entries.remove(face) }
        } ?: return
        entry.listener?.let(view::removeOnLayoutChangeListener)
    }

    /** Never waits on UI work from the emergency bridge thread. */
    fun refresh() {
        synchronized(entries) { entries.values.toList() }.forEach { entry ->
            val view = entry.view.get() ?: return@forEach
            if (Looper.myLooper() == Looper.getMainLooper()) apply(entry) else view.post { apply(entry) }
        }
    }

    /** UI thread: the paint receipt must also prove a native website cannot
     * cover the banner. A full takeover requires that website to be hidden. */
    fun emergencyOutputClear(face: Int): Boolean {
        val entry = synchronized(entries) { entries[face] } ?: return true
        val view = entry.view.get() ?: return true
        if (!view.isShown || view.alpha <= 0f) return true
        if (DisplayEmergency.isPlaybackHeld(view.context) || !BroadcastBanner.active(face)) return false
        val parent = view.parent as? View ?: return false
        val bounds = BroadcastBanner.rect(parent.width, parent.height, BroadcastBanner.inset(face), BroadcastBanner.rotation(face))
        return view.width > 0 && view.height > 0 && view.scaleX > 0 && view.scaleY > 0 &&
            view.x >= bounds[0] - 1 && view.y >= bounds[1] - 1 &&
            view.x + view.width * view.scaleX <= bounds[0] + bounds[2] + 1 &&
            view.y + view.height * view.scaleY <= bounds[1] + bounds[3] + 1
    }

    private fun apply(entry: Entry) {
        val view = entry.view.get() ?: return
        if (synchronized(entries) { entries[entry.face] !== entry }) return
        if (DisplayEmergency.isPlaybackHeld(view.context)) {
            // Full takeovers must cover a native site even before its page
            // processes the alert. Keep the document available underneath.
            if (view.visibility == View.VISIBLE) { entry.masked = true; view.visibility = View.INVISIBLE }
            return
        }
        if (entry.masked) { view.visibility = if (entry.desired()) View.VISIBLE else View.GONE; entry.masked = false }
        val parent = view.parent as? View ?: return
        val inset = if (BroadcastBanner.active(entry.face)) BroadcastBanner.inset(entry.face) else 0.0
        val bounds = BroadcastBanner.rect(parent.width, parent.height, inset, BroadcastBanner.rotation(entry.face))
        val scale = (1.0 - inset).toFloat()
        view.pivotX = 0f; view.pivotY = 0f
        view.scaleX = scale; view.scaleY = scale
        view.translationX = bounds[0] - view.left * (1f - scale)
        view.translationY = bounds[1] - view.top * (1f - scale)
    }
}
