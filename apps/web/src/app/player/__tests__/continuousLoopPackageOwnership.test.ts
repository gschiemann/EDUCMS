/** @jest-environment node */
import { webcrypto } from 'node:crypto';
import type { LoopPackage } from '../continuousLoopPackage';

jest.mock('../offline-cache', () => ({
  lookupCached: async (items: Array<{ url: string }>) =>
    Object.fromEntries(items.map(({ url }) => [url, { current: true }])),
}));

// Only MP4 parsing is synthetic. Package preparation, cache ownership, hashes,
// publication and readback all exercise the real implementation.
jest.mock('mp4box', () => ({
  createFile: () => {
    const samples = [{ dts: 0, cts: 0, duration: 30, is_sync: true }];
    const track = { id: 1, codec: 'avc1.640028', timescale: 30 };
    const trak = { boxes: [], mdia: { minf: { stbl: { stts: { sample_counts: [1], sample_deltas: [30] } } } } };
    let opened = false;
    const file: any = {
      appendBuffer: () => {
        if (!opened) { opened = true; file.onReady({ videoTracks: [track], isFragmented: false }); }
      },
      getTrackSamplesInfo: () => samples,
      getTrackById: () => trak,
      setSegmentOptions: () => {},
      initializeSegmentation: () => [{ buffer: new Uint8Array([1, 2, 3]).buffer }],
      start: () => file.onSegment(1, null, new Uint8Array([4, 5, 6]).buffer, 1),
      releaseUsedSamples: () => {},
      getAllocatedSampleDataSize: () => 0,
      flush: () => {},
      stop: () => {},
    };
    return file;
  },
}));

type PackageModule = typeof import('../continuousLoopPackage');
function documentModule(): PackageModule {
  let instance!: PackageModule;
  // Each face has its own module state, but CacheStorage is origin-wide.
  jest.isolateModules(() => { instance = require('../continuousLoopPackage'); });
  return instance;
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => { resolve = r; });
  return { promise, resolve };
}

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const source = 'https://player.example/clip.mp4';
const signal = () => new AbortController().signal;
const normalize = (key: string | Request) => new URL(typeof key === 'string' ? key : key.url, 'https://player.example').href;

function cacheStore() {
  const entries = new Map<string, Response>();
  return {
    entries,
    match: jest.fn(async (key: string | Request) => entries.get(normalize(key))?.clone()),
    put: jest.fn(async (key: string | Request, response: Response) => { entries.set(normalize(key), response.clone()); }),
    delete: jest.fn(async (key: string | Request) => entries.delete(normalize(key))),
    keys: jest.fn(async () => [...entries.keys()].map((url) => new Request(url))),
  };
}

let packages: ReturnType<typeof cacheStore>;
beforeEach(() => {
  packages = cacheStore();
  const playlist = cacheStore();
  playlist.entries.set(source, new Response(new Uint8Array([0, 0, 0, 1])));
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: webcrypto });
  Object.defineProperty(globalThis, 'MediaSource', { configurable: true, value: { isTypeSupported: () => true } });
  Object.defineProperty(globalThis, 'caches', { configurable: true, value: {
    keys: async () => ['edu-player-playlist-v1'],
    open: async (name: string) => name === 'edu-player-playlist-v1' ? playlist : packages,
  } });
});

async function expectReadable(mod: PackageModule, p: LoopPackage) {
  for (const fragment of [p.init, ...p.fragments]) {
    expect((await mod.readLoopFragment(packages as unknown as Cache, fragment, signal())).byteLength).toBe(fragment.bytes);
  }
}

test('preparing a different face video preserves the package already playing on the first face', async () => {
  const front = documentModule();
  const back = documentModule();
  const first = await front.prepareLoopPackage(source, A, signal());
  const second = await back.prepareLoopPackage(source, B, signal());
  await expectReadable(front, first);
  await expectReadable(back, second);
  expect(packages.delete).not.toHaveBeenCalled();
});

test('concurrent same-hash publications retain both returned immutable packages', async () => {
  const front = documentModule();
  const back = documentModule();
  const publicationReady = deferred();
  const releasePublication = deferred();
  const originalPut = packages.put.getMockImplementation()!;
  let held = false;
  packages.put.mockImplementation(async (key, value) => {
    if (String(key).endsWith('/manifest') && !held) {
      held = true;
      publicationReady.resolve();
      await releasePublication.promise;
    }
    await originalPut(key, value);
  });
  const pendingFirst = front.prepareLoopPackage(source, A, signal());
  await publicationReady.promise; // front's fragments exist; its manifest does not
  const second = await back.prepareLoopPackage(source, A, signal());
  releasePublication.resolve();
  const first = await pendingFirst;
  expect(first.init.key).not.toBe(second.init.key);
  await expectReadable(front, first);
  await expectReadable(back, second);
  const reused = await documentModule().prepareLoopPackage(source, A, signal());
  await expectReadable(front, reused);
});

test('quota failure removes only this attempt’s unpublished namespace and preserves playing bytes', async () => {
  const front = documentModule();
  const first = await front.prepareLoopPackage(source, A, signal());
  const originalPut = packages.put.getMockImplementation()!;
  packages.put.mockImplementation(async (key, value) => {
    if (String(key).includes(`/${B}/`) && String(key).endsWith('/0')) {
      throw new DOMException('Cache full', 'QuotaExceededError');
    }
    await originalPut(key, value);
  });
  await expect(documentModule().prepareLoopPackage(source, B, signal())).rejects.toMatchObject({ name: 'QuotaExceededError' });
  await expectReadable(front, first);
  expect([...packages.entries.keys()].some((key) => key.includes(`/${B}/`))).toBe(false);
  expect(packages.delete.mock.calls.every(([key]) => normalize(key).includes(`/${B}/`))).toBe(true);
});

test('an invalid manifest is replaced only when its new package has completely committed', async () => {
  const front = documentModule();
  const first = await front.prepareLoopPackage(source, A, signal());
  const manifestKey = first.init.key.replace(/\/[^/]+\/init$/, '/manifest').replace(`/${A}/`, `/${B}/`);
  await packages.put(manifestKey, new Response(JSON.stringify({ version: -1 })));
  const second = await documentModule().prepareLoopPackage(source, B, signal());
  await expectReadable(front, first);
  await expectReadable(front, second);
  expect(packages.delete).not.toHaveBeenCalled();
  expect((await (await packages.match(manifestKey))!.json()).sourceHash).toBe(B);
});
