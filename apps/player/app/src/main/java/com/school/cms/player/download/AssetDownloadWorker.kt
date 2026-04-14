package com.school.cms.player.download

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.school.cms.player.data.db.dao.PlayerDao
import java.io.File
import java.security.MessageDigest

class AssetDownloadWorker(
    private val appContext: Context,
    workerParams: WorkerParameters,
    private val playerDao: PlayerDao
) : CoroutineWorker(appContext, workerParams) {

    override suspend fun doWork(): Result {
        val assetId = inputData.getString("ASSET_ID") ?: return Result.failure()
        
        // 1. Check if asset exists and needs downloading
        // 2. Perform HTTP GET using OkHttp to download the remote URL
        // 3. Save to internal storage (Context.getFilesDir())
        // 4. Compute SHA-256
        val fileBytes = ByteArray(0) // Mock
        val calculatedHash = calculateSHA256(fileBytes)
        
        val expectedHash = inputData.getString("EXPECTED_HASH") ?: ""
        
        return if (calculatedHash.equals(expectedHash, ignoreCase = true)) {
            // Update DB
            playerDao.updateAssetStatus(assetId, "DOWNLOADED", "/internal/path/to/asset")
            Result.success()
        } else {
            // Hash mismatch, delete invalid file
            playerDao.updateAssetStatus(assetId, "INVALID", null)
            Result.retry() // Retries with exponential backoff per CACHE_AND_SYNC_STRATEGY.md
        }
    }

    private fun calculateSHA256(bytes: ByteArray): String {
        val digest = MessageDigest.getInstance("SHA-256")
        val hash = digest.digest(bytes)
        return hash.joinToString("") { "%02x".format(it) }
    }
}
