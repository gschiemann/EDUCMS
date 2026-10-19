package com.educms.player.store

import org.json.JSONObject
import java.io.File

/**
 * THE ONE VERIFIED CONTENT STORE — the facade every other part of the app reads
 * (design `docs/design/NATIVE-FIRST-ONE-STORE.md` §5–§6, phase 0 + phase 1).
 *
 * ⚠️ Stream B codes against an IDENTICAL copy of this interface
 * (`media/ContentStorePort.kt`). The method names and signatures here must
 * stay exactly the same, so the lead wires this store in by replacing one
 * import and assigning [ContentStore] to `ContentStorePort.store`.
 *
 * Every method is cheap and never touches the network: downloads, hashing and
 * the store's own authenticated reads run on the store's single worker thread.
 */
internal interface ContentStoreApi {
    /**
     * The VERIFIED file for [sha256] in a tenant directory a current credential
     * is bound to, or null. Never a partial file, never a file whose size,
     * mtime or inode moved since it was hashed (that one is re-hashed first).
     */
    fun lookup(sha256: String): File?

    /** The verified shas the server currently names for this device, current sets first (≤ 64). */
    fun readySet(): Set<String>

    /** The bounded `store` block of `sharedVideoState` (design §6). */
    fun stateBlock(): JSONObject

    /**
     * The page's current content per face: face → shas, ITERATION ORDER = PLAY
     * ORDER (pass a LinkedHashSet / `linkedSetOf`). Identity only: the store
     * downloads a sha only when its OWN authenticated manifest names it. A face
     * missing from the map keeps its previous set.
     */
    fun intend(currentSets: Map<Int, Set<String>>)

    /** Raise-only: pins these emergency shas. Never removes a pin (design §5.5 / §7 E3). */
    fun pinEmergency(set: Set<String>)

    /**
     * The page applied a manifest / emergency set. The store re-reads its OWN
     * authenticated sources only when [tag] (the manifest ETag) or
     * [emergencySetHash] differ from what it already holds — single-flight and
     * rate-limited. Carries no URL: the page can never add a file.
     */
    fun onSync(tag: String, emergencySetHash: String?)

    /** A face's credential changed: the old tenant stops being served at once (purged once the new tenant is confirmed). */
    fun onCredentialChanged()
}

/** The store that holds nothing: `mode: off`, so every caller takes today's path. */
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
