package com.school.cms.player.state

enum class PlayerState {
    STATE_UNPROVISIONED,
    STATE_SYNCING,
    STATE_PLAYING_SCHEDULE,
    STATE_PLAYING_OVERRIDE,
    STATE_OFFLINE_FALLBACK,
    STATE_DOWN
}
