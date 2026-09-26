/**
 * @jest-environment node
 *
 * The REAL service worker (public/sw-player.js) vm-loaded with Node's web
 * primitives (Response / ReadableStream / Blob / crypto) over an in-memory
 * CacheStorage and a fetch that speaks HTTP Range. This drives the large-asset
 * staging protocol exactly the way offline-cache.ts drives it and checks the
 * bytes that end up under the playlist URL against node:crypto.
 *
 * Why a node environment: jsdom has no Response/ReadableStream, and these
 * are the objects whose streaming behaviour the fix depends on.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- vm / fake-worker harness: replies are untyped by design */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createContext, runInContext } from 'node:vm';
import { createHash, randomBytes } from 'node:crypto';

const ORIGIN = 'https://venue-os.app';
const SW_SOURCE = readFileSync(resolve(__dirname, '../../../../public/sw-player.js'), 'utf8');
const MiB = 1024 * 1024;

type Stored = { status: number; headers: [string, string][]; bytes: Uint8Array };

class FakeCache {
  entries = new Map<string, Stored>();
  async keys() { return [...this.entries.keys()].map((u) => new Request(u)); }
  async match(req: Request | string, opts?: { ignoreSearch?: boolean }) {
    const url = typeof req === 'string' ? req : req.url;
    let key: string | undefined = this.entries.has(url) ? url : undefined;
    if (!key && opts?.ignoreSearch) {
      const stripped = url.split('?')[0];
      key = [...this.entries.keys()].find((k) => k.split('?')[0] === stripped);
    }
    if (!key) return undefined;
    const e = this.entries.get(key)!;
    return new Response(e.bytes.slice(), { status: e.status, headers: e.headers });
  }
  async put(req: Request | string, res: Response) {
    const url = typeof req === 'string' ? req : req.url;
    const bytes = new Uint8Array(await res.arrayBuffer());
    this.entries.set(url, { status: res.status, headers: [...res.headers.entries()], bytes });
  }
  async delete(req: Request | string) {
    const url = typeof req === 'string' ? req : req.url;
    return this.entries.delete(url);
  }
}

type RangeServer = {
  file: Uint8Array;
  ignoreRange?: boolean;
  exposeContentRange?: boolean;
  lastModified?: string;
  calls: Array<{ range: string | null }>;
  status?: number;
};

function rangeFetch(server: RangeServer) {
  return async (input: Request | string, init?: { signal?: AbortSignal }) => {
    const req = typeof input === 'string' ? new Request(input, init) : input;
    const range = req.headers.get('range');
    server.calls.push({ range });
    if (server.status) return new Response(null, { status: server.status });
    const headers: Record<string, string> = { 'content-type': 'video/mp4' };
    if (server.lastModified) headers['last-modified'] = server.lastModified;
    const m = range ? /^bytes=(\d+)-(\d*)$/.exec(range) : null;
    if (!m || server.ignoreRange) {
      headers['content-length'] = String(server.file.length);
      return new Response(server.file.slice(), { status: 200, headers });
    }
    const start = Number(m[1]);
    if (start >= server.file.length) {
      return new Response(null, { status: 416, headers: { 'content-range': `bytes */${server.file.length}` } });
    }
    const end = Math.min(m[2] === '' ? server.file.length - 1 : Number(m[2]), server.file.length - 1);
    const body = server.file.slice(start, end + 1);
    headers['content-length'] = String(body.length);
    if (server.exposeContentRange !== false) headers['content-range'] = `bytes ${start}-${end}/${server.file.length}`;
    return new Response(body, { status: 206, headers });
  };
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function loadWorker() {
  const handlers: Record<string, (event: any) => void> = {};
  const cacheMap = new Map<string, FakeCache>();
  const caches = { open: async (name: string) => { if (!cacheMap.has(name)) cacheMap.set(name, new FakeCache()); return cacheMap.get(name)!; } };
  // The worker builds relative Requests ("/__edu_meta__/…") against its own
  // origin; Node's Request needs them absolute.
  class CtxRequest extends Request {
    constructor(input: any, init?: any) {
      super(typeof input === 'string' && input.startsWith('/') ? ORIGIN + input : input, init);
    }
  }
  const self: any = {
    location: { origin: ORIGIN },
    addEventListener: (type: string, handler: (event: any) => void) => { handlers[type] = handler; },
    clients: { matchAll: async () => [] },
  };
  self.self = self;
  const context: any = createContext({
    self, caches, console, URL, Request: CtxRequest, Response, Headers, Blob, ReadableStream,
    crypto, AbortController, setTimeout, clearTimeout, Map, Set, Date, JSON, Math, Number,
    TextEncoder, TextDecoder, fetch: () => { throw new Error('fetch not configured'); },
  });
  runInContext(SW_SOURCE, context);
  const hooks = self.__swTestHooks;
  // PRECACHE_PLAYLIST acks `{ started: true }` first and its result second;
  // every other message answers once. Resolve on the real reply.
  const send = (data: Record<string, unknown>) => new Promise<any>((resolvePort) => {
    handlers.message({
      data,
      ports: [{ postMessage: (reply: any) => { if (!(reply && reply.started === true)) resolvePort(reply); } }],
      waitUntil: () => undefined,
    });
  });
  const cacheNamed = (name: string) => cacheMap.get(name) ?? new FakeCache();
  return { context, hooks, send, cacheNamed, setFetch: (fn: unknown) => { context.fetch = fn; } };
}

/** Exactly what offline-cache.ts does: chunks until complete, verify, assemble. */
async function drive(worker: ReturnType<typeof loadWorker>, asset: { url: string; sha256: string | null; size: number | null }, chunkBytes: number) {
  const steps: any[] = [];
  let offset = 0;
  for (let i = 0; i < 64; i++) {
    const reply = await worker.send({ type: 'PRECACHE_CHUNK', ...asset, offset, chunkBytes });
    steps.push(reply);
    if (!reply.ok) return { steps, verify: null, assemble: null };
    offset = reply.nextOffset;
    if (reply.complete) break;
  }
  const verify = await worker.send({ type: 'PRECACHE_VERIFY', url: asset.url, sha256: asset.sha256 });
  if (!verify.ok) return { steps, verify, assemble: null };
  const assemble = await worker.send({ type: 'PRECACHE_ASSEMBLE', url: asset.url, sha256: asset.sha256 });
  return { steps, verify, assemble };
}

describe('sw-player large-asset staging', () => {
  const URL_4K = 'https://cdn.example.com/storage/v1/object/public/assets/t1/4k.mp4?token=abc';

  it('PRECACHE_PLAYLIST leaves a large asset undownloaded and reports it as pending', async () => {
    const w = loadWorker();
    const server: RangeServer = { file: randomBytes(64 * 1024), calls: [] };
    w.setFetch(rangeFetch(server));
    const reply = await w.send({ type: 'PRECACHE_PLAYLIST', assets: [
      { url: 'https://cdn.example.com/small.jpg', size: 64 * 1024 },
      { url: URL_4K, size: 141_245_550, sha256: 'a'.repeat(64) },
    ] });
    expect(reply).toMatchObject({ ok: false, failures: 0, count: 2 });
    expect(reply.pending).toEqual([{ url: URL_4K, sha256: 'a'.repeat(64), size: 141_245_550 }]);
    // Only the small image was fetched — one plain request, no Range.
    expect(server.calls).toEqual([{ range: null }]);
    expect(w.hooks.isLargeAsset({ url: 'https://x/y.mp4' })).toBe(true); // unknown size, video URL
    expect(w.hooks.isLargeAsset({ url: 'https://x/y.jpg' })).toBe(false);
    expect(w.hooks.isLargeAsset({ url: 'https://x/y.jpg', size: w.hooks.LARGE_ASSET_BYTES })).toBe(true);
  });

  it('chunk → verify → assemble yields a byte-exact, digest-verified playlist entry', async () => {
    const w = loadWorker();
    const file = randomBytes(2 * MiB + 512 * 1024);
    const server: RangeServer = { file, calls: [], lastModified: 'Thu, 25 Sep 2026 12:00:00 GMT' };
    w.setFetch(rangeFetch(server));
    const asset = { url: URL_4K, sha256: sha256Hex(file), size: file.length };
    const { steps, verify, assemble } = await drive(w, asset, MiB);
    expect(server.calls.map((c) => c.range)).toEqual([
      'bytes=0-1048575', 'bytes=1048576-2097151', `bytes=2097152-${file.length - 1}`,
    ]);
    expect(steps.map((s) => [s.ok, s.nextOffset, s.complete])).toEqual([
      [true, MiB, false], [true, 2 * MiB, false], [true, file.length, true],
    ]);
    expect(verify).toMatchObject({ ok: true, total: file.length, verified: true });
    expect(assemble).toMatchObject({ ok: true, total: file.length });

    const playlist = w.cacheNamed(w.hooks.PLAYLIST_CACHE);
    const stored = playlist.entries.get(URL_4K)!;
    expect(stored).toBeDefined();
    expect(Buffer.from(stored.bytes).equals(Buffer.from(file))).toBe(true);
    expect(Object.fromEntries(stored.headers)).toMatchObject({
      'content-type': 'video/mp4', 'content-length': String(file.length), 'accept-ranges': 'bytes',
    });
    // Same meta rows fetchAndStore writes: digest, size, stored-at.
    const meta = w.cacheNamed(w.hooks.META_CACHE);
    const metaKeys = [...meta.entries.keys()];
    expect(metaKeys.some((k) => k.startsWith(`${ORIGIN}/__edu_meta__/`))).toBe(true);
    expect(metaKeys.some((k) => k.startsWith(`${ORIGIN}/__edu_meta_size__/`))).toBe(true);
    expect(metaKeys.some((k) => k.startsWith(`${ORIGIN}/__edu_meta_stored_at__/`))).toBe(true);
    // Staging is gone, the lookup says cached, and a second playlist push is a no-op.
    expect(w.cacheNamed(w.hooks.STAGING_CACHE).entries.size).toBe(0);
    const lookup = await w.send({ type: 'CACHE_LOOKUP', urls: [{ url: URL_4K, sha256: asset.sha256 }, { url: 'https://cdn.example.com/other.mp4' }] });
    expect(lookup.cached).toEqual({ [URL_4K]: true, 'https://cdn.example.com/other.mp4': false });
    const callsBefore = server.calls.length;
    const again = await w.send({ type: 'PRECACHE_PLAYLIST', assets: [asset] });
    expect(again).toMatchObject({ ok: true, failures: 0, count: 1, pending: [] });
    expect(server.calls.length).toBe(callsBefore);
  });

  it('resumes from staged chunks: a restarted driver re-fetches nothing it already has', async () => {
    const w = loadWorker();
    const file = randomBytes(3 * MiB);
    const server: RangeServer = { file, calls: [] };
    w.setFetch(rangeFetch(server));
    const asset = { url: URL_4K, sha256: sha256Hex(file), size: file.length };
    // First "session": two chunks, then the worker is killed / the page reloads.
    const c0 = await w.send({ type: 'PRECACHE_CHUNK', ...asset, offset: 0, chunkBytes: MiB });
    const c1 = await w.send({ type: 'PRECACHE_CHUNK', ...asset, offset: c0.nextOffset, chunkBytes: MiB });
    expect(c1.nextOffset).toBe(2 * MiB);
    expect(server.calls.length).toBe(2);
    // Second session starts from zero again. (It asks for half-MiB chunks; the
    // worker clamps to its 1 MiB floor, so the one missing chunk is one fetch.)
    const { steps, assemble } = await drive(w, asset, MiB / 2);
    expect(steps.slice(0, 2).map((s) => s.staged)).toEqual([true, true]);
    expect(server.calls.length).toBe(3); // only the missing third was fetched
    expect(server.calls[2].range).toBe(`bytes=${2 * MiB}-${3 * MiB - 1}`);
    expect(assemble.ok).toBe(true);
    expect(Buffer.from(w.cacheNamed(w.hooks.PLAYLIST_CACHE).entries.get(URL_4K)!.bytes).equals(Buffer.from(file))).toBe(true);
  });

  it('a digest mismatch is never promoted and the staging is discarded', async () => {
    const w = loadWorker();
    const file = randomBytes(MiB + 10);
    const server: RangeServer = { file, calls: [] };
    w.setFetch(rangeFetch(server));
    const { verify, assemble } = await drive(w, { url: URL_4K, sha256: 'f'.repeat(64), size: file.length }, MiB);
    expect(verify).toEqual({ ok: false, reason: 'sha256-mismatch' });
    expect(assemble).toBeNull();
    expect(w.cacheNamed(w.hooks.PLAYLIST_CACHE).entries.size).toBe(0);
    expect(w.cacheNamed(w.hooks.STAGING_CACHE).entries.size).toBe(0);
    // Assembling without a verification marker is refused too.
    const forced = await w.send({ type: 'PRECACHE_ASSEMBLE', url: URL_4K, sha256: 'f'.repeat(64) });
    expect(forced).toEqual({ ok: false, reason: 'not-verified' });
  });

  it('a server that ignores Range still completes from offset 0 in one body', async () => {
    const w = loadWorker();
    const file = randomBytes(MiB + 3);
    const server: RangeServer = { file, calls: [], ignoreRange: true };
    w.setFetch(rangeFetch(server));
    const asset = { url: URL_4K, sha256: sha256Hex(file), size: file.length };
    const { steps, assemble } = await drive(w, asset, MiB);
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({ ok: true, nextOffset: file.length, total: file.length, complete: true });
    expect(assemble.ok).toBe(true);
    expect(Buffer.from(w.cacheNamed(w.hooks.PLAYLIST_CACHE).entries.get(URL_4K)!.bytes).equals(Buffer.from(file))).toBe(true);
  });

  it('a full 200 at a non-zero offset is refused and the staging purged', async () => {
    const w = loadWorker();
    const file = randomBytes(2 * MiB);
    const server: RangeServer = { file, calls: [] };
    w.setFetch(rangeFetch(server));
    const asset = { url: URL_4K, sha256: sha256Hex(file), size: file.length };
    const c0 = await w.send({ type: 'PRECACHE_CHUNK', ...asset, offset: 0, chunkBytes: MiB });
    expect(c0.ok).toBe(true);
    server.ignoreRange = true;
    const c1 = await w.send({ type: 'PRECACHE_CHUNK', ...asset, offset: MiB, chunkBytes: MiB });
    expect(c1).toEqual({ ok: false, reason: 'range-unsupported', offset: MiB });
    expect(w.cacheNamed(w.hooks.STAGING_CACHE).entries.size).toBe(0);
  });

  it('finds the end of the file without a total: a short chunk, or a 416 after an exact multiple', async () => {
    // Content-Range hidden (what a CORS response without expose-headers looks like), no manifest size.
    const w = loadWorker();
    const short = randomBytes(MiB + 77);
    const server: RangeServer = { file: short, calls: [], exposeContentRange: false };
    w.setFetch(rangeFetch(server));
    const a1 = { url: URL_4K, sha256: sha256Hex(short), size: null };
    const r1 = await drive(w, a1, MiB);
    expect(r1.steps.map((s) => [s.nextOffset, s.total, s.complete])).toEqual([[MiB, null, false], [short.length, short.length, true]]);
    expect(r1.assemble.ok).toBe(true);

    const w2 = loadWorker();
    const exact = randomBytes(2 * MiB);
    const server2: RangeServer = { file: exact, calls: [], exposeContentRange: false };
    w2.setFetch(rangeFetch(server2));
    const a2 = { url: URL_4K, sha256: sha256Hex(exact), size: null };
    const r2 = await drive(w2, a2, MiB);
    expect(r2.steps).toHaveLength(3);
    expect(r2.steps[2]).toMatchObject({ ok: true, complete: true, total: 2 * MiB, nextOffset: 2 * MiB });
    expect(r2.assemble.ok).toBe(true);
    expect(Buffer.from(w2.cacheNamed(w2.hooks.PLAYLIST_CACHE).entries.get(URL_4K)!.bytes).equals(Buffer.from(exact))).toBe(true);
  });

  it('refuses a manifest size that disagrees with the file, and a source that changed mid-download', async () => {
    const w = loadWorker();
    const file = randomBytes(2 * MiB);
    const server: RangeServer = { file, calls: [], lastModified: 'Thu, 25 Sep 2026 12:00:00 GMT' };
    w.setFetch(rangeFetch(server));
    const wrongSize = await w.send({ type: 'PRECACHE_CHUNK', url: URL_4K, sha256: null, size: 999, offset: 0, chunkBytes: MiB });
    expect(wrongSize).toEqual({ ok: false, reason: 'size-mismatch', offset: 0 });

    const asset = { url: URL_4K, sha256: null, size: file.length };
    const c0 = await w.send({ type: 'PRECACHE_CHUNK', ...asset, offset: 0, chunkBytes: MiB });
    expect(c0.ok).toBe(true);
    server.lastModified = 'Fri, 26 Sep 2026 09:00:00 GMT';
    const c1 = await w.send({ type: 'PRECACHE_CHUNK', ...asset, offset: MiB, chunkBytes: MiB });
    expect(c1).toEqual({ ok: false, reason: 'source-changed', offset: MiB });
    expect(w.cacheNamed(w.hooks.STAGING_CACHE).entries.size).toBe(0);
  });

  it('an asset with no digest is assembled unverified (the null-hash rule) and reported as such', async () => {
    const w = loadWorker();
    const file = randomBytes(MiB + 1);
    w.setFetch(rangeFetch({ file, calls: [] }));
    const { verify, assemble } = await drive(w, { url: URL_4K, sha256: null, size: file.length }, MiB);
    expect(verify).toMatchObject({ ok: true, verified: false });
    expect(assemble.ok).toBe(true);
    const meta = w.cacheNamed(w.hooks.META_CACHE);
    expect([...meta.entries.keys()].some((k) => k.startsWith(`${ORIGIN}/__edu_meta__/`))).toBe(false);
  });

  it('PRECACHE_PLAYLIST drops staged chunks for URLs that left the manifest', async () => {
    const w = loadWorker();
    const file = randomBytes(2 * MiB);
    w.setFetch(rangeFetch({ file, calls: [] }));
    await w.send({ type: 'PRECACHE_CHUNK', url: URL_4K, sha256: null, size: file.length, offset: 0, chunkBytes: MiB });
    expect(w.cacheNamed(w.hooks.STAGING_CACHE).entries.size).toBeGreaterThan(0);
    await w.send({ type: 'PRECACHE_PLAYLIST', assets: [{ url: 'https://cdn.example.com/else.mp4', size: 50 * MiB }] });
    expect(w.cacheNamed(w.hooks.STAGING_CACHE).entries.size).toBe(0);
  });

  it('the incremental SHA-256 matches node:crypto across update boundaries', () => {
    const w = loadWorker();
    const { Sha256, sha256LengthWords } = w.hooks;
    for (const len of [0, 1, 3, 55, 56, 57, 63, 64, 65, 119, 120, 128, 1000, 4096, MiB + 17]) {
      const data = randomBytes(len);
      const expected = sha256Hex(data);
      const h = new Sha256();
      let i = 0;
      while (i < len) {
        const take = Math.min(len - i, 1 + Math.floor(Math.random() * 300));
        h.update(data.subarray(i, i + take));
        i += take;
      }
      expect(h.digestHex()).toBe(expected);
      expect(h.digestHex()).toBe(expected); // idempotent after finishing
    }
    expect(new Sha256().update(Buffer.from('abc')).digestHex())
      .toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(sha256LengthWords(0)).toEqual([0, 0]);
    expect(sha256LengthWords(64)).toEqual([0, 512]);
    expect(sha256LengthWords(0x20000000 + 1)).toEqual([1, 8]); // 512 MiB + 1 byte needs the high word
  });

  it('parseContentRange and contiguousLayout are strict about shape', () => {
    const { parseContentRange, contiguousLayout } = loadWorker().hooks;
    expect(parseContentRange('bytes 0-1023/4096')).toEqual({ start: 0, end: 1023, total: 4096 });
    expect(parseContentRange('bytes 0-1023/*')).toEqual({ start: 0, end: 1023, total: null });
    expect(parseContentRange('bytes 10-5/100')).toBeNull();
    expect(parseContentRange('bytes 0-100/100')).toBeNull();
    expect(parseContentRange(null)).toBeNull();
    const chunks = [{ start: 0, length: 4 }, { start: 4, length: 4 }, { start: 2, length: 2 }, { start: 8, length: 2 }];
    expect(contiguousLayout(chunks, 10)).toMatchObject({ ok: true, nextOffset: 10 });
    expect(contiguousLayout(chunks, 10).chunks).toEqual([{ start: 0, length: 4 }, { start: 4, length: 4 }, { start: 8, length: 2 }]);
    expect(contiguousLayout([{ start: 0, length: 4 }, { start: 8, length: 2 }], 10)).toMatchObject({ ok: false, nextOffset: 4 });
    expect(contiguousLayout([{ start: 0, length: 4 }], null)).toMatchObject({ ok: false, nextOffset: 4 });
  });
});
