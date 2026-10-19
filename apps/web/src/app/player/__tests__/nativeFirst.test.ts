/**
 * Native-first protocol v4, page side: the exact message shapes stream B
 * parses, the reply facts, the §4.3 re-attach table, the §6 store-mode
 * readiness adapter, and the per-document controller.
 */
import {
  nativeIntendMessage,
  nativeManifestTag,
  nativePresenting,
  nativeReleaseMessage,
  nativeSyncMessage,
  newNativeLeaseId,
  readNativeFirstFacts,
  readNativeStoreBlock,
  reconcileFace,
  sessionHasFreshFrame,
  storeLookupCached,
  storeModeReadiness,
  type NativeFirstFacts,
  type NativeIntentIdentity,
} from '../nativeFirst';
import { NativeFirstFace, nativeFirstDecisionSignature } from '../nativeFirstFace';
import { isItemReady, readyItemIds, type ReadinessItem } from '../mediaReadiness';

const SCREEN = '11111111-1111-4111-8111-111111111111';
const ASSET_X = '44444444-4444-4444-8444-444444444444';
const ASSET_Y = '55555555-5555-4555-8555-555555555555';
const SHA_X = 'aa'.repeat(32);
const SHA_Y = 'bb'.repeat(32);
const SESSION = '66666666-6666-4666-8666-666666666666';
const LEASE = '0123456789abcdef0123456789abcdef';
const X: NativeIntentIdentity = { screenId: SCREEN, revision: 'r'.repeat(64), sha256: SHA_X, assetId: ASSET_X };
const Y: NativeIntentIdentity = { screenId: SCREEN, revision: 's'.repeat(64), sha256: SHA_Y, assetId: ASSET_Y };

function reply(over: Record<string, unknown> = {}) {
  return {
    version: 1, protocol: 2, protocolMax: 4, state: 'idle',
    device: { class: 'amlogic/android-13', soc: 'amlogic', sdk: 33, webviewMajor: 120, nativeSolo: true, protocol3: true, silentUpdate: 'tap', nativeFirst: true },
    ...over,
  };
}
function presenting(id: NativeIntentIdentity, frames = 10, ageMs = 100) {
  return {
    state: 'presenting', sessionId: SESSION, revision: id.revision, sha256: id.sha256, faceIndex: 0,
    output: { attached: true, visible: true, viewUpdates: 5, uniqueFrames: frames, sourcePtsUs: 0, width: 1920, height: 1080, lastUpdateElapsedMs: 1, hardwareAccelerated: true, ageMs },
  };
}
const facts = (over: Record<string, unknown> = {}) => readNativeFirstFacts(reply(over)) as NativeFirstFacts;

describe('v4 messages — identity only, never a URL or a token (the shapes stream B parses)', () => {
  it('intend', () => {
    expect(JSON.parse(nativeIntendMessage({ ...X, sha256: SHA_X.toUpperCase() }, 'now', LEASE)!)).toEqual({
      version: 4, op: 'intend', screenId: SCREEN, revision: X.revision, sha256: SHA_X, assetId: ASSET_X, start: 'now', lease: LEASE,
    });
    expect(JSON.parse(nativeIntendMessage(X, 'boundary', LEASE)!).start).toBe('boundary');
  });
  it('release', () => {
    expect(JSON.parse(nativeReleaseMessage(LEASE, 'boundary')!)).toEqual({ version: 4, op: 'release', lease: LEASE, at: 'boundary' });
    expect(JSON.parse(nativeReleaseMessage(LEASE, 'now')!).at).toBe('now');
  });
  it('sync (the manifest ETag as its tag; the emergency set hash only when known)', () => {
    expect(JSON.parse(nativeSyncMessage('abc123', 'set-1')!)).toEqual({ version: 4, op: 'sync', manifestTag: 'abc123', emergencySetHash: 'set-1' });
    expect(JSON.parse(nativeSyncMessage('abc123')!)).toEqual({ version: 4, op: 'sync', manifestTag: 'abc123' });
    expect(nativeManifestTag('W/"abc-123"')).toBe('abc-123');
    expect(nativeManifestTag('"x"')).toBe('x');
    expect(nativeManifestTag(null)).toBeNull();
    expect(nativeManifestTag('"has space"')).toBeNull();
  });
  it('a malformed identity, start or lease sends nothing', () => {
    expect(nativeIntendMessage({ ...X, sha256: 'nope' }, 'now', LEASE)).toBeNull();
    expect(nativeIntendMessage({ ...X, assetId: 'https://evil.example/x.mp4' }, 'now', LEASE)).toBeNull();
    expect(nativeIntendMessage(X, 'later' as never, LEASE)).toBeNull();
    expect(nativeIntendMessage(X, 'now', 'short')).toBeNull();
    expect(nativeReleaseMessage('UPPERCASE0123456789ABCDEF0123456', 'now')).toBeNull();
    expect(nativeSyncMessage('')).toBeNull();
  });
  it('no message ever carries a URL or a credential-shaped field', () => {
    for (const m of [nativeIntendMessage(X, 'now', LEASE)!, nativeReleaseMessage(LEASE, 'now')!, nativeSyncMessage('t', 'h')!]) {
      expect(m).not.toMatch(/https?:|token|authorization|url/i);
    }
  });
  it('a lease is 32 lowercase hex, fresh per document', () => {
    const a = newNativeLeaseId();
    expect(a).toMatch(/^[a-f0-9]{32}$/);
    expect(newNativeLeaseId()).not.toBe(a);
    expect(newNativeLeaseId((b) => b.fill(255))).toBe('f'.repeat(32));
    expect(newNativeLeaseId(() => { throw new Error('no crypto'); })).toMatch(/^[a-f0-9]{32}$/);
  });
});

describe('the v4 reply facts', () => {
  it('reads protocolMax, the class answer, the lease, the intent, the session and the store', () => {
    const f = facts({
      ...presenting(X),
      lease: { id: LEASE, state: 'held' },
      intent: { ...X, start: 'now', suspended: false },
      store: { mode: 'active', serve: false, generation: 7, ready: [SHA_X, 'junk'], pending: [SHA_Y], downloading: { sha8: 'bbbbbbbb', bytesLoaded: 5, bytesTotal: 10 }, emergency: { setHash: 'h1', complete: true, count: 3, bytes: 900 } },
    });
    expect(f.protocolMax).toBe(4);
    expect(f.nativeFirst).toBe(true);
    expect(f.nativeSolo).toBe(true);
    expect(f.lease).toEqual({ id: LEASE, state: 'held' });
    expect(f.intent).toEqual({ ...X, start: 'now', suspended: null });
    expect(f.session?.state).toBe('presenting');
    expect(f.store).toEqual({ mode: 'active', serve: false, generation: 7, ready: [SHA_X], pending: [SHA_Y],
      downloading: { sha8: 'bbbbbbbb', bytesLoaded: 5, bytesTotal: 10 }, emergency: { setHash: 'h1', complete: true, count: 3, bytes: 900 } });
    expect(sessionHasFreshFrame(f.session)).toBe(true);
    expect(nativePresenting(f)).toBe(true);
  });
  it('an older APK (protocolMax 3, no device.nativeFirst, no store) reads as not native-first', () => {
    const f = readNativeFirstFacts({ ...reply({ protocolMax: 3 }), device: { nativeSolo: true } })!;
    expect(f.protocolMax).toBe(3);
    expect(f.nativeFirst).toBe(false);
    expect(f.store).toBeNull();
    expect(nativePresenting(readNativeFirstFacts(reply({ protocolMax: 3, ...presenting(X) })))).toBe(false);
  });
  it('a suspended intent (the hold) and its spellings', () => {
    for (const s of [true, 'hold', 'emergency-held']) expect(facts({ intent: { ...X, suspended: s } }).intent?.suspended).toBe('hold');
    expect(facts({ intent: { ...X, suspended: 'operator-ui' } }).intent?.suspended).toBe('operator-ui');
  });
  it('garbage, oversize, a malformed intent or store are dropped, never invented', () => {
    expect(readNativeFirstFacts('{not json')).toBeNull();
    expect(readNativeFirstFacts('x'.repeat(16385))).toBeNull();
    expect(readNativeFirstFacts({ version: 2 })).toBeNull();
    expect(facts({ intent: { ...X, assetId: 'nope' } }).intent).toBeNull();
    expect(facts({ store: { mode: 'weird' } }).store).toBeNull();
    expect(readNativeStoreBlock({ mode: 'off' })).toEqual({ mode: 'off', serve: false, generation: 0, ready: [], pending: [], downloading: null, emergency: null });
    expect(facts({ store: { mode: 'active', ready: Array(100).fill(SHA_X) } }).store?.ready).toHaveLength(64);
    expect(facts({ lease: 'NOTHEX' }).lease).toBeNull();
    expect(facts({ protocolMax: 1e9 }).protocolMax).toBe(0);
  });
  it('the decision signature moves only with decision facts, not with every frame', () => {
    const a = facts(presenting(X, 10, 100));
    const b = facts(presenting(X, 99, 50));
    expect(nativeFirstDecisionSignature(a)).toBe(nativeFirstDecisionSignature(b));
    expect(nativeFirstDecisionSignature(facts(presenting(Y)))).not.toBe(nativeFirstDecisionSignature(a));
    expect(nativeFirstDecisionSignature(facts({ store: { mode: 'active', generation: 2, ready: [] } })))
      .not.toBe(nativeFirstDecisionSignature(facts({ store: { mode: 'active', generation: 3, ready: [SHA_X] } })));
  });
});

describe('§4.3 re-attach and reconcile', () => {
  it('presenting X, page wants native X → adopt (intend X at the boundary with the new lease): nothing on glass', () => {
    expect(reconcileFace(facts(presenting(X)), { kind: 'native', identity: X, verified: true }, false)).toEqual({ kind: 'adopt', identity: X });
  });
  it('presenting X, page wants native Y verified → intend Y at X\'s boundary (one native switch)', () => {
    expect(reconcileFace(facts(presenting(X)), { kind: 'native', identity: Y, verified: true }, false)).toEqual({ kind: 'intend', identity: Y, start: 'boundary' });
  });
  it('presenting X, page wants native Y not verified → adopt X until Y is verified', () => {
    const f = facts({ ...presenting(X), intent: { ...X } });
    expect(reconcileFace(f, { kind: 'native', identity: Y, verified: false }, false)).toEqual({ kind: 'adopt', identity: X });
    // No intent the page could re-send: X keeps playing unattended; nothing sent.
    expect(reconcileFace(facts(presenting(X)), { kind: 'native', identity: Y, verified: false }, false)).toEqual({ kind: 'nothing' });
  });
  it('presenting X, page wants web content → release at X\'s boundary (after the web content painted)', () => {
    expect(reconcileFace(facts(presenting(X)), { kind: 'web' }, false)).toEqual({ kind: 'release', at: 'boundary' });
  });
  it('presenting X, but the manifest carries an alert → the hold raises first; nothing native is sent', () => {
    expect(reconcileFace(facts(presenting(X)), { kind: 'native', identity: X, verified: true }, true)).toEqual({ kind: 'hold-first' });
    expect(reconcileFace(facts(presenting(X)), { kind: 'web' }, true)).toEqual({ kind: 'hold-first' });
  });
  it('idle, intent suspended by the hold, no alert → restore: intend X now (frame 0)', () => {
    const f = facts({ intent: { ...X, suspended: 'hold' } });
    expect(reconcileFace(f, { kind: 'native', identity: X, verified: true }, false)).toEqual({ kind: 'intend', identity: X, start: 'now' });
  });
  it('idle, page wants native X still downloading → nothing yet', () => {
    expect(reconcileFace(facts(), { kind: 'native', identity: X, verified: false }, false)).toEqual({ kind: 'nothing' });
  });
  it('idle but the app holds an intent, page wants web → release now; nothing held → nothing', () => {
    expect(reconcileFace(facts({ intent: { ...X, suspended: 'hold' } }), { kind: 'web' }, false)).toEqual({ kind: 'release', at: 'now' });
    expect(reconcileFace(facts(), { kind: 'web' }, false)).toEqual({ kind: 'nothing' });
  });
  it('the page never treats "I just booted" as "nothing is on glass": undecided → nothing', () => {
    expect(reconcileFace(facts(presenting(X)), { kind: 'undecided' }, false)).toEqual({ kind: 'nothing' });
  });
  it('an app without v4 is never addressed', () => {
    expect(reconcileFace(readNativeFirstFacts(reply({ protocolMax: 3, ...presenting(X) })), { kind: 'web' }, false)).toEqual({ kind: 'nothing' });
    expect(reconcileFace(null, { kind: 'native', identity: X, verified: true }, false)).toEqual({ kind: 'nothing' });
  });
});

describe('§6 store-mode readiness — mediaReadiness unchanged, only its inputs move', () => {
  const store = (ready: string[], mode: 'off' | 'adopting' | 'active' = 'active') =>
    readNativeStoreBlock({ mode, generation: 1, ready })!;
  const item: ReadinessItem = { id: 'i1', large: true, cacheKey: 'k-x' };
  it('lookupCached shape from the store: current = verified by digest; no digest = not answered', () => {
    expect(storeLookupCached([{ url: 'u-x', sha256: SHA_X }, { url: 'u-y', sha256: SHA_Y }, { url: 'u-img' }], store([SHA_X]))).toEqual({
      'u-x': { present: true, current: true },
      'u-y': { present: false, current: false },
    });
  });
  it('store mode: the drive is ready (never unavailable) and the native file is on disk only when the STORE has it', () => {
    const none = storeModeReadiness({ storeMode: true, store: store([]), workerDrive: 'ready', workerKeys: new Set(['k-x']), nativeFiles: [{ key: 'k-x', sha256: SHA_X }] });
    expect(none.source).toBe('store');
    expect(none.cacheDrive).toBe('ready');
    // The worker's copy does not count for a native-selected file (native reads the store).
    expect(isItemReady(item, none.cacheDrive, none.onDisk)).toBe(false);
    const got = storeModeReadiness({ storeMode: true, store: store([SHA_X]), workerDrive: 'unavailable', workerKeys: new Set(), nativeFiles: [{ key: 'k-x', sha256: SHA_X }] });
    expect(got.cacheDrive).toBe('ready');
    expect([...readyItemIds([item], got.cacheDrive, got.onDisk)]).toEqual(['i1']);
  });
  it('a worker that never registered does not make a store-mode face stream its native file', () => {
    const r = storeModeReadiness({ storeMode: true, store: store([]), workerDrive: 'unavailable', workerKeys: new Set(), nativeFiles: [{ key: 'k-x', sha256: SHA_X }] });
    expect(r.cacheDrive).not.toBe('unavailable');
    expect(isItemReady(item, r.cacheDrive, r.onDisk)).toBe(false);
  });
  it('a store read failure, a store not active, the switch off or no native file → the worker path, unchanged', () => {
    const worker = { workerDrive: 'unavailable' as const, workerKeys: new Set(['k-w']), nativeFiles: [{ key: 'k-x', sha256: SHA_X }] };
    for (const r of [
      storeModeReadiness({ storeMode: true, store: null, ...worker }),
      storeModeReadiness({ storeMode: true, store: store([SHA_X], 'adopting'), ...worker }),
      storeModeReadiness({ storeMode: false, store: store([SHA_X]), ...worker }),
      storeModeReadiness({ storeMode: true, store: store([SHA_X]), ...worker, nativeFiles: [] }),
    ]) {
      expect(r).toEqual({ cacheDrive: 'unavailable', onDisk: worker.workerKeys, source: 'worker' });
    }
  });
  it('a generation change re-reads: the same face answers again from the new ready list', () => {
    const before = storeModeReadiness({ storeMode: true, store: store([]), workerDrive: 'ready', workerKeys: new Set(), nativeFiles: [{ key: 'k-x', sha256: SHA_X }] });
    const after = storeModeReadiness({ storeMode: true, store: store([SHA_X]), workerDrive: 'ready', workerKeys: new Set(), nativeFiles: [{ key: 'k-x', sha256: SHA_X }] });
    expect(isItemReady(item, before.cacheDrive, before.onDisk)).toBe(false);
    expect(isItemReady(item, after.cacheDrive, after.onDisk)).toBe(true);
  });
});

describe('the per-document controller', () => {
  function rig(replies: unknown[] = [reply()]) {
    const fired: Array<[string, string]> = [];
    let n = 0;
    const timers = new Map<number, () => void>();
    let id = 0;
    let clock = 0;
    const bridge = {
      has: jest.fn(() => true),
      fire: jest.fn((m: string, a: string) => { fired.push([m, a]); return true; }),
      state: jest.fn(async () => replies[Math.min(n++, replies.length - 1)]),
    };
    const face = new NativeFirstFace(bridge, {
      lease: LEASE,
      now: () => clock,
      timers: { set: (fn) => { const h = ++id; timers.set(h, fn); return h; }, clear: (h) => { timers.delete(h as number); } },
    });
    const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
    const runTimers = async () => { const fns = [...timers.values()]; timers.clear(); fns.forEach((f) => f()); await flush(); };
    return { face, bridge, fired, timers, runTimers, advance: (ms: number) => { clock += ms; } };
  }

  it('sends nothing before the app advertised v4, and nothing to an app that never does', async () => {
    const r = rig([reply({ protocolMax: 3 })]);
    expect(r.face.intend(X, 'now')).toBe(false);
    await r.face.read();
    expect(r.face.intend(X, 'now')).toBe(false);
    expect(r.face.release('now')).toBe(false);
    expect(r.face.sync('tag')).toBe(false);
    expect(r.fired).toEqual([]);
  });

  it('intend / release / sync go out on sharedVideoPrepare with this document\'s lease', async () => {
    const r = rig();
    await r.face.read();
    expect(r.face.intend(X, 'now')).toBe(true);
    expect(r.face.release('boundary')).toBe(true);
    expect(r.face.sync('etag-1', 'set-1')).toBe(true);
    expect(r.fired.map(([m]) => m)).toEqual(['sharedVideoPrepare', 'sharedVideoPrepare', 'sharedVideoPrepare']);
    expect(JSON.parse(r.fired[0][1])).toMatchObject({ version: 4, op: 'intend', lease: LEASE });
    expect(JSON.parse(r.fired[1][1])).toMatchObject({ version: 4, op: 'release', lease: LEASE, at: 'boundary' });
    // The same sync is sent once; a new tag goes out.
    expect(r.face.sync('etag-1', 'set-1')).toBe(false);
    expect(r.face.sync('etag-2', 'set-1')).toBe(true);
  });

  it('the same message is not repeated inside a second (StrictMode, re-renders), and is after it', async () => {
    const r = rig();
    await r.face.read();
    r.face.intend(X, 'now');
    r.face.intend(X, 'now');
    expect(r.fired).toHaveLength(1);
    r.advance(1_001);
    r.face.intend(X, 'now');
    expect(r.fired).toHaveLength(2);
  });

  it('a read that never answers resolves null after 2 s and never replaces the last facts', async () => {
    const r = rig([reply({ ...presenting(X) })]);
    await r.face.read();
    expect(r.face.presenting()).toBe(true);
    r.bridge.state.mockImplementationOnce(() => new Promise(() => undefined));
    const p = r.face.read();
    await r.runTimers();
    expect(await p).toBeNull();
    expect(r.face.presenting()).toBe(true);
  });

  it('polls only while something holds interest; reads are single-flight', async () => {
    const r = rig();
    const release = r.face.hold();
    await r.runTimers();
    expect(r.bridge.state).toHaveBeenCalledTimes(1);
    await r.runTimers();
    expect(r.bridge.state).toHaveBeenCalledTimes(2);
    release();
    await r.runTimers();
    await r.runTimers();
    expect(r.bridge.state).toHaveBeenCalledTimes(2);
    const a = r.face.read();
    const b = r.face.read();
    expect(a).toBe(b);
  });

  it('the settle rule lives with the document (a reload starts clean)', () => {
    const r = rig();
    const key = 'k';
    for (let i = 0; i < 6; i++) r.face.ends.ended(key, 'operator-ui', i);
    expect(r.face.ends.settled(key)).toBe(true);
    expect(rig().face.ends.settled(key)).toBe(false);
  });
});
