package com.schoolcms.security

import android.util.Log
import java.security.MessageDigest
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec
import org.json.JSONObject

object PayloadVerifier {
    private const val TAG = "PayloadVerifier"
    private const val HMAC_ALGO = "HmacSHA256"
    private const val MAX_TIME_DRIFT_MS = 10000L 

    private val processedEventIds = LinkedHashMap<String, Long>(100, 0.75f, true)

    fun verify(rawJson: String, deviceSecret: String): Boolean {
        try {
            val json = JSONObject(rawJson)
            val eventId = json.getString("eventId")
            val timestamp = json.getLong("timestamp")
            val type = json.getString("type")
            val payload = json.getJSONObject("payload").toString()
            val receivedSignature = json.getString("signature")

            if (processedEventIds.containsKey(eventId)) return false
            if (System.currentTimeMillis() - timestamp > MAX_TIME_DRIFT_MS) return false

            val canonicalString = "$eventId:$timestamp:$type:$payload"
            val mac = Mac.getInstance(HMAC_ALGO)
            val secretKeySpec = SecretKeySpec(deviceSecret.toByteArray(Charsets.UTF_8), HMAC_ALGO)
            mac.init(secretKeySpec)
            
            val computedHashBytes = mac.doFinal(canonicalString.toByteArray(Charsets.UTF_8))
            val computedHashStr = computedHashBytes.joinToString("") { "%02x".format(it) }

            if (!MessageDigest.isEqual(computedHashStr.toByteArray(), receivedSignature.toByteArray())) return false

            if (processedEventIds.size >= 100) {
                processedEventIds.remove(processedEventIds.keys.iterator().next())
            }
            processedEventIds[eventId] = timestamp

            return true
        } catch (e: Exception) {
            return false
        }
    }
}
