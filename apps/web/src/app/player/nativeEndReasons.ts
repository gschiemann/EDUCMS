/**
 * THE CLOSED SET OF NATIVE END REASONS, page side — phase 0 of native-first
 * (design `docs/design/NATIVE-FIRST-ONE-STORE.md` §3.4 / §1.2, owner D7).
 *
 * ⚠️ MIRRORS `packages/api-types/src/native-end-reasons.ts` (the shared
 * table) and the APK's generator `media/NativeEndReasons.kt`, declared here
 * rather than imported ON PURPOSE: this module ships in the player bundle to
 * Chromium-83 kiosks, and `@cms/api-types` pulls zod in with it (the
 * `displayControl.ts` rule). `__tests__/nativeEndReasons.test.ts` parses the
 * Kotlin and imports the shared table and fails on ANY difference, so the
 * drift this would otherwise invite is a red test, not a 24 h block.
 *
 *  • TRANSIENT → native again at the next start (never a verdict on the file)
 *  • NOT_READY → wait: the file / manifest / store / credential is not there
 *                yet; the store retries — never a verdict on the file
 *  • FAULT     → a real fault of a VERIFIED file: 24 h block, file+face+build
 *  • REFUSED   → the class / the box: web for this content, no block, no retry
 *  • > 5 transient ends in 10 min for one content on one face → settle on web
 *    until the content changes or the page reloads.
 *
 * Pure: no React, no DOM, no bridge, no clock (time is passed in).
 */

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
  'hold-expired',
  'selection-changed',
  'credential-changed',
  'display-mode-reverted',
  'skipped',
  'page-stopped',
]);

export const NATIVE_END_NOT_READY: ReadonlySet<string> = new Set([
  'not-in-store',
  'manifest-unreachable',
  'store-full',
  'store-unavailable',
  'credential-missing',
  'credential-identity',
  'descriptor-invalid',
]);

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
  'output-unavailable',
  'media-digest',
  'blocked',
]);

export const NATIVE_END_REFUSED: ReadonlySet<string> = new Set([
  'composition-unavailable',
  'protocol3-disabled',
  'native-first-off',
  'lease-retired',
  'zone-overlap',
  'protocol',
]);

export type NativeEndGrade = 'transient' | 'not-ready' | 'fault' | 'refused';

export const NATIVE_END_RAW_CODES: Readonly<Record<string, readonly string[]>> = {
  'manifest-unreachable': ['timeout', 'authorization-failed', 'api-root', 'api-origin', 'manifest-too-large', 'manifest-malformed'],
  'not-in-store': ['media-redirect', 'media-incomplete', 'media-size', 'media-missing', 'source-failed'],
  'store-full': ['media-cache-quota'],
  'store-unavailable': ['media-cache-unavailable', 'media-cache-corrupt', 'media-publish'],
  'descriptor-invalid': ['media-origin'],
  'native-prepare': ['codec-not-prepared'],
};
export const NATIVE_END_RAW_PREFIXES: ReadonlyArray<readonly [string, string]> = [
  ['manifest-http-', 'manifest-unreachable'],
  ['media-http-', 'not-in-store'],
  ['descriptor-', 'descriptor-invalid'],
];

/** Codes shipped APKs (1.1.29 → 1.1.43) emit outside the closed table, graded as they meant them. */
export const NATIVE_END_LEGACY_GRADES: Readonly<Record<string, NativeEndGrade>> = {
  // Empty: stream B's table now carries every code the fleet emits (see the shared table).
};

export const NATIVE_END_SETTLE_MAX_IN_WINDOW = 5;
export const NATIVE_END_SETTLE_WINDOW_MS = 10 * 60_000;

const CODE_RE = /^[a-z0-9-]{1,64}$/;

function inClosedSet(code: string): boolean {
  return NATIVE_END_TRANSIENT.has(code) || NATIVE_END_NOT_READY.has(code) || NATIVE_END_FAULT.has(code) || NATIVE_END_REFUSED.has(code);
}

/** Fold any raw code onto the closed set, exactly as the APK's `normalize`. */
export function normalizeNativeEndReason(raw: string, fallback = 'native-prepare'): string {
  if (inClosedSet(raw)) return raw;
  if (CODE_RE.test(raw)) {
    for (const [prefix, code] of NATIVE_END_RAW_PREFIXES) if (raw.startsWith(prefix)) return code;
    for (const code of Object.keys(NATIVE_END_RAW_CODES)) if (NATIVE_END_RAW_CODES[code].indexOf(raw) !== -1) return code;
  }
  return inClosedSet(fallback) ? fallback : 'native-prepare';
}

/**
 * The grade of one end. No reason = a PAGE-side end (no reply, a budget, a
 * mismatch): transient. A legacy APK code is graded as that APK meant it;
 * everything else through the closed table — an unknown code is a fault.
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

// ── Page-only: the settle rule and what a native-first face does next ────


/**
 * The settle rule of §3.4, the page's twin of the APK's `TransientEndTracker`:
 * more than `maxInWindow` TRANSIENT ends inside `windowMs` for ONE content on
 * ONE face settle it on the web engine until the content changes (`reset`)
 * or the page reloads (a new document builds a new tracker). Bounded: one
 * entry per content key, at most `maxInWindow + 1` timestamps each.
 */
export class NativeTransientEnds {
  private ends = new Map<string, number[]>();
  private settledKeys = new Set<string>();
  constructor(
    private windowMs = NATIVE_END_SETTLE_WINDOW_MS,
    private maxInWindow = NATIVE_END_SETTLE_MAX_IN_WINDOW,
  ) {}
  static key(faceIndex: number, sha256: string): string {
    return `${faceIndex}:${sha256.toLowerCase()}`;
  }
  /** Record an end of `contentKey` at `nowMs`; true when the content is (now) settled on web. */
  ended(contentKey: string, reason: string | null | undefined, nowMs: number): boolean {
    if (gradeNativeEnd(reason) !== 'transient') return this.settledKeys.has(contentKey);
    const kept = (this.ends.get(contentKey) ?? []).filter((t) => nowMs - t <= this.windowMs && t <= nowMs);
    kept.push(nowMs);
    this.ends.set(contentKey, kept.slice(-(this.maxInWindow + 1)));
    if (kept.length > this.maxInWindow) this.settledKeys.add(contentKey);
    return this.settledKeys.has(contentKey);
  }
  settled(contentKey: string): boolean {
    return this.settledKeys.has(contentKey);
  }
  /** Settle at once (a REFUSED end: web for this content until it changes or the page reloads). */
  settle(contentKey: string): void {
    this.settledKeys.add(contentKey);
  }
  /** The content changed: its history and its settlement are gone. */
  reset(contentKey: string): void {
    this.ends.delete(contentKey);
    this.settledKeys.delete(contentKey);
  }
}

/**
 * What a native end means for a NATIVE-FIRST face (v4: the engine was decided
 * before the mount, so no web picture exists behind native to flip from —
 * this replaces the `wasOnGlass` rule there):
 *   transient → `native`  — start native again (the alert / operator UI /
 *                           lifecycle that ended it was what the glass showed)
 *               `settle`  — the 6th transient end in 10 min: web until the
 *                           content changes or the page reloads
 *   not-ready → `wait`    — the store retries; re-decide when it reports the
 *                           file verified; never a block
 *   fault     → `block`   — 24 h, file + face + build; web plays the same file
 *   refused   → `web`     — web for this content, no block, no retry
 * The web-first TAKEOVER path (v2/v3, `NativeDualVideo`) keeps its own rule
 * (`nativeVideoNext`): there the web picture IS on glass after an end, so
 * "native again" would be exactly the flip the owner banned (2026-10-12).
 */
export type NativeFirstEndNext = 'native' | 'settle' | 'wait' | 'block' | 'web';
export function nativeFirstEndNext(input: {
  reason: string | null | undefined;
  /** `NativeTransientEnds.ended(...)` for this end (true = settled). */
  settled: boolean;
}): NativeFirstEndNext {
  const grade = gradeNativeEnd(input.reason);
  if (grade === 'fault') return 'block';
  if (grade === 'refused') return 'web';
  if (grade === 'not-ready') return 'wait';
  return input.settled ? 'settle' : 'native';
}
