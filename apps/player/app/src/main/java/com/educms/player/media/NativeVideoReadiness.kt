package com.educms.player.media

/** UI-thread observations published atomically to the read-only bridge. */
internal class NativeVideoReadiness {
    data class Snapshot(val foreground: Boolean, val interactive: Boolean, val focused: Boolean, val uiClear: Boolean, val epoch: Long, val focusRequired: Boolean = true) {
        val ready: Boolean get() = foreground && interactive && (!focusRequired || focused) && uiClear
    }
    @Volatile var snapshot = Snapshot(false, false, false, false, 0)
        private set

    fun observe(foreground: Boolean, interactive: Boolean, focused: Boolean, uiClear: Boolean, focusRequired: Boolean = true): Snapshot {
        val old = snapshot
        val next = Snapshot(foreground, interactive, focused, uiClear, old.epoch, focusRequired)
        snapshot = if (next.ready && !old.ready) next.copy(epoch = old.epoch + 1) else next
        return snapshot
    }
}
