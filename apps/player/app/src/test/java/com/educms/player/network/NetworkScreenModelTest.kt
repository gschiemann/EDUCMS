package com.educms.player.network

import com.educms.player.network.NetworkScreenPolicy.Words
import com.educms.player.settings.DeviceSettingCodes
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The Network screen's pure half: the D-pad keyboard (a password must be
 * typeable with nothing but arrows and OK) and the rules that keep the screen
 * off the glass during an alert.
 */
class NetworkScreenModelTest {

    @Test fun everyLayoutIsAStraightGridSoTheDpadNeverJumps() {
        for (layout in KeyboardModel.Layout.values()) {
            val rows = KeyboardModel(layout = layout).rows()
            val charRows = rows.dropLast(1)
            assertTrue(charRows.all { it.size == charRows.first().size })
            assertEquals(5, rows.last().size)
        }
        // Switching layouts keeps the same grid, so focus stays on the same key position.
        assertEquals(KeyboardModel().rows().map { it.size }, KeyboardModel(layout = KeyboardModel.Layout.SYMBOLS).rows().map { it.size })
    }

    @Test fun everyPrintableCharacterAWpaPasswordMayHoldIsReachable() {
        val reachable = KeyboardModel.Layout.values().flatMap { layout ->
            KeyboardModel(layout = layout).rows().flatten().filterIsInstance<KeyboardModel.Key.Char>().map { it.c }
        }.toSet() + ' '
        for (code in 0x20..0x7e) assertTrue("'${code.toChar()}' cannot be typed", code.toChar() in reachable)
    }

    @Test fun typingDeletingShiftingAndTheLengthBound() {
        var k = KeyboardModel()
        k = k.press(KeyboardModel.Key.Char('a')).press(KeyboardModel.Key.Shift)
        assertEquals(KeyboardModel.Layout.UPPER, k.layout)
        k = k.press(KeyboardModel.Key.Char('B')).press(KeyboardModel.Key.Space).press(KeyboardModel.Key.Symbols)
        assertEquals(KeyboardModel.Layout.SYMBOLS, k.layout)
        k = k.press(KeyboardModel.Key.Char('!'))
        assertEquals("aB !", k.text)
        assertEquals("aB ", k.press(KeyboardModel.Key.Delete).text)
        assertEquals("", k.press(KeyboardModel.Key.Clear).text)
        assertEquals("a non-ASCII character never enters a WPA password", "aB !", k.type('é').text)
        val full = (1..80).fold(KeyboardModel()) { m, _ -> m.type('x') }
        assertEquals(63, full.text.length)
        assertEquals(32, (1..40).fold(KeyboardModel(maxLength = 32)) { m, _ -> m.type('n') }.text.length)
    }

    @Test fun anAlertKeepsTheScreenOffTheGlass() {
        assertFalse(NetworkScreenPolicy.mayOpen(emergencyHeld = true, lockTask = false))
        assertFalse(NetworkScreenPolicy.mayOpen(emergencyHeld = false, lockTask = true))
        assertTrue(NetworkScreenPolicy.mayOpen(emergencyHeld = false, lockTask = false))
        assertTrue("an alert that starts while it is up closes it", NetworkScreenPolicy.mustClose(emergencyHeld = true))
        assertFalse(NetworkScreenPolicy.mustClose(emergencyHeld = false))
        assertTrue("the alert is uncovered within a quarter second at worst", NetworkScreenPolicy.EMERGENCY_POLL_MS <= 250L)
    }

    @Test fun passwordsFollowWpaRules() {
        assertTrue(NetworkScreenPolicy.needsPassword("wpa2") && NetworkScreenPolicy.needsPassword("wpa3"))
        assertFalse(NetworkScreenPolicy.needsPassword("open"))
        assertFalse(NetworkScreenPolicy.passwordOk("short"))
        assertTrue(NetworkScreenPolicy.passwordOk("eight ch"))
        assertFalse(NetworkScreenPolicy.passwordOk("x".repeat(64)))
    }

    @Test fun everyEngineOutcomeIsSaidInPlainWords() {
        val w = NetworkScreenPolicy
        assertEquals(Words.CONNECTED, w.words("applied", DeviceSettingCodes.WIFI_JOINED))
        assertEquals(Words.SAVED, w.words("applied", DeviceSettingCodes.WIFI_SAVED))
        assertEquals(Words.SUGGESTED, w.words("applied", DeviceSettingCodes.WIFI_SUGGESTED))
        assertEquals(Words.WAITING_APPROVAL, w.words("waiting", DeviceSettingCodes.WIFI_APPROVAL))
        assertEquals(Words.WAITING_DIALOG, w.words("waiting", DeviceSettingCodes.WIFI_DIALOG))
        assertEquals(Words.JOINING, w.words("pending", DeviceSettingCodes.WIFI_SWITCHING))
        assertEquals(Words.COULD_NOT_JOIN, w.words("failed", DeviceSettingCodes.WIFI_NO_CONNECT))
        assertEquals(Words.NO_SERVER, w.words("failed", DeviceSettingCodes.WIFI_UNREACHABLE))
        assertEquals(Words.WRONG_PASSWORD, w.words("failed", DeviceSettingCodes.WIFI_INVALID))
        assertEquals(Words.DECLINED, w.words("failed", DeviceSettingCodes.WIFI_DECLINED))
        assertEquals(Words.ALERT, w.words("waiting", DeviceSettingCodes.WAIT_EMERGENCY))
        assertEquals(Words.WIFI_OFF, w.words("waiting", DeviceSettingCodes.WIFI_OFF))
        assertEquals(Words.NAME_TAKEN, w.words("failed", DeviceSettingCodes.WIFI_EXISTS))
        assertEquals(Words.NOT_SUPPORTED, w.words("failed", DeviceSettingCodes.WIFI_SECURITY))
        assertEquals(Words.FAILED, w.words("failed", DeviceSettingCodes.ERROR))
        assertEquals("▂▄▆█", w.signal(4))
        assertEquals("····", w.signal(0))
        assertEquals("▂▄··", w.signal(2))
    }
}
