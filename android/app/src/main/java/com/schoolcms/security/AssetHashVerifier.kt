package com.schoolcms.security

import android.util.Log
import java.io.File
import java.io.FileInputStream
import java.security.MessageDigest

/**
 * AssetHashVerifier ensures that media downloaded to the local device 
 * matches the exact SHA-256 hash expected by the CMS.
 * Mitigates Local Cache Tampering (Release Blocker RT-06).
 */
object AssetHashVerifier {

    private const val TAG = "AssetHashVerifier"

    /**
     * Reads a file from disk, computes its SHA-256 digest, and compares it to the expected hash.
     * @param file The local file to verify.
     * @param expectedHash The SHA-256 hash provided in the CMS Playlist Manifest.
     * @return true if the file is intact, false if tampered or corrupted.
     */
    fun isFileIntact(file: File, expectedHash: String): Boolean {
        if (!file.exists() || !file.isFile) {
            Log.e(TAG, "File not found: ${file.absolutePath}")
            return false
        }

        try {
            val digest = MessageDigest.getInstance("SHA-256")
            FileInputStream(file).use { fis ->
                val buffer = ByteArray(8192)
                var bytesRead: Int
                while (fis.read(buffer).also { bytesRead = it } != -1) {
                    digest.update(buffer, 0, bytesRead)
                }
            }
            val computedHash = digest.digest().joinToString("") { "%02x".format(it) }

            if (computedHash.equals(expectedHash, ignoreCase = true)) {
                return true
            } else {
                Log.e(TAG, "INTEGRITY FAILURE: Computed $computedHash != Expected $expectedHash")
                return false
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error hashing file", e)
            return false
        }
    }
}
