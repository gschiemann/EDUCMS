package com.school.cms.player.state

import com.school.cms.player.data.db.entities.Schedule
import kotlinx.coroutines.ExperimentalCoroutinesApi
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class PlayerStateMachineTest {

    private lateinit var stateMachine: PlayerStateMachine

    @Before
    fun setup() {
        stateMachine = PlayerStateMachine()
    }

    @Test
    fun `test initial state is UNPROVISIONED`() {
        assertEquals(PlayerState.STATE_UNPROVISIONED, stateMachine.currentState.value)
    }

    @Test
    fun `test resolveActiveSchedule returns highest priority`() {
        val schedules = listOf(
            Schedule("1", "pl_1", 1000L, 2000L, priorityLevel = 1), // Default
            Schedule("2", "pl_2", 1000L, 2000L, priorityLevel = 5)  // Event
        )
        val active = stateMachine.resolveActiveSchedule(schedules)
        assertEquals("2", active?.id)
    }

    @Test
    fun `test resolveActiveSchedule tie-breaker favors narrower window`() {
        val schedules = listOf(
            Schedule("1", "all_day", 100L, 1000L, priorityLevel = 5), // Duration 900
            Schedule("2", "assembly", 500L, 600L, priorityLevel = 5)  // Duration 100
        )
        val active = stateMachine.resolveActiveSchedule(schedules)
        
        // Even with same priority, narrow window wins
        assertEquals("2", active?.id)
    }

    @Test
    fun `test resolveActiveSchedule returns null when empty`() {
        assertNull(stateMachine.resolveActiveSchedule(emptyList()))
    }
    
    @Test
    fun `test emergency override transitions state`() {
        stateMachine.triggerEmergencyOverride("emerg_123")
        assertEquals(PlayerState.STATE_PLAYING_OVERRIDE, stateMachine.currentState.value)
        
        stateMachine.clearEmergencyOverride()
        assertEquals(PlayerState.STATE_SYNCING, stateMachine.currentState.value)
    }
}
