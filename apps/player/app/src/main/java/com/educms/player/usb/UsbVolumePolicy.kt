package com.educms.player.usb

/**
 * Which directories count as a USB drive (1.1.56) — pure, JVM-tested.
 *
 * Field: on Android 7–9 boxes with NO stick in, the card said "No playlist
 * on this drive". The fallback scan of `/storage`, `/mnt/usb_storage`, … (for
 * ROMs whose StorageManager does not list USB disks) counted placeholder
 * directories and, on some ROMs, links back to the internal storage as
 * drives. Rules now:
 *
 *  1. Internal / emulated storage NEVER counts — by path (`/storage/emulated`,
 *     `/sdcard`, `/data`, …), by name, and by its canonical path matching the
 *     device's own primary storage (a ROM's `/mnt/usb_storage` symlinked to
 *     `/storage/emulated/0` is internal storage).
 *  2. A volume StorageManager reports as removable, mounted, not primary and
 *     not emulated counts.
 *  3. A fallback directory counts only when a real filesystem is MOUNTED at
 *     it or below it (`/proc/mounts`). Where `/proc/mounts` cannot be read,
 *     only a directory that has something in it counts — an empty mount
 *     point is not a drive.
 */
object UsbVolumePolicy {

    private val INTERNAL_PREFIXES = listOf(
        "/storage/emulated", "/storage/self", "/storage/sdcard0", "/storage/enc_emulated",
        "/sdcard", "/mnt/sdcard", "/data", "/system", "/vendor", "/product",
        "/mnt/runtime", "/mnt/user", "/mnt/shell", "/mnt/secure", "/mnt/asec", "/mnt/obb",
        "/mnt/expand", "/mnt/pass_through", "/mnt/installer", "/mnt/androidwritable", "/mnt/appfuse",
        "/mnt/media_rw/emulated",
    )

    /** Names that are never a stick (placeholders and links to the internal storage). */
    private val INTERNAL_NAMES = setOf("emulated", "self", "sdcard", "sdcard0", "enc_emulated", "legacy", "primary", "internal", "0")

    /** Not a disk: nothing a person plugs in is mounted with these. */
    private val VIRTUAL_FS = setOf(
        "tmpfs", "ramfs", "rootfs", "proc", "sysfs", "cgroup", "cgroup2", "debugfs", "tracefs", "selinuxfs",
        "pstore", "configfs", "functionfs", "devpts", "binfmt_misc", "bpf", "securityfs", "fusectl", "mqueue",
        "devtmpfs", "autofs", "nsfs", "overlay", "incremental-fs",
    )

    private fun under(path: String, prefix: String): Boolean = path == prefix || path.startsWith("$prefix/")

    /** Rule 1. [internalRoots] = canonical paths of the device's own (primary / emulated) storage. */
    fun isInternal(path: String, canonicalPath: String, internalRoots: Collection<String>): Boolean {
        for (p in listOf(path, canonicalPath)) {
            val name = p.trimEnd('/').substringAfterLast('/').lowercase()
            if (name in INTERNAL_NAMES) return true
            if (INTERNAL_PREFIXES.any { under(p, it) }) return true
            // The drive IS the internal storage, lies inside it, or holds it.
            if (internalRoots.any { r -> r.isNotEmpty() && (under(p, r) || under(r, p)) }) return true
        }
        return false
    }

    /**
     * Rules 2–3.
     * @param reportedRemovable StorageManager: removable, mounted, not primary, not emulated.
     * @param mountPoints real (non-virtual) mount points from `/proc/mounts`; null = unreadable.
     * @param hasEntries the directory lists at least one entry.
     */
    fun counts(
        path: String,
        canonicalPath: String,
        internalRoots: Collection<String>,
        reportedRemovable: Boolean,
        mountPoints: Set<String>?,
        hasEntries: Boolean,
    ): Boolean {
        if (isInternal(path, canonicalPath, internalRoots)) return false
        if (reportedRemovable) return true
        if (mountPoints == null) return hasEntries
        return mountPoints.any { m ->
            !isInternal(m, m, internalRoots) && (under(m, path) || under(m, canonicalPath))
        }
    }

    /** Real filesystems' mount points in a `/proc/mounts` text (octal escapes like `\040` decoded). */
    fun mountPoints(procMounts: String): Set<String> {
        val out = HashSet<String>()
        for (line in procMounts.lineSequence()) {
            val parts = line.trim().split(Regex("\\s+"))
            if (parts.size < 3) continue
            if (parts[2].lowercase() in VIRTUAL_FS) continue
            out += decode(parts[1]).trimEnd('/').ifEmpty { "/" }
        }
        return out
    }

    private fun decode(s: String): String = Regex("\\\\([0-7]{3})").replace(s) { it.groupValues[1].toInt(8).toChar().toString() }
}
