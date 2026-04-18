package com.educms.player

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import android.os.Build
import android.util.Log

class PlayerApp : Application() {
    override fun onCreate() {
        super.onCreate()
        Log.i("PlayerApp", "EduCMS Player ${BuildConfig.VERSION_NAME} starting (SDK ${Build.VERSION.SDK_INT})")
        ensureHeartbeatChannel()
    }

    private fun ensureHeartbeatChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val nm = getSystemService(NotificationManager::class.java)
            val channel = NotificationChannel(
                CHANNEL_HEARTBEAT,
                "Player heartbeat",
                NotificationManager.IMPORTANCE_MIN
            ).apply {
                description = "Keeps the EduCMS player connected to the server."
                setShowBadge(false)
            }
            nm.createNotificationChannel(channel)
        }
    }

    companion object {
        const val CHANNEL_HEARTBEAT = "edu_cms_player_heartbeat"
    }
}
