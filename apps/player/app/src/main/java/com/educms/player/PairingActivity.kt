package com.educms.player

import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.util.Log
import android.view.View
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.lifecycle.lifecycleScope
import com.educms.player.databinding.ActivityPairingBinding
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/**
 * First-run pairing screen. The admin generates a pairing code on the dashboard,
 * the kiosk operator types it here, and we exchange it for a long-lived device token.
 *
 * Server endpoint expected:
 *   POST {PLAYER_BASE_URL_ROOT}/api/v1/devices/pair
 *     body: { code: "ABC123", deviceFingerprint: "...", model: "...", os: "Android 14" }
 *     200:  { token: "jwt", screenId: "...", tenantSlug: "..." }
 */
class PairingActivity : ComponentActivity() {

    private lateinit var binding: ActivityPairingBinding
    private val deviceStore by lazy { DeviceStore(applicationContext) }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityPairingBinding.inflate(layoutInflater)
        setContentView(binding.root)

        binding.versionLabel.text = getString(R.string.pairing_version, BuildConfig.VERSION_NAME)
        binding.pairButton.setOnClickListener { onPairClicked() }

        // If we already have a token, skip straight to the player.
        lifecycleScope.launch {
            kotlinx.coroutines.flow.combine(
                deviceStore.deviceToken, deviceStore.screenId
            ) { t, _ -> t }
            .collect { token ->
                if (!token.isNullOrBlank()) {
                    startActivity(Intent(this@PairingActivity, MainActivity::class.java))
                    finish()
                }
            }
        }
    }

    private fun onPairClicked() {
        val code = binding.codeInput.text?.toString()?.trim()?.uppercase().orEmpty()
        if (code.length < 4) {
            Toast.makeText(this, R.string.pairing_invalid_code, Toast.LENGTH_SHORT).show()
            return
        }
        binding.pairButton.isEnabled = false
        binding.progress.visibility = View.VISIBLE

        lifecycleScope.launch {
            val result = runCatching { exchangeCode(code) }
            binding.progress.visibility = View.GONE
            binding.pairButton.isEnabled = true

            result.onSuccess { resp ->
                deviceStore.savePairing(resp.token, resp.tenantSlug, resp.screenId)
                startActivity(Intent(this@PairingActivity, MainActivity::class.java))
                finish()
            }.onFailure { err ->
                Log.w("Pairing", "exchange failed", err)
                Toast.makeText(this@PairingActivity, getString(R.string.pairing_error, err.message ?: "?"), Toast.LENGTH_LONG).show()
            }
        }
    }

    private suspend fun exchangeCode(code: String): PairResponse = withContext(Dispatchers.IO) {
        // Derive API root from PLAYER_BASE_URL: trim "/player" suffix → use scheme+host.
        val playerUri = android.net.Uri.parse(BuildConfig.PLAYER_BASE_URL)
        val apiRoot = "${playerUri.scheme}://${playerUri.host}" + (if (playerUri.port > 0) ":${playerUri.port}" else "")
        val endpoint = "$apiRoot/api/v1/devices/pair"

        val body = JSONObject().apply {
            put("code", code)
            put("deviceFingerprint", android.provider.Settings.Secure.getString(contentResolver, android.provider.Settings.Secure.ANDROID_ID))
            put("model", "${Build.MANUFACTURER} ${Build.MODEL}")
            put("os", "Android ${Build.VERSION.RELEASE} (SDK ${Build.VERSION.SDK_INT})")
            put("appVersion", BuildConfig.VERSION_NAME)
        }.toString()

        val conn = (URL(endpoint).openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"
            doOutput = true
            connectTimeout = 15_000
            readTimeout = 20_000
            setRequestProperty("Content-Type", "application/json")
            setRequestProperty("Accept", "application/json")
        }
        conn.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }

        val code200 = conn.responseCode
        val text = (if (code200 in 200..299) conn.inputStream else conn.errorStream)
            ?.bufferedReader()?.use { it.readText() }.orEmpty()
        conn.disconnect()

        if (code200 !in 200..299) error("HTTP $code200: $text")
        val json = JSONObject(text)
        PairResponse(
            token = json.getString("token"),
            screenId = json.optString("screenId").takeIf { it.isNotBlank() },
            tenantSlug = json.optString("tenantSlug").takeIf { it.isNotBlank() },
        )
    }

    private data class PairResponse(
        val token: String,
        val screenId: String?,
        val tenantSlug: String?,
    )
}
