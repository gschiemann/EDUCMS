package com.educms.player.usb

import org.junit.Assert.*
import org.junit.Test

class UsbConnectionStateTest {
    /** The host updates an existing card but needs permission to open one. */
    private class Screen {
        val connection = UsbConnectionState()
        var visible = false
        var openings = 0
        fun show(ticket: UsbConnectionState.Ticket) {
            if (!connection.current(ticket)) return
            if (!visible && !connection.mayOpen(ticket)) return
            if (!visible) openings++
            visible = true
            connection.shown(ticket)
        }
        fun remove() { connection.removed(); visible = false }
    }

    @Test fun `installation or startup with an APK drive already present never opens the menu`() {
        val screen = Screen()
        screen.connection.observe("APK-DRIVE", "APK-DRIVE")
        val boot = screen.connection.ticket()
        // Reading, missing permission, no playlist and completion are all
        // background results; none may open the card on a fresh installation.
        repeat(5) { screen.show(boot) }
        assertEquals(0, screen.openings)
        assertFalse(screen.visible)
        screen.remove()
        screen.connection.observe("usb_storage", "") // OEM leaves its directory behind
        screen.show(screen.connection.ticket())
        assertEquals(0, screen.openings)
    }

    @Test fun `a fresh plug opens once and later stages only update the open card`() {
        val screen = Screen()
        screen.connection.observe("", "")
        assertTrue(screen.connection.inserted())
        val reading = screen.connection.ticket()
        screen.show(reading)
        screen.show(reading)
        assertEquals(1, screen.openings)
        screen.visible = false // Close, Back, automatic close, or an alert
        screen.show(reading) // a late copy or error result cannot reopen it
        assertEquals(1, screen.openings)
        assertFalse(screen.visible)
    }

    @Test fun `unplug before the delayed insertion scan cancels every pending stage`() {
        val screen = Screen()
        screen.connection.inserted()
        val queued = screen.connection.ticket()
        screen.remove()
        repeat(5) { screen.show(queued) }
        screen.connection.observe("usb_storage", "")
        screen.show(screen.connection.ticket())
        assertEquals(0, screen.openings)
    }

    @Test fun `eject unmount removal bad-removal and detach each invalidate old callbacks`() {
        for (event in listOf("eject", "unmount", "removed", "bad removal", "detached")) {
            val screen = Screen()
            screen.connection.inserted()
            screen.connection.observe("PLAYLIST", "PLAYLIST")
            val copying = screen.connection.ticket()
            screen.show(copying)
            screen.remove()
            screen.show(copying) // e.g. read failed after the stick was pulled
            assertFalse(event, screen.visible)
            assertEquals(event, 1, screen.openings)
            assertFalse(event, screen.connection.current(copying))
        }
    }

    @Test fun `replug permits a new menu but never revives old results`() {
        val screen = Screen()
        screen.connection.inserted()
        val old = screen.connection.ticket()
        screen.show(old)
        screen.remove()
        screen.connection.inserted()
        val fresh = screen.connection.ticket()
        screen.show(old)
        assertFalse(screen.visible)
        screen.show(fresh)
        assertTrue(screen.visible)
        assertEquals(2, screen.openings)
        assertFalse(screen.connection.unchanged(old))
    }

    @Test fun `attach and mounted broadcasts do not reopen a dismissed menu`() {
        val screen = Screen()
        screen.connection.observe("", "")
        screen.connection.inserted()
        screen.show(screen.connection.ticket())
        screen.visible = false
        // The mount arrives after the card was opened by USB attach: this
        // is the same insertion, including ROMs that mount slowly.
        assertFalse(screen.connection.observe("PLAYLIST", "PLAYLIST").inserted)
        assertFalse(screen.connection.inserted())
        screen.show(screen.connection.ticket())
        assertFalse(screen.visible)
        assertEquals(1, screen.openings)
    }

    @Test fun `polling can discover a real new volume without a broadcast`() {
        val screen = Screen()
        screen.connection.observe("", "")
        assertTrue(screen.connection.observe("PLAYLIST", "PLAYLIST").inserted)
        screen.show(screen.connection.ticket())
        assertEquals(1, screen.openings)
        screen.visible = false
        assertFalse(screen.connection.observe("PLAYLIST", "PLAYLIST").inserted)
        screen.show(screen.connection.ticket())
        assertFalse(screen.visible)
    }

    @Test fun `an empty OEM mount directory cannot make a slow mount reopen the menu`() {
        val screen = Screen()
        screen.connection.observe("usb_storage", "")
        screen.connection.inserted(physicalAttach = true)
        screen.show(screen.connection.ticket())
        screen.visible = false
        screen.connection.observe("usb_storage", "")
        assertFalse(screen.connection.observe("PLAYLIST,usb_storage", "PLAYLIST").inserted)
        screen.show(screen.connection.ticket())
        assertFalse(screen.visible)
        assertEquals(1, screen.openings)
    }

    @Test fun `stale directories cannot lift removal but a remounted volume can`() {
        val screen = Screen()
        screen.connection.observe("PLAYLIST,usb_storage", "PLAYLIST")
        screen.remove()
        screen.connection.observe("PLAYLIST,usb_storage", "PLAYLIST") // stale StorageManager snapshot
        screen.show(screen.connection.ticket())
        assertFalse(screen.visible)
        screen.connection.observe("usb_storage", "")
        screen.show(screen.connection.ticket())
        assertFalse(screen.visible)
        assertTrue(screen.connection.observe("PLAYLIST,usb_storage", "PLAYLIST").inserted)
        screen.show(screen.connection.ticket())
        assertEquals(1, screen.openings)
    }

    @Test fun `an explicit manual request still works with no drive and ends on removal`() {
        val screen = Screen()
        screen.connection.observe("", "")
        val request = screen.connection.request()
        screen.show(request)
        screen.show(request) // LOOKING -> NO_DRIVE
        assertTrue(screen.visible)
        assertEquals(1, screen.openings)
        screen.remove()
        screen.show(request)
        assertFalse(screen.visible)
    }

    @Test fun `mouse and keyboard changes are not storage connections`() {
        assertFalse(UsbConnectionState.storageDevice(3, listOf(3)))
        assertFalse(UsbConnectionState.storageDevice(0, listOf(3, 3)))
        assertTrue(UsbConnectionState.storageDevice(8, emptyList()))
        assertTrue(UsbConnectionState.storageDevice(0, listOf(3, 8)))
    }
}
