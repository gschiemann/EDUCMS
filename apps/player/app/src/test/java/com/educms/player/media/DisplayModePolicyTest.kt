package com.educms.player.media

import org.junit.Assert.*
import org.junit.Test

/** Experiment 5 (1.1.42, plan §4E): the mode chooser picks the same-resolution ~60 Hz mode, or nothing. */
class DisplayModePolicyTest {
    private val uhd30 = DisplayModeFacts(1, 3840, 2160, 30.00f)
    private val uhd24 = DisplayModeFacts(2, 3840, 2160, 24.00f)
    private val uhd25 = DisplayModeFacts(3, 3840, 2160, 25.00f)
    private val uhd50 = DisplayModeFacts(4, 3840, 2160, 50.00f)
    private val uhd5994 = DisplayModeFacts(5, 3840, 2160, 59.94f)
    private val uhd60 = DisplayModeFacts(6, 3840, 2160, 60.00f)
    private val fhd60 = DisplayModeFacts(7, 1920, 1080, 60.00f)
    private val fhd120 = DisplayModeFacts(8, 1920, 1080, 120.00f)
    private val all = listOf(uhd30, uhd24, uhd25, uhd50, uhd5994, uhd60, fhd60, fhd120)

    @Test fun picksTheSameResolutionModeClosestToSixtyAndNeverAnotherResolutionOrALowerRate() {
        assertEquals(uhd60, DisplayModePolicy.choosePreferred60(uhd30, all))
        // Without an exact 60.00 the nearest ~60 of the same size is taken (59.94), never 1080p60.
        assertEquals(uhd5994, DisplayModePolicy.choosePreferred60(uhd30, all - uhd60))
        // A 4K panel that lists only 1080p at 60 gets nothing: a different resolution is never chosen.
        assertNull(DisplayModePolicy.choosePreferred60(uhd30, listOf(uhd30, uhd24, fhd60, fhd120)))
        // Nothing lower, nothing outside 59–61 (50 Hz is not "~60"), nothing when the list is empty.
        assertNull(DisplayModePolicy.choosePreferred60(uhd30, listOf(uhd30, uhd24, uhd25, uhd50)))
        assertNull(DisplayModePolicy.choosePreferred60(uhd30, emptyList()))
        // The active mode being unknown is a reason to ask for nothing.
        assertNull(DisplayModePolicy.choosePreferred60(null, all))
    }

    @Test fun aPanelAlreadyAtSixtyOrFasterIsLeftAlone() {
        assertNull(DisplayModePolicy.choosePreferred60(uhd60, all))
        assertNull(DisplayModePolicy.choosePreferred60(uhd5994, all))
        assertNull("never a LOWER rate: 120 Hz is not asked down to 60", DisplayModePolicy.choosePreferred60(fhd120, all))
        assertNull(DisplayModePolicy.choosePreferred60(DisplayModeFacts(9, 1920, 1080, 59.0f), all))
    }

    @Test fun labelsAreBoundedAndNameTheModeTheWayEveryDisplayModeFieldDoes() {
        assertEquals("1:3840x2160@30.00", uhd30.label())
        assertEquals("5:3840x2160@59.94", uhd5994.label())
        val labels = DisplayModePolicy.labels(uhd30, all)
        // Same resolution first (by id), the others after; every label is the wire shape.
        assertEquals(listOf("1:3840x2160@30.00", "2:3840x2160@24.00", "3:3840x2160@25.00", "4:3840x2160@50.00", "5:3840x2160@59.94", "6:3840x2160@60.00", "7:1920x1080@60.00", "8:1920x1080@120.00"), labels)
        for (l in labels) assertTrue(l, Regex("^[0-9]{1,6}:[0-9]{1,5}x[0-9]{1,5}@[0-9]{1,4}\\.[0-9]{2}$").matches(l))
        val many = (1..40).map { DisplayModeFacts(it, 1920, 1080, 60f) }
        assertEquals(DisplayModePolicy.MAX_MODES, DisplayModePolicy.labels(null, many).size)
        assertTrue(DisplayModePolicy.labels(null, emptyList()).isEmpty())
    }

    @Test fun theWindowRequestNeedsAPickAndAWindowAndIsRememberedPerFaceForTheProcess() {
        val face = 7 // a face no other test uses: the state is process-wide on purpose
        assertEquals(0, PreferredDisplayMode.applied(face))
        assertEquals(Pair(0, PreferredDisplayMode.RESULT_ALREADY_60HZ), PreferredDisplayMode.request(face, null, uhd60, all))
        assertEquals(Pair(0, PreferredDisplayMode.RESULT_NO_60HZ_MODE), PreferredDisplayMode.request(face, null, uhd30, listOf(uhd30, fhd60)))
        // A pick exists but there is no window to ask (a face not hosted yet): nothing is applied, nothing is remembered.
        assertEquals(Pair(0, PreferredDisplayMode.RESULT_NO_WINDOW), PreferredDisplayMode.request(face, null, uhd30, all))
        assertEquals(0, PreferredDisplayMode.applied(face))
        assertNull("nothing to withdraw", PreferredDisplayMode.withdraw(face, null))
        for (c in listOf(PreferredDisplayMode.RESULT_APPLIED, PreferredDisplayMode.RESULT_KEPT, PreferredDisplayMode.RESULT_ALREADY_60HZ,
            PreferredDisplayMode.RESULT_NO_60HZ_MODE, PreferredDisplayMode.RESULT_NO_WINDOW, PreferredDisplayMode.RESULT_FAILED,
            PreferredDisplayMode.RESULT_REVERTED, PreferredDisplayMode.RESULT_OTHER_SESSION)) {
            assertTrue(c, Regex("^[a-z0-9-]{1,64}$").matches(c))
        }
    }
}
