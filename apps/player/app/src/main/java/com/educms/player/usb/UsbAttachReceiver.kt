package com.educms.player.usb

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.hardware.usb.UsbManager
import android.util.Log

/**
 * Fires when a USB mass-storage device is attached. We don't try to read
 * the raw block device ourselves (that's a permission nightmare on
 * vanilla Android); instead we hand off to the OS file picker via
 * UsbIngestActivity which lets the operator point us at the
 * `edu-cms-content/` folder on the stick. This works on Android 7-14
 * without root and without the SAF mount permission dance for every
 * arbitrary stick.
 */
class UsbAttachReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        // ⚠️ AND-007 (2026-08-01) — this receiver is EXPORTED (the system
        // has to be able to deliver USB_DEVICE_ATTACHED to it), so any app
        // on the device could broadcast to it with any action and make the
        // kiosk pop a full-screen SAF file browser over whatever is
        // playing — including an active lockdown alert. Act only on the
        // real system broadcast; ignore everything else.
        if (intent.action != UsbManager.ACTION_USB_DEVICE_ATTACHED) {
            Log.w("UsbAttachReceiver", "ignoring unexpected broadcast action: ${intent.action}")
            return
        }
        Log.i("UsbAttachReceiver", "USB device attached: ${intent.action}")
        // Forward to the foreground player so it can show the operator
        // confirmation prompt without us trying to launch a full activity
        // from a background receiver (which Android 10+ restricts).
        val launch = Intent(context, UsbIngestActivity::class.java).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP)
        }
        runCatching { context.startActivity(launch) }
            .onFailure { Log.w("UsbAttachReceiver", "couldn't start UsbIngestActivity", it) }
    }
}
