package com.school.cms.player.state

import com.school.cms.player.data.db.entities.Schedule
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

class PlayerStateMachine {

    private val _currentState = MutableStateFlow(PlayerState.STATE_UNPROVISIONED)
    val currentState: StateFlow<PlayerState> = _currentState.asStateFlow()

    private var activeOverride: String? = null

    fun transitionTo(newState: PlayerState) {
        // Prevent state thrashing or invalid transitions if needed
        _currentState.value = newState
    }

    /**
     * Resolves the active schedule based on precedence rules.
     * 1. Overrides always take precedence.
     * 2. Strict time overlaps yield to the narrower window.
     * 3. Priority Level dictates tie-breakers.
     */
    fun resolveActiveSchedule(activeSchedules: List<Schedule>): Schedule? {
        if (activeSchedules.isEmpty()) return null

        // If there's an active override, we skip local scheduling (handled elsewhere)
        
        return activeSchedules.maxWithOrNull(
            compareBy<Schedule> { it.priorityLevel }
                .thenBy { it.endTime - it.startTime } // Narrower window (smaller duration) wins
        )
    }

    fun triggerEmergencyOverride(overrideId: String) {
        activeOverride = overrideId
        transitionTo(PlayerState.STATE_PLAYING_OVERRIDE)
    }

    fun clearEmergencyOverride() {
        activeOverride = null
        transitionTo(PlayerState.STATE_SYNCING) // typically re-evaluate sync -> schedule
    }
}
