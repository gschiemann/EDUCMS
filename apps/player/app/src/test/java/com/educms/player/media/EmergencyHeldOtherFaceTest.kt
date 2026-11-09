package com.educms.player.media

import com.educms.player.display.DisplayEmergency
import org.junit.Assert.*
import org.junit.Test

/**
 * 2026-11-02 — the double-sided echo loop. A double-sided unit has ONE emergency hold with
 * per-face membership, and native playback stops on EVERY face while any face holds. A face
 * that is not itself in the hold now says so (`emergency-held-other-face`), so its page never
 * reads the stop as its own alert and re-raises the hold after an all-clear.
 */
class EmergencyHeldOtherFaceTest {
    @Test fun aFaceHeldOnlyByTheOtherFaceGetsTheOtherFaceReason() {
        // Two faces, face 1 holds → face 0 is stopped for the OTHER face.
        assertEquals("emergency-held-other-face", FaceVideoPolicy.emergencyHeldReason(0, setOf(1)))
        assertEquals("emergency-held", FaceVideoPolicy.emergencyHeldReason(1, setOf(1)))
        assertEquals("emergency-held", FaceVideoPolicy.emergencyHeldReason(0, setOf(0, 1)))
        // An unattributed (legacy) hold stays protective: this face's own reason.
        assertEquals("emergency-held", FaceVideoPolicy.emergencyHeldReason(0, emptySet()))
    }

    @Test fun theOtherFaceReasonIsAClassifiedTransientThatSuspendsTheIntentLikeEmergencyHeld() {
        val code = FaceVideoPolicy.EMERGENCY_HELD_OTHER_FACE
        assertTrue(FaceVideoPolicy.isEmergencyHeldReason(code))
        assertTrue(FaceVideoPolicy.isEmergencyHeldReason("emergency-held"))
        assertFalse(FaceVideoPolicy.isEmergencyHeldReason("content-changed"))
        // Never a fault: an unclassified code would fail closed as a 24 h block.
        assertEquals(NativeEndGrade.Grade.TRANSIENT, NativeEndGrade.grade(code))
        assertTrue(NativeEndReasons.isTransient(code))
        assertEquals(code, NativeEndReasons.normalize(code))
        assertEquals(PlaybackSessionPolicy.fateOf("emergency-held"), PlaybackSessionPolicy.fateOf(code))
        assertTrue(code in PlaybackSessionPolicy.DELIBERATE)
    }

    @Test fun replayOfTheIncidentOrderNeverNamesTheReleasedFaceAsHolding() {
        // A drill is up on both faces.
        var holding = DisplayEmergency.nextHoldFaces(DisplayEmergency.nextHoldFaces(emptySet(), 0, true), 1, true)
        // Clear A (face 0) first; B still holds.
        holding = DisplayEmergency.nextHoldFaces(holding, 0, false)
        // A's native video restarts and is stopped: the reason says it is the OTHER face's hold.
        assertEquals("emergency-held-other-face", FaceVideoPolicy.emergencyHeldReason(0, holding))
        // Clear B: the hold empties and nothing names a holder.
        holding = DisplayEmergency.nextHoldFaces(holding, 1, false)
        assertTrue(holding.isEmpty())
    }
}
