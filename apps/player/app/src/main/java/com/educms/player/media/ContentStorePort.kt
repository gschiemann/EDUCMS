package com.educms.player.media

import com.educms.player.store.ContentStoreApi
import com.educms.player.store.NoopContentStore

/*
 * THE ONE PLACE THE PLAYBACK SESSION READS THE CONTENT STORE FROM (design §5).
 *
 * 1.1.51 — integrated. Until this build the file carried stream B's own COPY
 * of `com.educms.player.store.ContentStoreApi` + `NoopContentStore` (so the
 * session could build before the store existed), nothing ever assigned
 * [ContentStorePort.store], and the two copies were different types — so the
 * assignment would not even have compiled. Now there is ONE interface and ONE
 * stub (`store/ContentStoreApi.kt`), and `PlayerApp.onCreate` assigns
 * `AndroidContentStore.start(...)` here.
 *
 * While the store answers `mode: off` (the stub, or the real store before a
 * face's authenticated manifest names it — `nativeVideo.store === true`,
 * `PLAYER_CONTENT_STORE` on the API), a v4 intent whose file is not in the
 * store falls back to today's native download path (`FaceVideoBox.NAMESPACE`,
 * the per-face verified copy). Nothing in `media/` names the stub type
 * directly — every use goes through [ContentStorePort.store].
 */
internal object ContentStorePort {
    @Volatile var store: ContentStoreApi = NoopContentStore

    /** Whether the store is the real thing in a mode that holds files (`adopting` / `active`), read from its own block. */
    fun active(): Boolean = runCatching { store.stateBlock().optString("mode", NoopContentStore.MODE_OFF) != NoopContentStore.MODE_OFF }.getOrDefault(false)
}
