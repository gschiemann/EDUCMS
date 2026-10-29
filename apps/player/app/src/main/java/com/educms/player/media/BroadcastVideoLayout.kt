package com.educms.player.media

import android.view.SurfaceView
import android.view.View
import android.widget.FrameLayout

/** Move the existing output only. Never detach its surface or touch the decoder. */
internal object BroadcastVideoLayout {
    fun apply(box: View, surface: SurfaceView, fit: String, videoW: Int, videoH: Int, degrees: Int, rect: IntArray) {
        box.layoutParams = FrameLayout.LayoutParams(rect[2], rect[3]).apply { leftMargin = rect[0]; topMargin = rect[1] }
        val frame = FaceVideoPolicy.frame(fit, videoW, videoH, degrees, rect[2], rect[3])
        surface.layoutParams = FrameLayout.LayoutParams(frame[2], frame[3]).apply { leftMargin = frame[0]; topMargin = frame[1] }
    }
}
