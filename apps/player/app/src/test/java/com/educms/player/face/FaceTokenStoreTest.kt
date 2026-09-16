package com.educms.player.face

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * ONE TOKEN STORE PER SIDE (player reliability rule 3).
 *
 * The 1.1.6 fleet failure was three disagreeing token stores and a second
 * writer into the canonical one. A second WebView on the same box would
 * re-create it exactly: both faces reading and writing
 * `edu_player`/`device_token`, face B's mint becoming face A's credential,
 * a hard mutual 401 (the server binds a token's `sub` to the screen id),
 * and two content-dead panes whose native heartbeat still reports ONLINE.
 *
 * These lock the KEY DERIVATION, which is where the isolation lives. They
 * are pure — the `SharedPreferences` half needs an instrumented test and is
 * deliberately not faked here, because a fake prefs map would prove only
 * that the fake works.
 */
class FaceTokenStoreTest {

    // ─── the fleet-wide literal ───────────────────────────────────────

    @Test
    fun `face 0 resolves to the exact literal the whole fleet already uses`() {
        // ⚠️ THIS IS A LITERAL ON PURPOSE. A refactor that drifts this
        // string logs out every deployed screen AND breaks three readers
        // that never go through this file: HeartbeatService,
        // OtaUpdateWorker and UsbIngestActivity. Do not "clean this up"
        // into a reference to the constant it is checking.
        assertEquals("device_token", FaceTokenStore.tokenKey(0))
        assertEquals("screen_orientation", FaceTokenStore.orientationKey(0))
    }

    @Test
    fun `a negative or absent face index is still the primary`() {
        // Defensive: a caller that lost the index must land on the primary,
        // which is the pre-face behaviour, rather than inventing a face.
        assertEquals("device_token", FaceTokenStore.tokenKey(-1))
        assertEquals("device_token", FaceTokenStore.tokenKey(-99))
    }

    // ─── the isolation ────────────────────────────────────────────────

    @Test
    fun `every face gets a key of its own`() {
        val keys = (0 until FaceDisplayMap.MAX_FACES).map { FaceTokenStore.tokenKey(it) }
        assertEquals("no two faces may share a token slot", keys.size, keys.toSet().size)
        assertNotEquals(FaceTokenStore.tokenKey(0), FaceTokenStore.tokenKey(1))
        assertEquals("device_token_face1", FaceTokenStore.tokenKey(1))
        assertEquals("screen_orientation_face1", FaceTokenStore.orientationKey(1))
    }

    @Test
    fun `face keys stay inside the existing prefs key charset`() {
        // Underscore, never "::" — every other key in `edu_player` is
        // [a-z0-9_] and a colon pair would be the one odd one out.
        val re = Regex("^[a-z0-9_]+$")
        for (n in 0 until FaceDisplayMap.MAX_FACES) {
            assertTrue(FaceTokenStore.tokenKey(n), re.matches(FaceTokenStore.tokenKey(n)))
            assertTrue(FaceTokenStore.orientationKey(n), re.matches(FaceTokenStore.orientationKey(n)))
        }
    }

    // ─── the legacy DataStore migration is face-0-only ────────────────

    @Test
    fun `only the primary may migrate the legacy DataStore`() {
        // A face has no legacy history. Letting one read the legacy store
        // would hand the PRIMARY's fossil credential to side B — the 1.1.6
        // downgrade loop with extra steps.
        assertTrue(FaceTokenStore.usesLegacyMigration(0))
        for (n in 1 until FaceDisplayMap.MAX_FACES) {
            assertFalse("face $n must never read the legacy store", FaceTokenStore.usesLegacyMigration(n))
        }
    }

    // ─── DEVAUTH-01: the fingerprint is a name, not a credential ──────

    @Test
    fun `the face fingerprint mirrors the server's derivation`() {
        // Must equal the server's faceDeviceFingerprint() byte for byte, or
        // the face registers as a screen the dashboard cannot find.
        assertEquals(
            "android-abc123def456::face1",
            FaceTokenStore.faceFingerprint("android-abc123def456", 1),
        )
        assertEquals(
            "android-abc123def456::face2",
            FaceTokenStore.faceFingerprint("android-abc123def456", 2),
        )
    }

    @Test
    fun `the primary's fingerprint is passed through untouched`() {
        assertEquals("android-abc123def456", FaceTokenStore.faceFingerprint("android-abc123def456", 0))
    }

    @Test
    fun `a face fingerprint can never collide with its primary or a sibling`() {
        val primary = "android-abc123def456"
        val all = listOf(primary) + (1 until FaceDisplayMap.MAX_FACES)
            .map { FaceTokenStore.faceFingerprint(primary, it) }
        assertEquals(all.size, all.toSet().size)
    }
}
