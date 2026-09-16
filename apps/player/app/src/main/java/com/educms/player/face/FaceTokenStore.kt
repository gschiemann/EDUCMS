package com.educms.player.face

import android.content.Context
import com.educms.player.logging.PlayerLogger
import com.educms.player.resolveNativeToken

/**
 * ONE TOKEN STORE PER SIDE (player reliability rule 3), namespaced at the
 * OWNER so a face is STRUCTURALLY unable to address the primary's slot.
 *
 * ─────────────────────────────────────────────────────────────────────
 * WHY THE NAMESPACE LIVES HERE AND NOT AT THE CALL SITE
 * ─────────────────────────────────────────────────────────────────────
 * The 1.1.6 fleet failure was three disagreeing token stores and a second
 * writer into the canonical one. A second WebView on the same box is the
 * same bug waiting to happen: both faces would read and write
 * `edu_player`/`device_token`, so face B's mint would become face A's
 * credential, the server would reject it (`sub` is bound to the screen id)
 * and both panes would settle into a mutual 401 loop — content-dead screens
 * whose native heartbeat still reports ONLINE.
 *
 * Deriving the key from the face index at the one place that owns it means
 * a call site cannot type the primary's key by accident.
 *
 * ─────────────────────────────────────────────────────────────────────
 * ⚠️ FACE 0 RETURNS TODAY'S LITERALS, BYTE FOR BYTE
 * ─────────────────────────────────────────────────────────────────────
 * `tokenKey(0) == "device_token"` is asserted as a LITERAL in
 * `FaceTokenStoreTest`, because a refactor that drifts that string logs out
 * the entire deployed fleet and breaks three readers that are not on this
 * code path at all: `HeartbeatService`, `OtaUpdateWorker` and
 * `UsbIngestActivity`. No migration runs, and no single-sided screen sees
 * any change whatsoever from this file existing.
 *
 * Underscore rather than `::` so the key stays inside the charset every
 * other `edu_player` key uses.
 *
 * ─────────────────────────────────────────────────────────────────────
 * ⚠️ THE LEGACY DATASTORE MIGRATION IS FACE-0-ONLY
 * ─────────────────────────────────────────────────────────────────────
 * A face has no legacy history. Letting one read the legacy
 * `edu_cms_player` DataStore would hand the PRIMARY's fossil credential to
 * side B — the 1.1.6 downgrade loop with extra steps. So [resolve] for a
 * face passes `getLegacyToken = { null }` and `clearLegacyToken = {}`, and
 * `MainActivity.resolveDeviceToken()` keeps owning face 0's migration
 * exactly as it does today. [resolveNativeToken] itself needs no edit: it
 * is already pure over four injected lambdas, which is precisely the seam.
 *
 * ─────────────────────────────────────────────────────────────────────
 * ⚠️ DEVAUTH-01 STANDS
 * ─────────────────────────────────────────────────────────────────────
 * [faceFingerprint] is a NAMING CONVENTION and grants nothing. A face
 * registers and earns its own credential exactly like any other screen;
 * fingerprint knowledge never upgrades a credential. The string only exists
 * so one physical box's faces are recognisable as one box in forensics, and
 * so the native side can compute what the server derives without being told.
 *
 * A face also NEVER writes `device_fingerprint` or `api_root`: those key the
 * per-box `HeartbeatService`, `OtaUpdateWorker` and diagnostics upload, and
 * a face repointing them would repoint the whole unit's telemetry at one
 * pane. (Enforced structurally — a face's bridge is built with
 * `onSetBootstrap` refusing; see `FacePlayerHost`.)
 */
object FaceTokenStore {

    private const val TAG = "FaceTokenStore"

    /** The shared native prefs file every subsystem uses. */
    const val PREFS_NAME = "edu_player"

    /** THE canonical primary key. Never change this string. */
    const val PRIMARY_TOKEN_KEY = "device_token"

    /** The primary's orientation key. Orientation is per face (contract §5). */
    const val PRIMARY_ORIENTATION_KEY = "screen_orientation"

    /**
     * The prefs key holding [faceIndex]'s device JWT.
     *
     * Face 0 → the literal the whole fleet, the OTA worker, the heartbeat
     * service and USB ingest already read.
     */
    fun tokenKey(faceIndex: Int): String =
        if (faceIndex <= 0) PRIMARY_TOKEN_KEY else "${PRIMARY_TOKEN_KEY}_face$faceIndex"

    /** Per-face orientation. See [applyOrientation]'s limits in FacePresentation. */
    fun orientationKey(faceIndex: Int): String =
        if (faceIndex <= 0) PRIMARY_ORIENTATION_KEY else "${PRIMARY_ORIENTATION_KEY}_face$faceIndex"

    /**
     * May this face migrate the legacy `edu_cms_player` DataStore forward?
     *
     * Face 0 only, and the negative case is the safety property — see the
     * header. Expressed as a predicate so the rule is testable rather than
     * implied by which lambdas a call site happened to pass.
     */
    fun usesLegacyMigration(faceIndex: Int): Boolean = faceIndex <= 0

    /**
     * The device fingerprint a face's page identifies itself with.
     *
     * Mirrors the server's `faceDeviceFingerprint()`:
     * `<primary fingerprint>::face<N>`. Face 0 is the primary's own, unchanged.
     *
     * ⚠️ Knowing this string grants NOTHING (DEVAUTH-01).
     */
    fun faceFingerprint(primaryFingerprint: String, faceIndex: Int): String =
        if (faceIndex <= 0) primaryFingerprint else "$primaryFingerprint::face$faceIndex"

    // ─── prefs access. Every call wrapped; a token read must never throw ──
    //
    // A failure degrades to "this face has no native token", which is the
    // fresh-install case the web player's own register/pair flow already
    // handles — the same posture MainActivity.resolveDeviceToken() takes.

    private fun prefs(ctx: Context) = runCatching {
        ctx.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    }.getOrNull()

    fun read(ctx: Context, faceIndex: Int): String? = runCatching {
        prefs(ctx)?.getString(tokenKey(faceIndex), null)
    }.getOrNull()

    fun write(ctx: Context, faceIndex: Int, token: String) {
        runCatching { prefs(ctx)?.edit()?.putString(tokenKey(faceIndex), token)?.apply() }
            .onFailure { PlayerLogger.w(TAG, "face $faceIndex token write failed: ${it.message}") }
    }

    /**
     * Resolve the token to hand this face's page.
     *
     * A face never touches the legacy DataStore (see the header), so unlike
     * the primary's path this needs no coroutine at all.
     *
     * @return the token, or "" when this face has never paired — which is
     *   the normal first-boot case; the page's own register/pair flow then
     *   shows a pairing code on THAT panel's glass.
     */
    fun resolve(ctx: Context, faceIndex: Int): String {
        if (usesLegacyMigration(faceIndex)) {
            // Face 0's resolution (including the one-way legacy migration
            // and its suspend clear) is owned by MainActivity and is
            // deliberately NOT duplicated here.
            return read(ctx, faceIndex).orEmpty()
        }
        return resolveNativeToken(
            getPrefsToken = { read(ctx, faceIndex) },
            // ⚠️ A FACE HAS NO LEGACY HISTORY. Reading the legacy store here
            // would hand the PRIMARY's fossil credential to this face.
            getLegacyToken = { null },
            writePrefsToken = { write(ctx, faceIndex, it) },
            clearLegacyToken = { /* nothing to clear — see above */ },
        ).orEmpty()
    }

    /**
     * Forget ONE face's credential.
     *
     * ⚠️ Deliberately does NOT call `DeviceStore.clear()`. That store holds
     * the BOX's `usb_ingest_key` and tenant ids; wiping it because one pane
     * was unpaired would take the sneakernet keys of a screen nobody
     * unpaired. Unpairing the PRIMARY is a different operation and stays in
     * `MainActivity.unpairAndRestart`, which additionally clears every
     * face (see [clearEveryFace]).
     */
    fun clearFace(ctx: Context, faceIndex: Int) {
        if (faceIndex <= 0) {
            PlayerLogger.w(TAG, "clearFace(0) refused — the primary is unpaired by MainActivity")
            return
        }
        runCatching { prefs(ctx)?.edit()?.remove(tokenKey(faceIndex))?.apply() }
            .onFailure { PlayerLogger.w(TAG, "face $faceIndex token clear failed: ${it.message}") }
    }

    /**
     * Unpairing the PRIMARY unpairs the whole physical unit.
     *
     * The box has one operator-visible identity; leaving a face holding a
     * live credential after the front was revoked is precisely the
     * "resurrection" shape W2-1 closed on the primary.
     */
    fun clearEveryFace(ctx: Context) {
        for (n in 1 until FaceDisplayMap.MAX_FACES) clearFace(ctx, n)
    }
}
