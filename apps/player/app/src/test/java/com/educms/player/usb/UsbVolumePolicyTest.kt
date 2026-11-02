package com.educms.player.usb

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** 1.1.56 — internal / emulated storage never counts as a USB drive (the false "No playlist" card on Android 7–9). */
class UsbVolumePolicyTest {
    private val internal = listOf("/storage/emulated/0")

    // A /proc/mounts as an Android 9 box shows it with one stick in.
    private val procMounts = """
        rootfs / rootfs ro,seclabel 0 0
        tmpfs /storage tmpfs rw,seclabel,nosuid 0 0
        tmpfs /mnt/usb_storage tmpfs rw 0 0
        /data/media /storage/emulated sdcardfs rw,nosuid 0 0
        /dev/block/vold/public:8,1 /mnt/media_rw/1A2B-3C4D vfat rw,dirsync 0 0
        /mnt/media_rw/1A2B-3C4D /storage/1A2B-3C4D sdcardfs rw,nosuid 0 0
        /dev/block/sda1 /mnt/usb_storage/USB_DISK0/udisk0 vfat rw 0 0
        /dev/block/sdb1 /mnt/media_rw/My\040Stick exfat rw 0 0
    """.trimIndent()

    private val mounts = UsbVolumePolicy.mountPoints(procMounts)

    @Test
    fun `mount points of real filesystems only, escapes decoded`() {
        assertTrue("/storage/1A2B-3C4D" in mounts)
        assertTrue("/mnt/media_rw/My Stick" in mounts)
        assertFalse("/storage" in mounts) // tmpfs
        assertFalse("/mnt/usb_storage" in mounts) // tmpfs
        assertFalse("/" in mounts) // rootfs
    }

    @Test
    fun `internal and emulated storage never counts, whatever reports it`() {
        for (p in listOf("/storage/emulated", "/storage/emulated/0", "/storage/self", "/storage/sdcard0", "/sdcard", "/mnt/sdcard", "/storage/emulated/legacy")) {
            assertFalse(p, UsbVolumePolicy.counts(p, p, internal, reportedRemovable = true, mountPoints = mounts, hasEntries = true))
        }
        // A ROM's USB path that is really a link to the internal storage.
        assertFalse(UsbVolumePolicy.counts("/mnt/usb_storage", "/storage/emulated/0", internal, reportedRemovable = false, mountPoints = mounts, hasEntries = true))
        assertFalse(UsbVolumePolicy.counts("/mnt/udisk", "/data/media/0", internal, reportedRemovable = false, mountPoints = null, hasEntries = true))
        assertTrue(UsbVolumePolicy.isInternal("/storage/primary", "/storage/primary", emptyList()))
    }

    @Test
    fun `no stick in — empty placeholder directories are not drives`() {
        val none = UsbVolumePolicy.mountPoints("tmpfs /storage tmpfs rw 0 0\n/data/media /storage/emulated sdcardfs rw 0 0")
        for (p in listOf("/storage/usbotg", "/storage/sdcard1", "/mnt/usb_storage", "/mnt/udisk", "/mnt/media_rw/usb0")) {
            assertFalse(p, UsbVolumePolicy.counts(p, p, internal, reportedRemovable = false, mountPoints = none, hasEntries = false))
            assertFalse(p, UsbVolumePolicy.counts(p, p, internal, reportedRemovable = false, mountPoints = none, hasEntries = true))
        }
        // /proc/mounts unreadable: an empty directory still is not a drive.
        assertFalse(UsbVolumePolicy.counts("/storage/usbotg", "/storage/usbotg", internal, reportedRemovable = false, mountPoints = null, hasEntries = false))
    }

    @Test
    fun `a real stick counts — reported, mounted at the path, or mounted below it`() {
        assertTrue(UsbVolumePolicy.counts("/storage/1A2B-3C4D", "/storage/1A2B-3C4D", internal, reportedRemovable = true, mountPoints = null, hasEntries = false))
        assertTrue(UsbVolumePolicy.counts("/storage/1A2B-3C4D", "/storage/1A2B-3C4D", internal, reportedRemovable = false, mountPoints = mounts, hasEntries = false))
        assertTrue(UsbVolumePolicy.counts("/mnt/usb_storage", "/mnt/usb_storage", internal, reportedRemovable = false, mountPoints = mounts, hasEntries = true))
        assertTrue(UsbVolumePolicy.counts("/mnt/media_rw/My Stick", "/mnt/media_rw/My Stick", internal, reportedRemovable = false, mountPoints = mounts, hasEntries = true))
        assertTrue(UsbVolumePolicy.counts("/mnt/udisk", "/mnt/udisk", internal, reportedRemovable = false, mountPoints = null, hasEntries = true))
    }
}
