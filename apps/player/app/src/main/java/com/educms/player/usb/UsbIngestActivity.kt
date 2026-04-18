package com.educms.player.usb

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.util.Log
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import androidx.lifecycle.lifecycleScope
import com.educms.player.DeviceStore
import com.educms.player.MainActivity
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * Operator-facing activity invoked when a USB stick attaches. Asks the
 * operator to pick the USB root via the system file picker (SAF), then
 * runs UsbIngester, then either applies the bundle and bounces back to
 * MainActivity or shows a Toast describing the rejection.
 *
 * V1 scaffold: no PIN prompt yet — the tenant feature flag + signed
 * manifest are the security gate. PIN prompt + emergency-asset escalated
 * approval will land in V2.
 */
class UsbIngestActivity : ComponentActivity() {

    private val deviceStore by lazy { DeviceStore(applicationContext) }

    private val pickTree = registerForActivityResult(
        ActivityResultContracts.OpenDocumentTree()
    ) { uri: Uri? ->
        if (uri == null) {
            Toast.makeText(this, "USB ingest cancelled", Toast.LENGTH_SHORT).show()
            finish()
            return@registerForActivityResult
        }
        // Persist permission so we can re-read on retry.
        runCatching {
            contentResolver.takePersistableUriPermission(
                uri,
                Intent.FLAG_GRANT_READ_URI_PERMISSION,
            )
        }
        runIngest(uri)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Immediately show the system folder picker so the operator can
        // select the root of the USB stick.
        Toast.makeText(this, "USB detected — select the stick's root folder", Toast.LENGTH_LONG).show()
        pickTree.launch(null)
    }

    private fun runIngest(treeUri: Uri) {
        lifecycleScope.launch {
            val token = deviceStore.deviceToken.first()
            if (token.isNullOrBlank()) {
                Toast.makeText(this@UsbIngestActivity, "Player not paired — pair first", Toast.LENGTH_LONG).show()
                finish()
                return@launch
            }

            // V1: HMAC key + tenant id are stored in DeviceStore at pairing
            // time. (Pairing endpoint will be extended to include these in
            // a follow-up; for V1 scaffold we read whatever is there and
            // bail with a friendly error if missing.)
            val tenantId = deviceStore.tenantSlug.first().orEmpty() // placeholder until pairing returns the tenant id
            // TODO(7B-followup): server's /devices/pair endpoint should also return
            // { usbIngestKey, tenantId } so we can persist them here. For now we
            // accept the tree but reject at signature-check time if the key isn't set.
            val hmacKey = "" // TODO: read from a future DeviceStore.usbHmacKey field

            if (hmacKey.isBlank() || tenantId.isBlank()) {
                Toast.makeText(
                    this@UsbIngestActivity,
                    "USB ingest not configured for this tenant. Ask your admin to enable it in the dashboard, then re-pair the screen.",
                    Toast.LENGTH_LONG,
                ).show()
                finish()
                return@launch
            }

            val ingester = UsbIngester(applicationContext, hmacKey, tenantId)
            val result = withContext(Dispatchers.IO) { ingester.ingest(treeUri) }

            when (result) {
                is UsbIngester.Result.Accepted -> {
                    Log.i("UsbIngest", "Accepted bundle ${result.bundleVersion}: ${result.assetCount} assets, ${result.totalBytes} B")
                    Toast.makeText(
                        this@UsbIngestActivity,
                        "USB ingest OK — ${result.assetCount} assets (${result.emergencyAssets} emergency)",
                        Toast.LENGTH_LONG,
                    ).show()
                    // Bounce back to the player so the WebView can pick up the
                    // new state on next manifest sync.
                    startActivity(Intent(this@UsbIngestActivity, MainActivity::class.java))
                    finish()
                }
                is UsbIngester.Result.Rejected -> {
                    Log.w("UsbIngest", "Rejected: ${result.outcome} — ${result.reason}")
                    Toast.makeText(
                        this@UsbIngestActivity,
                        "USB ingest rejected: ${result.reason}",
                        Toast.LENGTH_LONG,
                    ).show()
                    finish()
                }
            }
        }
    }
}
