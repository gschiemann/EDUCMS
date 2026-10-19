package com.educms.player.media

import org.json.JSONObject
import java.io.File

/*
 * ⚠️ STREAM B's COPY OF STREAM A's STORE INTERFACE — DELETE AT INTEGRATION.
 *
 * Stream A builds the one verified content store (design §5) at
 * `com.educms.player.store.ContentStoreApi`. Stream B (this file's owner, the
 * playback session) codes against the SAME interface so its build and tests
 * never wait on stream A. The lead deletes this file at integration and
 * points [ContentStorePort.store] at stream A's implementation; nothing in
 * `media/` names the stub type directly — every use goes through
 * [ContentStorePort.store].
 *
 * While the store answers `mode: off` (the stub, or stream A's store before
 * it has adopted anything), a v4 intent whose file is not in the store falls
 * back to today's native download path (`FaceVideoBox.NAMESPACE`, the
 * per-face verified copy), so phase 1 plays before the store is wired.
 */
internal interface ContentStoreApi {
    /** The verified file for [sha256], or null when the store does not hold it (never a partial file). */
    fun lookup(sha256: String): File?

    /** The current sets' large files that are verified on disk (bounded by the store). */
    fun readySet(): Set<String>

    /** The bounded `store` block of `sharedVideoState` (design §6): `mode`, `serve`, `generation`, `ready`, … */
    fun stateBlock(): JSONObject

    /** The current content sets, by face (sha256 per face), so the store knows what is in use and what to fetch next. */
    fun intend(currentSets: Map<Int, Set<String>>)

    /** Pin this emergency set (sha256 list); raise-never-release semantics live inside the store. */
    fun pinEmergency(set: Set<String>)

    /** The page applied a new manifest / emergency set: re-read the store's OWN authenticated sources if the tag differs. */
    fun onSync(tag: String, emergencySetHash: String?)

    /** The device credential changed tenant or screen: the store stops serving the old tenant at once. */
    fun onCredentialChanged()
}

/** The stub: a store that holds nothing and answers `mode: off`, so every v4 intent takes today's download path. */
internal object NoopContentStore : ContentStoreApi {
    const val MODE_OFF = "off"
    override fun lookup(sha256: String): File? = null
    override fun readySet(): Set<String> = emptySet()
    override fun stateBlock(): JSONObject = JSONObject().put("mode", MODE_OFF).put("serve", false).put("generation", 0)
    override fun intend(currentSets: Map<Int, Set<String>>) {}
    override fun pinEmergency(set: Set<String>) {}
    override fun onSync(tag: String, emergencySetHash: String?) {}
    override fun onCredentialChanged() {}
}

/** The one place the playback session reads the store from. The lead assigns stream A's store here at integration. */
internal object ContentStorePort {
    @Volatile var store: ContentStoreApi = NoopContentStore

    /** Whether the store is the real thing in a mode that holds files (`adopting` / `active`), read from its own block. */
    fun active(): Boolean = runCatching { store.stateBlock().optString("mode", NoopContentStore.MODE_OFF) != NoopContentStore.MODE_OFF }.getOrDefault(false)
}
