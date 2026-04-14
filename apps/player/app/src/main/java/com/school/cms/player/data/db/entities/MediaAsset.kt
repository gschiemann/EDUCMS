package com.school.cms.player.data.db.entities

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "media_asset")
data class MediaAsset(
    @PrimaryKey
    val id: String,
    val playlistId: String,
    val remoteUrl: String,
    val localPath: String?,
    val expectedHash: String, // SHA-256
    val sizeBytes: Long,
    val status: String // PENDING, DOWNLOADED, INVALID
)
