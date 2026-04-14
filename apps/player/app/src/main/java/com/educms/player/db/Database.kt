package com.educms.player.db

import androidx.room.Entity
import androidx.room.PrimaryKey
import androidx.room.Database
import androidx.room.RoomDatabase

/**
 * Represents the offline persistent state.
 * The Main UI Thread ONLY ever reads from these records to prevent network deadlocks.
 */
@Entity(tableName = "local_assets")
data class LocalAsset(
    @PrimaryKey val id: String,
    val url: String,
    val sha256: String,
    val localFilePath: String,
    val isValid: Boolean = false // Set strictly after cryptographic verification inside SyncWorker
)

@Entity(tableName = "metadata")
data class Metadata(
    @PrimaryKey val id: Int = 1,
    val activeManifestVersion: String,
    val lastSyncTime: Long
)

// Mapping implementation
@Database(entities = [LocalAsset::class, Metadata::class], version = 1)
abstract class CacheDatabase : RoomDatabase() {
    // abstract fun assetDao(): AssetDao
    // abstract fun metadataDao(): MetadataDao
}
