package com.educms.player.usb

/** A menu belongs to a connection (or an explicit request), never to a scan.
 * Removal invalidates queued UI work; startup and repeated scans cannot open
 * a card. No imported content is deleted when the stick is removed. */
internal class UsbConnectionState {
    data class Ticket(val generation: Long)
    data class Change(val inserted: Boolean = false, val removed: Boolean = false)
    private var generation = 0L
    private var connected: Boolean? = null
    private var opening = false
    private var awaitingVolume = false
    private var requested = false
    private var drives: String? = null
    private var mounted: String? = null

    @Synchronized fun inserted(): Boolean {
        if (connected == true) return false // attach + mount describe one connection
        generation++
        connected = true
        opening = true
        awaitingVolume = true
        requested = false
        return true
    }

    @Synchronized fun removed() {
        generation++
        connected = false
        opening = false
        awaitingVolume = false
        requested = false
    }

    /** Polling still detects ROMs that omit broadcasts. Only a newly mounted
     * volume (or a drive appearing after absence) can lift a removal barrier;
     * leftover /mnt directories are not another insertion. */
    @Synchronized fun observe(now: String, mountedNow: String): Change {
        val first = drives == null
        val disappeared = !first && ((!drives.isNullOrEmpty() && now.isEmpty()) ||
            (!mounted.isNullOrEmpty() && mountedNow.isEmpty()))
        val added = !first && (UsbImportPolicy.newDrive(mounted, mountedNow) ||
            (UsbImportPolicy.newDrive(drives, now) && (connected != false || drives.isNullOrEmpty())))
        var change = Change()
        if (disappeared && connected != false) {
            // An explicit "Import from USB" with no drive may update its
            // existing LOOKING card to NO_DRIVE. A removal broadcast cancels
            // it separately and always wins.
            if (requested) connected = false else { removed(); change = Change(removed = true) }
        } else if (added && !awaitingVolume) {
            generation++
            connected = true
            opening = true
            requested = false
            change = Change(inserted = true)
        } else if (connected == null) connected = now.isNotEmpty()
        // A leftover /mnt directory is not the volume finishing its mount.
        // Keep attach + its later real mount in the same connection.
        if (mountedNow.isNotEmpty()) awaitingVolume = false
        drives = now
        mounted = mountedNow
        return change
    }

    @Synchronized fun request(): Ticket {
        generation++
        opening = true
        requested = true
        return Ticket(generation)
    }

    @Synchronized fun ticket(): Ticket = Ticket(generation)
    @Synchronized fun unchanged(ticket: Ticket): Boolean = ticket.generation == generation
    @Synchronized fun current(ticket: Ticket): Boolean = ticket.generation == generation && (connected != false || requested)
    @Synchronized fun mayOpen(ticket: Ticket): Boolean = current(ticket) && opening
    @Synchronized fun shown(ticket: Ticket) { if (ticket.generation == generation) opening = false }

    companion object {
        private const val MASS_STORAGE_CLASS = 8
        /** USB mice/keyboards are not drives, including composite devices. */
        fun storageDevice(deviceClass: Int, interfaces: Collection<Int>): Boolean =
            deviceClass == MASS_STORAGE_CLASS || MASS_STORAGE_CLASS in interfaces
    }
}
