package com.educms.player.face

import android.app.Activity
import android.app.Presentation
import android.os.Bundle
import android.view.Display
import android.view.ViewGroup
import android.view.WindowManager
import com.educms.player.R
import com.educms.player.logging.PlayerLogger

/**
 * The window that puts a [FacePlayerHost] on a SECONDARY display
 * (2026-09-16, double-sided displays).
 *
 * Before this class the APK contained NO `android.app.Presentation` subclass
 * at all — its only `DisplayManager` use was the read-only capability probe.
 * That is why the Goodview DH43 shows side A on both panels today: with
 * nothing presenting on display 1, Android OS-mirrors the built-in screen
 * onto HDMI, and the server's opinion about what side B should play never
 * reaches any glass.
 *
 * ═════════════════════════════════════════════════════════════════════
 * ⚠️ WHY THE ACTIVITY IS THE OUTER CONTEXT, NOT THE APPLICATION
 * ═════════════════════════════════════════════════════════════════════
 * A `Presentation` built from the application context is a system-level
 * window and needs `SYSTEM_ALERT_WINDOW`, which this APK does not hold and
 * which an OEM signage ROM may not grant at all. Built from the Activity it
 * is an ordinary application window and needs nothing.
 *
 * The cost is stated honestly: every face's window is then tied to the
 * Activity's lifecycle, so an OEM ROM that reaps the Activity without
 * `onDestroy` takes both faces with it. That is the same weak-reference
 * hazard `DisplayWindowBridge` already guards against, and it is a hardware
 * behaviour nobody can prove without the DH43 in hand.
 *
 * ═════════════════════════════════════════════════════════════════════
 * ⚠️ CRASH ISOLATION (contract §3)
 * ═════════════════════════════════════════════════════════════════════
 * Every override here is wrapped. A throw inside a face is logged and
 * reported as THAT face's own honest state; it never propagates into the
 * Activity, never touches `DisplayEmergency`, and never reaches the other
 * host. A wedged side B must not be able to delay, suppress or queue side
 * A's lockdown.
 *
 * ⚠️ `setCancelable(false)` and the dismiss listener together are what stop a
 * face from disappearing silently: an OEM that tears the window down
 * re-enters [FaceHostController.sync] and the face is re-hosted rather than
 * quietly lost. "The window is gone" must never render as "the screen is
 * fine".
 *
 * ⚠️ NOT PROVEN ON HARDWARE. That `FLAG_PRESENTATION` is honoured after a
 * reboot on this ROM, that display-id ORDERING survives a power cycle, and
 * that the OEM does not re-assert its own mirror over this window are all
 * hardware facts. See `apps/player/HARDWARE-QUALIFICATION.md`.
 */
class FacePresentation(
    activity: Activity,
    display: Display,
    private val host: FacePlayerHost,
    /** Re-enter the controller when this window goes away for any reason. */
    private val onDismissed: () -> Unit,
) : Presentation(activity, display) {

    private companion object {
        const val TAG = "FacePresentation"
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        runCatching {
            setContentView(R.layout.face_presentation)
            // A signage face must never sleep behind the OS timeout.
            window?.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            // There is no operator standing at the back of a wall-mounted
            // panel to dismiss a dialog, and a dismissed face is a black
            // piece of glass.
            setCancelable(false)
            setOnDismissListener {
                PlayerLogger.w(
                    TAG,
                    "face ${host.faceIndex} presentation was dismissed — re-syncing so it is " +
                        "re-hosted rather than silently lost",
                )
                runCatching { onDismissed() }
            }
            val root = findViewById<ViewGroup>(R.id.faceRoot)
            if (root == null) {
                PlayerLogger.e(TAG, "face ${host.faceIndex} has no faceRoot — cannot host")
                return@runCatching
            }
            host.configure(root)
            host.load("presentation created")
        }.onFailure {
            // Never rethrow: this runs inside the Activity's own call stack.
            PlayerLogger.e(TAG, "face ${host.faceIndex} onCreate FAILED — this face stays dark", it)
        }
    }
}
