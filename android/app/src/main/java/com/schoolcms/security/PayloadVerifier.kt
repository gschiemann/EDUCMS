package com.schoolcms.security

import android.util.Log
import java.security.MessageDigest
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec
import org.json.JSONObject

/**
 * PayloadVerifier handles the Android-side enforcement of the WSSP protocol
 * to prevent Replay Attacks and Event Forgery (Release Blocker RT-01).
 */
object PayloadVerifier {

    private const val TAG = "PayloadVerifier"
    private const val HMAC_ALGO = "HmacSHA256"
    private const val MAX_TIME_DRIFT_MS = 10000L // 10 seconds

    // In-memory cache of the last 100 processed event IDs to prevent immediate replay
    private val processedEventIds = LinkedHashMap<String, Long>(100, 0.75f, true)

    /**
     * Verifies the authenticity, freshness, and idempotency of an incoming WebSocket message.
     * @param rawJson The raw JSON string received from the socket.
     * @param deviceSecret The secret key provisioned securely in Android Hardware Keystore.
     * @return true if valid and trustworthy, false otherwise.
     */
    fun verify(rawJson: String, deviceSecret: String): Boolean {
        try {
            val json = JSONObject(rawJson)
            val eventId = json.getString("eventId")
            val timestamp = json.getLong("timestamp")
            val type = json.getString("type")
            val payload = json.getJSONObject("payload").toString()
            val receivedSignature = json.getString("signature")

            // 1. Idempotency Check
            if (processedEventIds.containsKey(eventId)) {
                Log.w(TAG, "Security Alert: Duplicate eventId detected (Replay Attack). Dropping.")
                return false
            }

            // 2. Freshness Check
            val now = System.currentTimeMillis()
            if (now - timestamp > MAX_TIME_DRIFT_MS) {
                Log.w(TAG, "Security Alert: Stale event timestamp (Replay/Drift). Dropping.")
                return false
            }

            // 3. Signature Verification
            val canonicalString = "$eventId:$timestamp:$type:$payload"
            val mac = Mac.getInstance(HMAC_ALGO)
            val secretKeySpec = SecretKeySpec(deviceSecret.toByteArray(Charsets.UTF_8), HMAC_ALGO)
            mac.init(secretKeySpec)
            
            val computedHashBytes = mac.doFinal(canonicalString.toByteArray(Charsets.UTF_8))
            val computedHashStr = computedHashBytes.joinToString("") { "%02x".format(it) }

            if (!MessageDigest.isEqual(computedHashStr.toByteArray(), receivedSignature.toByteArray())) {
                Log.e(TAG, "Security Alert: HMAC verification failed (Forgery Attempt).")
                return false
            }

            // Valid payload. Register eventId to prevent replay.
            if (processedEventIds.size >= 100) {
                val oldestKey = processedEventIds.keys.iterator().next()
                processedEventIds.remove(oldestKey)
            }
            processedEventIds[eventId] = timestamp

            return true
        } catch (e: Exception) {
            Log.e(TAG, "Malformed WebSocket Payload", e)
            return false
        }
    }
}
