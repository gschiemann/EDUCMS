package com.educms.player.display

import android.content.Context
import com.educms.player.logging.PlayerLogger
import java.io.File

/**
 * Real panel backlight via the kernel's sysfs node — the only mechanism
 * in the brightness chain that actually saves power on an LCD.
 *
 * Most boxes expose `/sys/class/backlight/<device>/brightness` but
 * restrict it to root/system via SELinux, so `canWrite()` is false for
 * our uid and this provider correctly declines.
 *
 * ⚠️ THE PROBE AND THIS PROVIDER MUST AGREE, AND THEY NO LONGER AGREE
 * "BY CONSTRUCTION" — that claim used to be in this header and it was
 * FALSE: [DisplayCapabilityProbe] stat-ed the raw path with
 * `File.canWrite()` while this provider additionally pushed it through
 * [RecipeAllowlist.canonicalSysfsPath], so the probe could report
 * `brightness:"sysfs"` (lighting up a real backlight slider in the
 * dashboard) on a box where this provider had silently dropped the node
 * and BRIGHTNESS had fallen to software dim. They agree now because the
 * probe's verdict is DERIVED FROM [DisplayControlRegistry.capabilities]
 * — one resolver, one answer — not because two code paths were eyeballed
 * into matching. See the `control` section in the probe.
 *
 * Discovery is confined to [RecipeAllowlist.SYSFS_ROOTS] and every
 * candidate is put through [RecipeAllowlist.canonicalSysfsPath] even
 * though the path is ours, not a recipe's. One gate, one code path: a
 * future change that widens discovery cannot accidentally bypass the
 * check the untrusted path goes through.
 */
object SysfsBacklightProvider : DisplayControlProvider {

    private const val TAG = "SysfsBacklight"

    override val id: String = "sysfs-backlight"

    /**
     * Resolved node + its scale. Null means "looked, found nothing".
     *
     * BOTH paths are kept on purpose. [classPath] is the
     * `/sys/class/backlight/<dev>/brightness` form the gate expects as
     * INPUT; [resolvedPath] is what the gate returned and what we
     * actually open (on real hardware that is a `/sys/devices/...` path,
     * because the class entry is a symlink). Re-validating the RESOLVED
     * path at point of use would fail the gate's class-root shape test —
     * which is exactly the trap the gate's own header warns about.
     */
    data class Node(val classPath: String, val resolvedPath: String, val max: Int)

    @Volatile
    private var cached: Node? = null

    @Volatile
    private var scanned = false

    override fun supports(ctx: Context): Set<Capability> =
        if (node() != null) setOf(Capability.BRIGHTNESS) else emptySet()

    override fun apply(ctx: Context, action: DisplayAction): ActionResult {
        if (action !is DisplayAction.SetBrightness) {
            return ActionResult.Unsupported("sysfs backlight only handles brightness")
        }
        val n = node() ?: return ActionResult.Unsupported("no writable backlight node on this device")
        // Re-validate at the point of USE, from the CLASS path. The path
        // was validated at discovery, but a cached value outliving a
        // remount/symlink swap is exactly the class of bug this gate
        // exists for — and re-running the gate is also what re-resolves
        // the symlink, so a node that was swapped underneath us gets
        // caught here rather than written to blindly.
        val canonical = RecipeAllowlist.canonicalSysfsPath(n.classPath)
            ?: return ActionResult.Failed("backlight path failed re-validation", id)

        // Never write a hard 0 to a real backlight unless the operator
        // explicitly asked for black — on many panels 0 latches the
        // backlight driver off and only a power cycle brings it back.
        val floor = if (action.allowBlack) 0 else 1
        val target = DisplayLimits.scale(action.percent, 0, n.max).coerceAtLeast(floor)

        return try {
            File(canonical).writeText(target.toString())
            PlayerLogger.i(TAG, "brightness ${action.percent}% → $target/${n.max} at $canonical")
            ActionResult.Ok(id, "$target/${n.max}")
        } catch (t: Throwable) {
            // Almost always EACCES from SELinux. Invalidate so the next
            // capabilities read stops advertising a node we cannot drive.
            PlayerLogger.w(TAG, "write to $canonical failed: ${t.message}")
            invalidate()
            ActionResult.Failed(t.message ?: t.javaClass.simpleName, id)
        }
    }

    fun invalidate() {
        cached = null
        scanned = false
    }

    /** Scan once, cache the answer (including "none"). */
    private fun node(): Node? {
        if (scanned) return cached
        synchronized(this) {
            if (scanned) return cached
            cached = scan()
            scanned = true
            return cached
        }
    }

    private fun scan(): Node? = try {
        val root = File("/sys/class/backlight")
        val devices = if (root.isDirectory) root.listFiles()?.toList().orEmpty() else emptyList()
        var found: Node? = null
        for (dev in devices) {
            // `/sys/class/backlight/<dev>/brightness` — the CLASS form,
            // which is what the gate takes as input. Built from the
            // parent's path rather than the listed File's absolutePath so
            // it is always the class form even if listFiles() ever starts
            // handing back resolved entries.
            val classPath = "/sys/class/backlight/${dev.name}/brightness"
            val brightness = File(dev, "brightness")
            if (!brightness.exists() || !brightness.canWrite()) continue
            val resolved = RecipeAllowlist.canonicalSysfsPath(classPath) ?: continue
            val max = readInt(File(dev, "max_brightness")) ?: 255
            if (max <= 0) continue
            found = Node(classPath, resolved, max)
            PlayerLogger.i(TAG, "writable backlight node $classPath → $resolved (max=$max)")
            break
        }
        if (found == null) PlayerLogger.i(TAG, "no writable backlight node — brightness falls through")
        found
    } catch (t: Throwable) {
        PlayerLogger.w(TAG, "backlight scan failed: ${t.message}")
        null
    }

    private fun readInt(f: File): Int? = try {
        if (f.exists() && f.canRead()) f.readText().trim().toIntOrNull() else null
    } catch (t: Throwable) {
        null
    }
}
