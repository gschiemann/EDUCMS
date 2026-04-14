package com.school.cms.player.data.db.entities

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "playback_log")
data class PlaybackLog(
    @PrimaryKey(autoGenerate = true)
    val id: Long = 0,
    val assetId: String,
    val playlistId: String,
    val playedAt: Long,
    val durationMs: Long
)
