package com.school.cms.player.provisioning

import com.school.cms.player.data.db.dao.PlayerDao
import com.school.cms.player.data.db.entities.DeviceConfig
import java.util.UUID

class ProvisioningManager(private val playerDao: PlayerDao) {

    /**
     * Boot phase check. Detects if device holds a valid pairing token.
     */
    suspend fun isProvisioned(): Boolean {
        val token = playerDao.getConfigValue("pairing_token")
        return !token.isNullOrEmpty()
    }

    suspend fun generatePairingRequest(): String {
        val uniqueId = UUID.randomUUID().toString()
        playerDao.setConfig(DeviceConfig("device_uuid", uniqueId))
        
        // Emulate API call to `/api/v1/devices/register-intent`
        // ...
        // Returns a PIN
        return "123456" 
    }

    suspend fun completeProvisioning(jwtToken: String) {
        playerDao.setConfig(DeviceConfig("pairing_token", jwtToken))
    }
}
