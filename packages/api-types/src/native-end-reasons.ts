/**
 * THE CLOSED SET OF NATIVE END REASONS — phase 0 of native-first
 * (design `docs/design/NATIVE-FIRST-ONE-STORE.md` §3.4 / §1.2; owner
 * decision D7, 2026-10-19).
 *
 * Every reason the Android app's native video engine reports when a session
 * ends is a member of exactly ONE set below. The APK's table
 * (`apps/player/app/src/main/java/com/educms/player/media/NativeEndReasons.kt`)
 * is the generator; this file and the player page's dependency-free mirror
 * (`apps/web/src/app/player/nativeEndReasons.ts` — the player bundle ships to
 * Chromium-83 kiosks and never imports this package, which pulls zod in) are
 * held identical to it by `apps/web/src/app/player/__tests__/
 * nativeEndReasons.test.ts`, which parses the Kotlin. The drift between the
 * page's list and the app's is the latent defect of §1.2: a raw exception
 * code (`manifest-http-503`, `timeout`, `media-incomplete`) reached the page
 * as a verdict on the FILE, and an offline boot blocked native for a day.
 *
 *  • TRANSIENT  → native again at the next start. The alert, the operator UI,
 *                 the lifecycle or the page took the session down; nothing
 *                 about this file on this box was proven.
 *  • NOT_READY  → wait. The file, the manifest, the store or the credential
 *                 is not there yet. NEVER a verdict on the file.
 *  • FAULT      → a real fault of a VERIFIED file on this decoder: a 24 h
 *                 block keyed by file + face + APK build; the web engine plays
 *                 the SAME file (one engine for that content, not a flip).
 *  • REFUSED    → the class table / the box: never native here; the web engine
 *                 keeps the content, no block, no retry.
 *
 * More than NATIVE_END_SETTLE_MAX_IN_WINDOW transient ends within
 * NATIVE_END_SETTLE_WINDOW_MS for ONE content on ONE face settle that content
 * on the web engine until it changes or the page reloads — logged, never a
 * loop.
 *
 * Pure: no imports, no clock, no I/O.
 */

/** Native again at the next start; never a verdict on the file. */
export const NATIVE_END_TRANSIENT: ReadonlySet<string> = new Set([
  'emergency-held',
  'activity-paused',
  'lifecycle-not-ready',
  'operator-ui',
  'page-requested',
  'released',
  'content-changed',
  'superseded',
  'document-retired',
  'page-lease-expired',
  'host-replaced',
  'host-detached',
  'engine-switched',
  'peer-stopped',
  'decoder-unavailable',
  'decoder-budget',
  'session-retired',
  'output-detached',
  'output-unavailable',
  'hold-expired',
  'page-stopped',
]);

/** Wait: the store retries and the current content stays; never a verdict on the file. */
export const NATIVE_END_NOT_READY: ReadonlySet<string> = new Set([
  'not-in-store',
  'manifest-unreachable',
  'store-full',
  'store-unavailable',
  'selection-changed',
  'credential-missing',
  'credential-changed',
  'credential-identity',
]);

/** A real fault of a verified file: 24 h block keyed by file + face + build. */
export const NATIVE_END_FAULT: ReadonlySet<string> = new Set([
  'codec-failed',
  'hardware-codec-unavailable',
  'avc-track',
  'coded-size',
  'container-rotation',
  'empty-lap',
  'codec-input',
  'codec-stalled',
  'output-stalled',
  'native-prepare',
  'descriptor-invalid',
  'blocked',
]);

/** The class table / the box: never native here; web keeps the content, no block, no retry. */
export const NATIVE_END_REFUSED: ReadonlySet<string> = new Set([
  'composition-unavailable',
  'protocol3-disabled',
  'native-first-off',
  'lease-retired',
]);

export type NativeEndGrade = 'transient' | 'not-ready' | 'fault' | 'refused';

/**
 * Raw codes the engine produced before the closed table (exception messages
 * `FaceVideoReasons.code` passed through, HTTP codes the source embedded),
 * folded onto the closed set exactly as `NativeEndReasons.normalize` does.
 */
export const NATIVE_END_RAW_CODES: Readonly<Record<string, readonly string[]>> = {
  'manifest-unreachable': ['timeout', 'authorization-failed', 'api-root', 'api-origin', 'manifest-too-large', 'manifest-malformed'],
  'not-in-store': ['media-redirect', 'media-incomplete', 'media-size', 'media-digest', 'source-failed'],
  'store-full': ['media-cache-quota'],
  'store-unavailable': ['media-cache-unavailable', 'media-cache-corrupt', 'media-publish'],
  'descriptor-invalid': ['media-origin'],
  'native-prepare': ['codec-not-prepared'],
};
/** Prefix → closed code, in the APK's order (`manifest-http-503` → `manifest-unreachable`). */
export const NATIVE_END_RAW_PREFIXES: ReadonlyArray<readonly [string, string]> = [
  ['manifest-http-', 'manifest-unreachable'],
  ['media-http-', 'not-in-store'],
  ['descriptor-', 'descriptor-invalid'],
];

/**
 * PAGE ONLY — codes that shipped APKs (1.1.29 → 1.1.43) emit and the closed
 * table does not carry, graded as those APKs meant them. The player page is
 * one bundle for every APK on the fleet, so it must grade an old APK's end
 * too; none of these is a member of a closed set (the test asserts it).
 */
export const NATIVE_END_LEGACY_GRADES: Readonly<Record<string, NativeEndGrade>> = {
  // 1.1.41 protocol 3: a slot the APK skipped because its turn had passed.
  skipped: 'transient',
  // 1.1.43: the 60 Hz safety net reverted a mode switch nothing proved.
  'display-mode-reverted': 'transient',
  // 1.1.43: the verified copy was not on disk at prepare.
  'media-missing': 'not-ready',
  // 1.1.41 protocol 3 (page and API): another zone overlaps this VIDEO zone.
  'zone-overlap': 'refused',
  // An APK that does not answer the protocol the page asked for.
  protocol: 'refused',
};

export const NATIVE_END_SETTLE_MAX_IN_WINDOW = 5;
export const NATIVE_END_SETTLE_WINDOW_MS = 10 * 60_000;

const CODE_RE = /^[a-z0-9-]{1,64}$/;

function inClosedSet(code: string): boolean {
  return NATIVE_END_TRANSIENT.has(code) || NATIVE_END_NOT_READY.has(code) || NATIVE_END_FAULT.has(code) || NATIVE_END_REFUSED.has(code);
}

/**
 * Fold any raw code onto the closed set (the APK's `normalize`): a member
 * passes through; a known raw code maps; anything else becomes `fallback`
 * (itself a member, else `native-prepare`). Nothing outside the table leaves.
 */
export function normalizeNativeEndReason(raw: string, fallback = 'native-prepare'): string {
  if (inClosedSet(raw)) return raw;
  if (CODE_RE.test(raw)) {
    for (const [prefix, code] of NATIVE_END_RAW_PREFIXES) if (raw.startsWith(prefix)) return code;
    for (const [code, raws] of Object.entries(NATIVE_END_RAW_CODES)) if (raws.includes(raw)) return code;
  }
  return inClosedSet(fallback) ? fallback : 'native-prepare';
}

/**
 * The grade of one end. No reason at all is a PAGE-side end (a reply that
 * never came, a budget, a mismatch): transient. A legacy APK code is graded
 * as that APK meant it; everything else through the closed table, where an
 * unknown code is a fault (fail closed on the unknown).
 */
export function gradeNativeEnd(reason: string | null | undefined): NativeEndGrade {
  if (!reason) return 'transient';
  const legacy = Object.prototype.hasOwnProperty.call(NATIVE_END_LEGACY_GRADES, reason) ? NATIVE_END_LEGACY_GRADES[reason] : undefined;
  if (legacy && !inClosedSet(reason)) return legacy;
  const code = normalizeNativeEndReason(reason);
  if (NATIVE_END_TRANSIENT.has(code)) return 'transient';
  if (NATIVE_END_NOT_READY.has(code)) return 'not-ready';
  if (NATIVE_END_REFUSED.has(code)) return 'refused';
  return 'fault';
}
