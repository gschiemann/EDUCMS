package com.schoolcms.network

import android.util.Log
import com.schoolcms.security.PayloadVerifier

class EmergencySocketClient(private val deviceSecret: String) {
    private const val TAG = "EmergencySocketClient"

    fun onWebSocketMessageReceived(jsonPayload: String) {
        val isValid = PayloadVerifier.verify(jsonPayload, deviceSecret)
        if (isValid) {
            Log.i(TAG, "Payload Valid. Triggering.")
        } else {
            Log.e(TAG, "Payload verification failed.")
        }
    }

    fun connect() {
        Log.i(TAG, "Connecting socket...")
    }
}
