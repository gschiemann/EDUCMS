/**
 * decideFaceEngine — one case per row of the native-first design's §3.1
 * table, plus the §7 E2 life-safety ordering and the operator yields.
 */
import { decideFaceEngine, faceEngineLine, type FaceEngineInput } from '../decideFaceEngine';

const SHA = 'ab'.repeat(32);
const ASSET = '44444444-4444-4444-8444-444444444444';

function input(over: Partial<FaceEngineInput> = {}, app: Partial<NonNullable<FaceEngineInput['app']>> | null = {}): FaceEngineInput {
  return {
    content: { solo: true, muted: true, mp4: true, daypart: false, assetId: ASSET, sha256: SHA },
    descriptor: { assetId: ASSET, sha256: SHA, nativeFirst: true },
    app: app === null ? null : {
      protocolMax: 4, nativeSolo: true, nativeFirst: true, storeMode: 'active', storeReady: new Set([SHA]), ...app,
    },
    blocked: false,
    settled: false,
    emergencyContent: false,
    holdRaised: false,
    sync: false,
    preview: false,
    softDim: false,
    overlay: null,
    ...over,
  };
}

describe('§3.1 — one decision per face, before the mount', () => {
  it('native-eligible, file verified in the store → native (frame 0, no web <video>)', () => {
    expect(decideFaceEngine(input())).toEqual({ engine: 'native', reason: 'store-verified', yieldTo: null });
  });

  it('native-eligible, file NOT yet verified → wait (the glass keeps what it shows; never a web lap)', () => {
    expect(decideFaceEngine(input({}, { storeReady: new Set() }))).toEqual({ engine: 'wait', reason: 'store-pending', yieldTo: null });
  });

  it('a verified file plays even while the store is still adopting; with no active store the app plays its own copy', () => {
    expect(decideFaceEngine(input({}, { storeMode: 'adopting' })).reason).toBe('store-verified');
    expect(decideFaceEngine(input({}, { storeMode: 'adopting', storeReady: new Set() }))).toMatchObject({ engine: 'native', reason: 'own-copy' });
    expect(decideFaceEngine(input({}, { storeMode: 'off', storeReady: new Set() }))).toMatchObject({ engine: 'native', reason: 'own-copy' });
    expect(decideFaceEngine(input({}, { storeMode: null, storeReady: new Set() }))).toMatchObject({ engine: 'native', reason: 'own-copy' });
  });

  it('the store answers by digest, case-insensitively, never by URL', () => {
    const d = input({ content: { solo: true, muted: true, mp4: true, daypart: false, assetId: ASSET, sha256: SHA.toUpperCase() },
      descriptor: { assetId: ASSET, sha256: SHA.toUpperCase() } });
    expect(decideFaceEngine(d).engine).toBe('native');
  });

  it.each([
    ['a template / mixed playlist (not solo)', { content: { solo: false, muted: true, mp4: true, daypart: false, assetId: ASSET, sha256: SHA } }, 'not-solo'],
    ['an audible video', { content: { solo: true, muted: false, mp4: true, daypart: false, assetId: ASSET, sha256: SHA } }, 'not-muted'],
    ['a non-MP4 file', { content: { solo: true, muted: true, mp4: false, daypart: false, assetId: ASSET, sha256: SHA } }, 'not-mp4'],
    ['an item with its own day/time window', { content: { solo: true, muted: true, mp4: true, daypart: true, assetId: ASSET, sha256: SHA } }, 'daypart'],
    ['frame-locked sync', { sync: true }, 'sync'],
    ['the dashboard preview', { preview: true }, 'preview'],
  ] as const)('not a solo muted video: %s → web', (_n, over, reason) => {
    expect(decideFaceEngine(input(over as Partial<FaceEngineInput>))).toEqual({ engine: 'web', reason, yieldTo: null });
  });

  it('class not native (Taurus), protocol < 4, switch off → web, today\'s path byte for byte', () => {
    expect(decideFaceEngine(input({}, { nativeSolo: false })).reason).toBe('class-not-native');
    expect(decideFaceEngine(input({}, { protocolMax: 3 })).reason).toBe('protocol');
    expect(decideFaceEngine(input({}, null)).reason).toBe('protocol');
    // Not enrolled (descriptor silent) and the class default off → web.
    expect(decideFaceEngine(input({ descriptor: { assetId: ASSET, sha256: SHA } }, { nativeFirst: false })).reason).toBe('native-first-off');
    // §8.1: an explicit enrolment beats the class default the app reports (field bug 2026-10-19).
    expect(decideFaceEngine(input({}, { nativeFirst: false }))).toEqual({ engine: 'native', reason: 'store-verified', yieldTo: null });
    // …but only once the app agrees: protocol < 4 still means web.
    expect(decideFaceEngine(input({}, { nativeFirst: false, protocolMax: 3 })).reason).toBe('protocol');
    // The server's explicit kill switch wins over an app that says yes.
    expect(decideFaceEngine(input({ descriptor: { assetId: ASSET, sha256: SHA, nativeFirst: false } })).reason).toBe('descriptor-off');
    // Absent key = the app's class default decides.
    expect(decideFaceEngine(input({ descriptor: { assetId: ASSET, sha256: SHA } })).engine).toBe('native');
  });

  it('no descriptor, or a descriptor for other bytes → web', () => {
    expect(decideFaceEngine(input({ descriptor: null })).reason).toBe('no-descriptor');
    expect(decideFaceEngine(input({ descriptor: { assetId: ASSET, sha256: 'cd'.repeat(32) } })).reason).toBe('descriptor-mismatch');
    expect(decideFaceEngine(input({ descriptor: { assetId: '55555555-5555-4555-8555-555555555555', sha256: SHA } })).reason).toBe('descriptor-mismatch');
    expect(decideFaceEngine(input({ content: { solo: true, muted: true, mp4: true, daypart: false, assetId: ASSET, sha256: '' } })).reason).toBe('descriptor-mismatch');
  });

  it('a live native block (a real decoder fault of this file on this build) → web plays the same file', () => {
    expect(decideFaceEngine(input({ blocked: true }))).toEqual({ engine: 'web', reason: 'blocked', yieldTo: null });
  });

  it('repeated transient ends settled this content → web until it changes or the page reloads', () => {
    expect(decideFaceEngine(input({ settled: true })).reason).toBe('settled');
  });
});

describe('§7 E2 — emergency content and a raised hold are always web, checked FIRST', () => {
  it('emergency content → web, whatever else is true', () => {
    expect(decideFaceEngine(input({ emergencyContent: true }))).toEqual({ engine: 'web', reason: 'emergency-content', yieldTo: null });
    // Even a fully native-eligible, verified face with an overlay open.
    expect(decideFaceEngine(input({ emergencyContent: true, overlay: 'update-prompt' })).engine).toBe('web');
  });
  it('a raised hold → web, whatever else is true', () => {
    expect(decideFaceEngine(input({ holdRaised: true }))).toEqual({ engine: 'web', reason: 'hold-raised', yieldTo: null });
    expect(decideFaceEngine(input({ holdRaised: true }, { storeReady: new Set() })).engine).toBe('web');
  });
  it('the alert outranks every other web reason (it is what gets logged)', () => {
    const all = input({ emergencyContent: true, holdRaised: true, sync: true, preview: true, blocked: true, descriptor: null }, null);
    expect(decideFaceEngine(all).reason).toBe('emergency-content');
    expect(decideFaceEngine(input({ holdRaised: true, sync: true, blocked: true }, null)).reason).toBe('hold-raised');
  });
});

describe('operator overlays are yields, not engine choices', () => {
  it.each(['update-prompt', 'soft-blank', 'canvas-editor', 'touch-overlay'] as const)('%s keeps the engine, sets yieldTo', (overlay) => {
    expect(decideFaceEngine(input({ overlay }))).toEqual({ engine: 'native', reason: 'store-verified', yieldTo: overlay });
    expect(decideFaceEngine(input({ overlay }, { storeReady: new Set() }))).toEqual({ engine: 'wait', reason: 'store-pending', yieldTo: overlay });
  });
  it('soft dim is a lasting state the page must composite over the picture → web (today\'s rule kept)', () => {
    expect(decideFaceEngine(input({ softDim: true }))).toEqual({ engine: 'web', reason: 'soft-dim', yieldTo: null });
  });
});

describe('the once-per-change log line', () => {
  it('carries codes and an 8-char digest prefix only', () => {
    expect(faceEngineLine({ engine: 'native', reason: 'store-verified', yieldTo: null }, 0, SHA))
      .toBe(`[Player] PLAYER_NATIVE_FIRST_DECISION engine=native reason=store-verified face=0 sha=${SHA.slice(0, 8)}`);
    expect(faceEngineLine({ engine: 'wait', reason: 'store-pending', yieldTo: 'soft-blank' }, 1, SHA)).toContain('yield=soft-blank face=1');
  });
});
