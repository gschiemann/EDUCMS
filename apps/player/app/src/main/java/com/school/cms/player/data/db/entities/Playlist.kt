package com.school.cms.player.data.db.entities

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "playlist")
data class Playlist(
    @PrimaryKey
    val id: String,
    val name: String,
    val version: Int
)
