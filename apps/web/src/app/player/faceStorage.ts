/**
 * PER-FACE STORAGE KEYS — the web half of "one token store per side"
 * (player reliability rule 3), for double-sided displays (2026-09-16).
 *
 * ═══════════════════════════════════════════════════════════════════════
 * WHY THE NAMESPACE HAS TO LIVE IN THE KEY
 * ═══════════════════════════════════════════════════════════════════════
 * A second face is a second WebView in the SAME Android process loading the
 * SAME origin, so the two share one `localStorage` outright. There is no
 * partition to escape into: `setDataDirectorySuffix` appears nowhere in the
 * APK, the manifest declares no `android:process`, and that API is 28+ (the
 * DH43 board is SDK 25) and per-process anyway. So the only place the
 * separation can live is the key itself.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * WHAT HAPPENS WITHOUT IT — a hard mutual 401, not a soft degradation
 * ═══════════════════════════════════════════════════════════════════════
 * `persistDeviceToken` writes the token key unconditionally, and
 * `resolveDeviceToken` returns the stored value outright under the
 * stored-wins rule (W1-12). So face A's next manifest poll, WS HELLO and
 * render proof would carry face B's credential; the server binds a token's
 * `sub` to the screen id and answers 401; recovery is capped at one attempt
 * per 60 s. Both panes settle into a mutual 401 loop that emits nothing but
 * audit rows — content-dead screens whose native heartbeat still reports
 * ONLINE, which is the exact 1.1.6 signature.
 *
 * Sharing the FINGERPRINT key is worse still: `getDeviceFingerprint()` lets
 * `?fp=` win AND writes it, so both panes would resolve to ONE `Screen` row
 * with one render proof, one `lastPingAt` and one `authState`.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * ⚠️ FACE 0 DERIVES TODAY'S LITERALS, BYTE FOR BYTE
 * ═══════════════════════════════════════════════════════════════════════
 * Every key below returns the exact string the fleet uses today when the
 * face index is 0 — asserted literal-by-literal in `faceStorage.test.ts`.
 * That is what makes this change invisible to the ~all single-sided fleet:
 * not one deployed screen is logged out, re-pairs, or loses a cached
 * manifest or emergency payload on this deploy.
 *
 * PURE — no React, no `window` — so it is exhaustively testable without
 * mounting the 13k-line player page, the same contract `trustGuards.ts` and
 * `sync/` follow.
 */

/** The query parameter the Android shell appends for a face's WebView. */
export const FACE_PARAM = 'face';

/**
 * Highest face index we will honour. Mirrors the server's
 * `MAX_FACES_PER_UNIT` (4 faces: the primary plus three sides).
 *
 * Anything outside the range clamps to the PRIMARY rather than erroring: a
 * garbled `?face=` must land a screen on the ordinary single-sided path,
 * never on a face nobody configured.
 */
export const MAX_FACE_INDEX = 3;

/** The separator between a base key and its face. */
export const FACE_SUFFIX = '__face';

/**
 * Read `?face=N` out of a query string.
 *
 * Non-numeric, absent, negative, fractional and out-of-range all answer 0 —
 * the primary — because every one of those means "we do not know which face
 * this is", and the only safe answer to that is the behaviour every
 * single-sided screen already has.
 */
export function faceIndexFromSearch(search?: string | null): number {
  if (!search) return 0;
  let raw: string | null = null;
  try {
    raw = new URLSearchParams(search).get(FACE_PARAM);
  } catch {
    return 0;
  }
  if (raw === null) return 0;
  const trimmed = raw.trim();
  // `Number('')` is 0 and `Number(' ')` is 0 — both would silently pass, so
  // demand digits and nothing else.
  if (!/^\d+$/.test(trimmed)) return 0;
  const n = Number(trimmed);
  if (!Number.isInteger(n) || n < 0 || n > MAX_FACE_INDEX) return 0;
  return n;
}

/**
 * Namespace one storage key to a face.
 *
 * ⚠️ Face 0 returns `base` UNCHANGED. Do not "simplify" this into an
 * unconditional suffix: that single change would log out, un-pair and
 * force a full re-precache on every screen in the fleet at once.
 */
export function faceKey(base: string, faceIndex: number): string {
  return faceIndex > 0 ? `${base}${FACE_SUFFIX}${faceIndex}` : base;
}

/** Every per-face `localStorage` key, derived in one place. */
export interface FaceStorageKeys {
  /** The device JWT — the credential of record for this face. */
  token: string;
  /** This face's device fingerprint (`<primary>::faceN` on a face). */
  fingerprint: string;
  /** Last good manifest, for a cold offline boot. */
  manifestCache: string;
  /** ⚠️ Last known emergency override. Life-safety; never shared. */
  emergencyCache: string;
  /** REFRESH_WEB acknowledgement, matched by VALUE identity (rule 6). */
  refreshAck: string;
  /** The API root this face talks to. */
  apiRoot: string;
  /** Canvas geometry — per face, because the panels genuinely differ. */
  canvasW: string;
  canvasH: string;
  /** Cached LED poster standard, read by the boot pin script. */
  posterStandard: string;
}

/**
 * The bases. These strings ARE the fleet's current keys; the test asserts
 * each one, because a typo here is indistinguishable from a fleet-wide
 * logout.
 */
const BASE = {
  token: 'edu_device_token',
  fingerprint: 'edu_device_fp',
  manifestCache: 'edu_manifest_cache_v1',
  emergencyCache: 'edu_emergency_cache_v1',
  refreshAck: 'edu_refresh_ack',
  apiRoot: 'edu_api_root',
  canvasW: 'edu_canvasW',
  canvasH: 'edu_canvasH',
  posterStandard: 'edu_posterStandard',
} as const;

export function faceKeys(faceIndex: number): FaceStorageKeys {
  return {
    token: faceKey(BASE.token, faceIndex),
    fingerprint: faceKey(BASE.fingerprint, faceIndex),
    manifestCache: faceKey(BASE.manifestCache, faceIndex),
    emergencyCache: faceKey(BASE.emergencyCache, faceIndex),
    refreshAck: faceKey(BASE.refreshAck, faceIndex),
    apiRoot: faceKey(BASE.apiRoot, faceIndex),
    canvasW: faceKey(BASE.canvasW, faceIndex),
    canvasH: faceKey(BASE.canvasH, faceIndex),
    posterStandard: faceKey(BASE.posterStandard, faceIndex),
  };
}

/**
 * This face's device fingerprint, derived from the primary's.
 *
 * Mirrors the server's `faceDeviceFingerprint()` and the APK's
 * `FaceTokenStore.faceFingerprint()` — all three must agree or a face
 * registers as a screen the dashboard cannot find.
 *
 * ⚠️ DEVAUTH-01: knowing this string grants NOTHING. It is a naming
 * convention, never an authentication input; the face registers and earns
 * its own credential exactly like any other screen.
 */
export function faceFingerprint(primaryFingerprint: string, faceIndex: number): string {
  return faceIndex > 0 ? `${primaryFingerprint}::face${faceIndex}` : primaryFingerprint;
}

/** True when this document is a secondary face rather than the primary. */
export function isFace(faceIndex: number): boolean {
  return faceIndex > 0;
}
