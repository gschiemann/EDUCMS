package com.schoolcms.security

import android.util.Log
import java.io.File
import java.io.FileInputStream
import java.security.MessageDigest

object AssetHashVerifier {
    fun isFileIntact(file: File, expectedHash: String): Boolean {
        if (!file.exists() || !file.isFile) return false

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
            return computedHash.equals(expectedHash, ignoreCase = true)
        } catch (e: Exception) {
            return false
        }
    }
}
