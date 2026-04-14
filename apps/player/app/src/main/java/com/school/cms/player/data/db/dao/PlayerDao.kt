package com.school.cms.player.data.db.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import com.school.cms.player.data.db.entities.*

@Dao
interface PlayerDao {
    // Config
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun setConfig(config: DeviceConfig)

    @Query("SELECT value FROM device_config WHERE `key` = :key")
    suspend fun getConfigValue(key: String): String?

    // Schedules
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertSchedules(schedules: List<Schedule>)

    @Query("SELECT * FROM schedule WHERE startTime <= :currentTime AND endTime >= :currentTime ORDER BY priorityLevel DESC")
    suspend fun getActiveSchedules(currentTime: Long): List<Schedule>
    
    @Query("DELETE FROM schedule")
    suspend fun clearAllSchedules()

    // Assets
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertAssets(assets: List<MediaAsset>)

    @Query("SELECT * FROM media_asset WHERE playlistId = :playlistId")
    suspend fun getAssetsForPlaylist(playlistId: String): List<MediaAsset>

    @Query("UPDATE media_asset SET status = :status, localPath = :localPath WHERE id = :assetId")
    suspend fun updateAssetStatus(assetId: String, status: String, localPath: String?)
    
    @Query("DELETE FROM media_asset WHERE id = :assetId")
    suspend fun deleteAsset(assetId: String)

    // Logs
    @Insert
    suspend fun insertPlaybackLog(log: PlaybackLog)
}
