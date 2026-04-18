package com.educms.player.usb

import android.content.Context
import android.net.Uri
import android.util.Log
import androidx.documentfile.provider.DocumentFile
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.security.MessageDigest
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

/**
 * Reads the EduCMS content bundle off a mounted USB stick (via SAF tree
 * Uri the operator selected in UsbIngestActivity), verifies its HMAC-SHA256
 * signature against the locally-stored tenant key, verifies every asset's
 * SHA-256 hash matches the manifest, and copies accepted assets into the
 * app's internal storage so the WebView's Service Worker can serve them.
 *
 * Public entry point: [ingest].
 *
 * Layout expected on the USB stick:
 *
 *   edu-cms-content/
 *     manifest.json
 *     manifest.sig
 *     assets/<sha256>.<ext>
 *     emergency/<sha256>.<ext>
 */
class UsbIngester(
    private val context: Context,
    private val hmacKeyHex: String,
    private val expectedTenantId: String,
) {

    sealed class Result {
        data class Accepted(
            val bundleVersion: String,
            val assetCount: Int,
            val totalBytes: Long,
            val emergencyAssets: Int,
            val copiedTo: File,
        ) : Result()

        data class Rejected(val outcome: String, val reason: String) : Result()
    }

    /**
     * Parse + verify + copy. Caller (UsbIngestActivity) holds the tree Uri
     * granted via ACTION_OPEN_DOCUMENT_TREE; we walk it via SAF.
     */
    fun ingest(treeUri: Uri): Result {
        val root = DocumentFile.fromTreeUri(context, treeUri)
            ?: return Result.Rejected("REJECTED", "Cannot open USB tree")

        val bundleDir = root.findFile("edu-cms-content")
            ?: return Result.Rejected("REJECTED", "Stick has no edu-cms-content/ folder")

        val manifestFile = bundleDir.findFile("manifest.json")
            ?: return Result.Rejected("REJECTED", "manifest.json missing")
        val sigFile = bundleDir.findFile("manifest.sig")
            ?: return Result.Rejected("REJECTED_SIGNATURE", "manifest.sig missing")

        val manifestBytes = context.contentResolver.openInputStream(manifestFile.uri)?.use { it.readBytes() }
            ?: return Result.Rejected("REJECTED", "Cannot read manifest.json")
        val sigHex = context.contentResolver.openInputStream(sigFile.uri)?.use { it.bufferedReader().readText().trim() }
            ?: return Result.Rejected("REJECTED_SIGNATURE", "Cannot read manifest.sig")

        // 1. Verify HMAC signature. hexToBytes inside hmacSha256Hex now
        // require()s a 64-char hex key (HIGH-10) — wrap in try/catch so
        // a malformed locally-stored key produces a clean rejection
        // instead of crashing UsbIngestActivity.
        val computedSig = try {
            hmacSha256Hex(hmacKeyHex, manifestBytes)
        } catch (e: IllegalArgumentException) {
            Log.w("UsbIngester", "HMAC key is malformed: ${e.message}")
            return Result.Rejected("REJECTED", "Player's USB key is invalid — re-pair the screen to receive a fresh key from the dashboard")
        }
        if (!constantTimeEq(computedSig, sigHex)) {
            Log.w("UsbIngester", "Signature mismatch: expected $sigHex, got $computedSig")
            return Result.Rejected("REJECTED_SIGNATURE", "manifest.sig does not match — wrong tenant key or tampered bundle")
        }

        // 2. Parse manifest + tenant check.
        val manifest = runCatching { JSONObject(String(manifestBytes, Charsets.UTF_8)) }.getOrNull()
            ?: return Result.Rejected("REJECTED", "manifest.json is not valid JSON")

        val tenantInBundle = manifest.optString("tenantId", "")
        if (tenantInBundle != expectedTenantId) {
            return Result.Rejected("REJECTED", "Bundle tenantId ($tenantInBundle) does not match this player's tenant ($expectedTenantId)")
        }

        val schema = manifest.optString("schema", "")
        if (schema != "edu-cms-usb-bundle/v1") {
            return Result.Rejected("REJECTED", "Unsupported bundle schema: $schema")
        }

        val bundleVersion = manifest.optString("bundleVersion", "(unknown)")
        val assets: JSONArray = manifest.optJSONArray("assets") ?: JSONArray()
        if (assets.length() == 0) {
            return Result.Rejected("REJECTED", "manifest has no assets")
        }

        // 3. Copy each asset, verifying SHA-256 along the way.
        val targetRoot = File(context.filesDir, "usb-cache").apply { mkdirs() }
        var totalBytes = 0L
        var emergencyCount = 0
        var copied = 0

        for (i in 0 until assets.length()) {
            val a = assets.getJSONObject(i)
            val expectedSha = a.optString("sha256", "")
            val localPath = a.optString("localPath", "") // e.g. "assets/<sha>.mp4" or "emergency/<sha>.mp4"
            val tier = if (localPath.startsWith("emergency/")) "emergency" else "playlist"
            if (expectedSha.isBlank() || localPath.isBlank()) {
                return Result.Rejected("REJECTED", "Asset entry $i missing sha256 or localPath")
            }

            // Walk the SAF tree to the file.
            val parts = localPath.split("/")
            if (parts.size != 2) {
                return Result.Rejected("REJECTED", "Bad localPath: $localPath")
            }
            val tierDir = bundleDir.findFile(parts[0])
                ?: return Result.Rejected("REJECTED", "USB missing folder: ${parts[0]}")
            val srcFile = tierDir.findFile(parts[1])
                ?: return Result.Rejected("REJECTED", "USB missing file: $localPath")

            // Read + hash + copy.
            val bytes = context.contentResolver.openInputStream(srcFile.uri)?.use { it.readBytes() }
                ?: return Result.Rejected("REJECTED", "Cannot read $localPath")
            val actualSha = sha256Hex(bytes)
            if (!constantTimeEq(actualSha, expectedSha)) {
                return Result.Rejected("REJECTED_HASH", "Asset $localPath hash mismatch (expected $expectedSha, got $actualSha)")
            }

            // Mirror the layout into our internal usb-cache/.
            val destDir = File(targetRoot, parts[0]).apply { mkdirs() }
            val destFile = File(destDir, parts[1])
            FileOutputStream(destFile).use { it.write(bytes) }

            totalBytes += bytes.size
            copied += 1
            if (tier == "emergency") emergencyCount += 1
        }

        // 4. Write the manifest copy + ingest-state file. MED-4 audit fix:
        // write to a temp filename and atomically rename into place so a
        // concurrent UsbCacheIndex.reload() can never observe a half-written
        // state.json. java.io.File.renameTo is POSIX-atomic on the same
        // filesystem (always true here since both files live in filesDir).
        atomicWrite(File(targetRoot, "manifest.json"), manifestBytes)
        val state = JSONObject().apply {
            put("bundleVersion", bundleVersion)
            put("ingestedAt", System.currentTimeMillis())
            put("assetCount", copied)
            put("emergencyCount", emergencyCount)
            put("totalBytes", totalBytes)
        }
        atomicWrite(File(targetRoot, "state.json"), state.toString().toByteArray(Charsets.UTF_8))

        // Refresh the lookup index so the WebView starts serving from disk
        // immediately on next render.
        UsbCacheIndex.reload(context)

        return Result.Accepted(
            bundleVersion = bundleVersion,
            assetCount = copied,
            totalBytes = totalBytes,
            emergencyAssets = emergencyCount,
            copiedTo = targetRoot,
        )
    }

    private fun hmacSha256Hex(keyHex: String, data: ByteArray): String {
        val key = SecretKeySpec(hexToBytes(keyHex), "HmacSHA256")
        val mac = Mac.getInstance("HmacSHA256").apply { init(key) }
        return bytesToHex(mac.doFinal(data))
    }

    private fun sha256Hex(data: ByteArray): String =
        bytesToHex(MessageDigest.getInstance("SHA-256").digest(data))

    private fun hexToBytes(hex: String): ByteArray {
        // HIGH-10 audit fix: bundler always issues a 64-char (32-byte)
        // HMAC key. Anything else is operator error (mistyped, truncated,
        // or wrong field) — fail loudly with a clear message instead of
        // silently corrupting bytes via Character.digit returning -1 or
        // an IndexOutOfBoundsException on odd-length input.
        require(hex.length % 2 == 0) {
            "Hex string must have an even number of characters (got ${hex.length})"
        }
        require(hex.all { (it in '0'..'9') || (it in 'a'..'f') || (it in 'A'..'F') }) {
            "Hex string contains non-hex characters"
        }
        val out = ByteArray(hex.length / 2)
        for (i in out.indices) {
            out[i] = ((Character.digit(hex[i * 2], 16) shl 4)
                + Character.digit(hex[i * 2 + 1], 16)).toByte()
        }
        return out
    }

    private fun bytesToHex(bytes: ByteArray): String {
        val sb = StringBuilder(bytes.size * 2)
        for (b in bytes) sb.append(String.format("%02x", b))
        return sb.toString()
    }

    /** Write file atomically: temp file in same dir → rename. Same-FS rename
     *  is POSIX-atomic so a concurrent reader never sees a half-written file. */
    private fun atomicWrite(target: File, bytes: ByteArray) {
        val tmp = File(target.parentFile, target.name + ".tmp-" + System.nanoTime())
        FileOutputStream(tmp).use { it.write(bytes) }
        // renameTo returns false on failure; fall back to a copy+delete so we
        // never silently leave the target stale. Same-volume rename is the
        // common case on Android internal storage.
        if (!tmp.renameTo(target)) {
            target.writeBytes(bytes)
            tmp.delete()
        }
    }

    private fun constantTimeEq(a: String, b: String): Boolean {
        if (a.length != b.length) return false
        var diff = 0
        for (i in a.indices) diff = diff or (a[i].code xor b[i].code)
        return diff == 0
    }
}
