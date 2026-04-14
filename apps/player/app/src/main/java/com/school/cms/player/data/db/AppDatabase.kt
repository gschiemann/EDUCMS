package com.school.cms.player.data.db

import androidx.room.Database
import androidx.room.RoomDatabase
import com.school.cms.player.data.db.dao.PlayerDao
import com.school.cms.player.data.db.entities.*

@Database(
    entities = [
        DeviceConfig::class,
        Schedule::class,
        Playlist::class,
        MediaAsset::class,
        PlaybackLog::class
    ],
    version = 1,
    exportSchema = false
)
abstract class AppDatabase : RoomDatabase() {
    abstract fun playerDao(): PlayerDao
}
