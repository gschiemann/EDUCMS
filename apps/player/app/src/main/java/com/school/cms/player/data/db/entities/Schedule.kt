package com.school.cms.player.data.db.entities

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "schedule")
data class Schedule(
    @PrimaryKey
    val id: String,
    val playlistId: String,
    val startTime: Long,
    val endTime: Long,
    val priorityLevel: Int
)
