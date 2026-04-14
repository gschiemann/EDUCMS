package com.school.cms.player.data.db.entities

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "device_config")
data class DeviceConfig(
    @PrimaryKey
    val key: String,
    val value: String
)
