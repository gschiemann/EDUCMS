/**
 * PHASE 0 (native-first design §3.4 / §1.2, owner D7): ONE closed table of
 * native end reasons for the APK, the shared package and the player page.
 *
 *  1. PARITY — the page's mirror (nativeEndReasons.ts), the shared table
 *     (packages/api-types/src/native-end-reasons.ts) and the APK's generator
 *     (media/NativeEndReasons.kt, parsed here the way nativeBridge.test.ts
 *     reads Kotlin) carry the same four sets, the same raw-code folding and
 *     the same settle constants. The Kotlin is skipped, loudly, only when the
 *     file is absent from this checkout (it lands with stream B); point
 *     NATIVE_END_REASONS_KT at a copy to check one before it merges.
 *  2. THE LATENT DEFECT — an offline boot, a 5xx, a timeout, a short download
 *     are NOT-READY (wait), never a 24 h block.
 *  3. The page's settle rule and the native-first next step.
 */
import * as shared from '../../../../../../packages/api-types/src/native-end-reasons';
import * as page from '../nativeEndReasons';
import {
  gradeNativeEnd,
  NATIVE_END_FAULT,
  NATIVE_END_LEGACY_GRADES,
  NATIVE_END_NOT_READY,
  NATIVE_END_RAW_CODES,
  NATIVE_END_RAW_PREFIXES,
  NATIVE_END_REFUSED,
  NATIVE_END_SETTLE_MAX_IN_WINDOW,
  NATIVE_END_SETTLE_WINDOW_MS,
  NATIVE_END_TRANSIENT,
  nativeFirstEndNext,
  NativeTransientEnds,
  normalizeNativeEndReason,
} from '../nativeEndReasons';
import { nativeVideoEndGrade, NATIVE_VIDEO_TRANSIENT_REASONS } from '../nativeSharedVideo';
import { nativeVideoNext } from '../NativeDualVideo';

const sorted = (s: Iterable<string>) => Array.from(s).sort();

// eslint-disable-next-line @typescript-eslint/no-var-requires
const fs = jest.requireActual('fs') as typeof import('fs');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const path = jest.requireActual('path') as typeof import('path');
const KT = process.env.NATIVE_END_REASONS_KT
  || path.resolve(__dirname, '../../../../../player/app/src/main/java/com/educms/player/media/NativeEndReasons.kt');
const ktSource: string | null = fs.existsSync(KT) ? fs.readFileSync(KT, 'utf8') : null;

/**
 * `val NAME: Set<String> = setOf(` … `)` — the quoted literals only. `//`
 * comments are stripped FIRST (they carry parentheses, e.g. "(§7 E1)"), then
 * the set ends at the first `)`.
 */
function ktSet(src: string, name: string): string[] {
  const start = new RegExp(`val ${name}(?:: Set<String>)? = setOf\\(`).exec(src);
  if (!start) throw new Error(`NativeEndReasons.kt: no set ${name}`);
  const rest = src.slice(start.index + start[0].length).split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
  const body = rest.slice(0, rest.indexOf(')'));
  return Array.from(body.matchAll(/"([a-z0-9-]{1,64})"/g)).map((x) => x[1]);
}

describe('the closed table — page mirror ≡ shared package', () => {
  it('same four sets, same raw folding, same legacy grades, same settle constants', () => {
    for (const k of ['NATIVE_END_TRANSIENT', 'NATIVE_END_NOT_READY', 'NATIVE_END_FAULT', 'NATIVE_END_REFUSED'] as const) {
      expect(sorted(page[k])).toEqual(sorted(shared[k]));
    }
    expect(page.NATIVE_END_RAW_CODES).toEqual(shared.NATIVE_END_RAW_CODES);
    expect(page.NATIVE_END_RAW_PREFIXES).toEqual(shared.NATIVE_END_RAW_PREFIXES);
    expect(page.NATIVE_END_LEGACY_GRADES).toEqual(shared.NATIVE_END_LEGACY_GRADES);
    expect(page.NATIVE_END_SETTLE_MAX_IN_WINDOW).toBe(shared.NATIVE_END_SETTLE_MAX_IN_WINDOW);
    expect(page.NATIVE_END_SETTLE_WINDOW_MS).toBe(shared.NATIVE_END_SETTLE_WINDOW_MS);
  });

  it('grades and folds every code identically', () => {
    const corpus = [
      ...NATIVE_END_TRANSIENT, ...NATIVE_END_NOT_READY, ...NATIVE_END_FAULT, ...NATIVE_END_REFUSED,
      ...Object.values(NATIVE_END_RAW_CODES).flat(), ...Object.keys(NATIVE_END_LEGACY_GRADES),
      'manifest-http-503', 'media-http-404', 'descriptor-version', 'something-new', 'BAD CODE', '', 'caching',
    ];
    for (const c of corpus) {
      expect([c, page.gradeNativeEnd(c)]).toEqual([c, shared.gradeNativeEnd(c)]);
      expect([c, page.normalizeNativeEndReason(c)]).toEqual([c, shared.normalizeNativeEndReason(c)]);
    }
  });

  it('the sets are disjoint, codes are well formed, and no legacy code is in the closed set', () => {
    const all = [...NATIVE_END_TRANSIENT, ...NATIVE_END_NOT_READY, ...NATIVE_END_FAULT, ...NATIVE_END_REFUSED];
    expect(new Set(all).size).toBe(all.length);
    for (const c of all) expect(c).toMatch(/^[a-z0-9-]{1,64}$/);
    for (const c of Object.keys(NATIVE_END_LEGACY_GRADES)) expect(all).not.toContain(c);
    // Every raw code folds onto a member, never onto itself.
    for (const [code, raws] of Object.entries(NATIVE_END_RAW_CODES)) {
      expect(all).toContain(code);
      for (const r of raws) expect(all).not.toContain(r);
    }
  });
});

(ktSource ? describe : describe.skip)('the closed table — page ≡ the APK generator (NativeEndReasons.kt)', () => {
  const src = ktSource as string;
  it('TRANSIENT / NOT_READY / FAULT / REFUSED match the Kotlin sets exactly', () => {
    expect(sorted(NATIVE_END_TRANSIENT)).toEqual(sorted(ktSet(src, 'TRANSIENT')));
    expect(sorted(NATIVE_END_NOT_READY)).toEqual(sorted(ktSet(src, 'NOT_READY')));
    expect(sorted(NATIVE_END_FAULT)).toEqual(sorted(ktSet(src, 'FAULT')));
    expect(sorted(NATIVE_END_REFUSED)).toEqual(sorted(ktSet(src, 'REFUSED')));
  });
  it('the raw-code folding matches `normalize`', () => {
    const ktMaps: Record<string, string> = {
      MANIFEST_UNREACHABLE: 'manifest-unreachable', NOT_IN_STORE: 'not-in-store', STORE_FULL: 'store-full',
      STORE_UNAVAILABLE: 'store-unavailable', DESCRIPTOR_INVALID: 'descriptor-invalid', NATIVE_PREPARE: 'native-prepare',
    };
    for (const [ktName, code] of Object.entries(ktMaps)) {
      expect([ktName, sorted(NATIVE_END_RAW_CODES[code] ?? [])]).toEqual([ktName, sorted(ktSet(src, ktName))]);
    }
    expect(Object.keys(NATIVE_END_RAW_CODES).sort()).toEqual(Object.values(ktMaps).sort());
    const prefixes = Array.from(src.matchAll(/raw\.startsWith\("([a-z0-9-]+)"\) -> "([a-z0-9-]+)"/g)).map((m) => [m[1], m[2]]);
    expect(prefixes).toEqual(NATIVE_END_RAW_PREFIXES.map(([p, c]) => [p, c]));
  });
  it('the settle constants match TransientEndTracker', () => {
    expect(/const val MAX_IN_WINDOW = (\d+)/.exec(src)?.[1]).toBe(String(NATIVE_END_SETTLE_MAX_IN_WINDOW));
    const w = /const val WINDOW_MS = (\d+)L \* (\d+)_?(\d*)L/.exec(src);
    expect(w).not.toBeNull();
    const [, a, b1, b2] = w as RegExpExecArray;
    expect(Number(a) * Number(`${b1}${b2}`)).toBe(NATIVE_END_SETTLE_WINDOW_MS);
  });
});

if (!ktSource) {
  // eslint-disable-next-line no-console
  console.warn(`[nativeEndReasons.test] SKIPPING the Kotlin parity check — ${KT} is not in this checkout (it lands with stream B's NativeEndReasons.kt)`);
}

describe('phase 0: the latent defect — never a 24 h block for the network, storage or credential', () => {
  const offlineBoot = ['authorization-failed', 'manifest-http-503', 'manifest-http-401', 'timeout', 'api-root', 'media-incomplete',
    'source-failed', 'media-http-500', 'media-cache-quota', 'media-cache-corrupt', 'credential-missing', 'media-missing',
    'media-origin', 'descriptor-version'];
  it.each(offlineBoot)('%s is NOT-READY: wait on native-first, retry on the takeover path, never block', (code) => {
    expect(gradeNativeEnd(code)).toBe('not-ready');
    expect(nativeFirstEndNext({ reason: code, settled: false })).toBe('wait');
    expect(nativeVideoNext(2, code, 0)).toBe('retry');
  });
  it('a token renewed mid-prepare / a selection that moved on is TRANSIENT (as 1.1.43 grades it): native again, never a block', () => {
    for (const code of ['credential-changed', 'selection-changed']) {
      expect(gradeNativeEnd(code)).toBe('transient');
      expect(nativeFirstEndNext({ reason: code, settled: false })).toBe('native');
      expect(nativeVideoNext(2, code, 0)).toBe('retry');
    }
  });
  it('a real decoder fault of a verified file still blocks', () => {
    for (const code of ['codec-failed', 'hardware-codec-unavailable', 'codec-stalled', 'output-stalled', 'codec-not-prepared', 'output-unavailable']) {
      expect(gradeNativeEnd(code)).toBe('fault');
      expect(nativeFirstEndNext({ reason: code, settled: false })).toBe('block');
      expect(nativeVideoNext(2, code, 0)).toBe('block');
    }
  });
  it('an unknown code fails closed (fault); no reason at all is a page-side end (transient)', () => {
    expect(gradeNativeEnd('something-new')).toBe('fault');
    expect(gradeNativeEnd(undefined)).toBe('transient');
    expect(gradeNativeEnd('')).toBe('transient');
  });
  it('refused is web for the content — no block, no retry', () => {
    for (const code of ['composition-unavailable', 'native-first-off', 'lease-retired', 'zone-overlap', 'protocol']) {
      expect(gradeNativeEnd(code)).toBe('refused');
      expect(nativeFirstEndNext({ reason: code, settled: false })).toBe('web');
      expect(nativeVideoEndGrade(code)).toBe('box');
      expect(nativeVideoNext(2, code, 0)).toBe('stay');
    }
  });
  it('the takeover path keeps its no-flip rule; the 1.1.43 codes grade as 1.1.43 meant them', () => {
    expect(nativeVideoNext(2, 'emergency-held', 0)).toBe('retry');
    expect(nativeVideoNext(2, 'emergency-held', 0, true)).toBe('stay');
    for (const code of ['skipped', 'display-mode-reverted']) {
      expect(NATIVE_VIDEO_TRANSIENT_REASONS.has(code)).toBe(true);
      expect(nativeVideoEndGrade(code)).toBe('transient');
    }
    for (const c of NATIVE_END_TRANSIENT) expect(NATIVE_VIDEO_TRANSIENT_REASONS.has(c)).toBe(true);
  });
  it('a full download whose digest is not the manifest\'s is a FAULT everywhere (retrying downloads the same bytes)', () => {
    expect(gradeNativeEnd('media-digest')).toBe('fault');
    expect(nativeFirstEndNext({ reason: 'media-digest', settled: false })).toBe('block');
    expect(nativeVideoNext(2, 'media-digest', 0)).toBe('block');
  });
});

describe('native-first: what an end means next (replaces the wasOnGlass rule there)', () => {
  it('transient → native again; the alert / operator UI / lifecycle was the glass, not a web picture', () => {
    for (const code of ['emergency-held', 'activity-paused', 'operator-ui', 'content-changed', 'released', 'page-stopped']) {
      expect(nativeFirstEndNext({ reason: code, settled: false })).toBe('native');
    }
    expect(nativeFirstEndNext({ reason: undefined, settled: false })).toBe('native');
  });
  it('the 6th transient end in 10 min settles the content on web; a fault still blocks', () => {
    const t = new NativeTransientEnds();
    const key = NativeTransientEnds.key(0, 'A'.repeat(64));
    for (let i = 0; i < NATIVE_END_SETTLE_MAX_IN_WINDOW; i++) expect(t.ended(key, 'activity-paused', 1000 + i)).toBe(false);
    expect(t.ended(key, 'operator-ui', 2000)).toBe(true);
    expect(nativeFirstEndNext({ reason: 'operator-ui', settled: true })).toBe('settle');
    expect(nativeFirstEndNext({ reason: 'codec-failed', settled: true })).toBe('block');
    expect(t.settled(key)).toBe(true);
    expect(t.settled(NativeTransientEnds.key(1, 'a'.repeat(64)))).toBe(false);
    t.reset(key);
    expect(t.settled(key)).toBe(false);
  });
  it('ends spread wider than the window never settle; non-transient ends never count', () => {
    const t = new NativeTransientEnds();
    const key = NativeTransientEnds.key(0, 'b'.repeat(64));
    for (let i = 0; i < 20; i++) expect(t.ended(key, 'emergency-held', i * (NATIVE_END_SETTLE_WINDOW_MS / 4))).toBe(false);
    const u = new NativeTransientEnds();
    for (let i = 0; i < 20; i++) expect(u.ended(key, 'manifest-http-503', i)).toBe(false);
  });
  it('normalize folds as the APK does and never lets a non-member out', () => {
    expect(normalizeNativeEndReason('manifest-http-503')).toBe('manifest-unreachable');
    expect(normalizeNativeEndReason('media-missing')).toBe('not-in-store');
    expect(normalizeNativeEndReason('media-digest')).toBe('media-digest');
    expect(normalizeNativeEndReason('media-origin')).toBe('descriptor-invalid');
    expect(normalizeNativeEndReason('BAD CODE')).toBe('native-prepare');
    expect(normalizeNativeEndReason('nope', 'activity-paused')).toBe('activity-paused');
    expect(normalizeNativeEndReason('nope', 'not-a-member')).toBe('native-prepare');
  });
});
