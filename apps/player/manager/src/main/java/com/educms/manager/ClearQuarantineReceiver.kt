package com.educms.manager

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import com.educms.manager.rollback.QuarantineList

/**
 * Manager wave 3 (#8) - the dashboard's "Clear quarantine" for ONE screen.
 *
 * The Player relays the signed CLEAR_UPDATE_QUARANTINE command with a
 * signature-protected broadcast ([ACTION], HEALTH_PERMISSION), and this forgets
 * every versionCode [QuarantineList] had set aside after a failed first boot.
 *
 * What it does NOT do, and the dashboard says so: it does not restore an older
 * build. Without device owner Android refuses to downgrade a release-signed
 * package, so a quarantine here only ever stops the Manager's bootstrap lane
 * from re-offering a build that failed - clearing it lets that build be offered
 * again, nothing more.
 */
class ClearQuarantineReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        try {
            QuarantineList.clear(context)
            Log.i(TAG, "quarantine cleared on the dashboard's request")
        } catch (e: Exception) {
            Log.w(TAG, "clear quarantine failed: ${e.message}", e)
        }
    }

    companion object {
        private const val TAG = "ClearQuarantineReceiver"
        const val ACTION = "com.educms.manager.CLEAR_QUARANTINE"
    }
}
