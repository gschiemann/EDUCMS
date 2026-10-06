/**
 * The REAL service worker (public/sw-player.js) vm-loaded with Node's web
 * primitives (Response / ReadableStream / Blob / crypto) over an in-memory
 * CacheStorage and a fetch that speaks HTTP Range. Shared by the staging
 * suites (`sw-large-asset-cache.test.ts`, `sw-emergency-large-assets.test.ts`)
 * so both drive the worker exactly the way offline-cache.ts drives it.
 *
 * Not a test file (no `.test.` in the name): Jest's testMatch skips it.
 * Node environment only — jsdom has no Response/ReadableStream.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- vm / fake-worker harness: replies are untyped by design */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createContext, runInContext } from 'node:vm';
import { createHash } from 'node:crypto';

export const ORIGIN = 'https://venue-os.app';
const SW_SOURCE = readFileSync(resolve(__dirname, '../../../../public/sw-player.js'), 'utf8');
export const MiB = 1024 * 1024;

export type Stored = { status: number; headers: [string, string][]; bytes: Uint8Array };

export class FakeCache {
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
    // Real Cache Storage is disk IO: the write lands, then the promise settles
    // a turn later. Without this hop two overlapping puts + reads could never
    // interleave here the way they do on a device (the cross-body test needs it).
    await new Promise((r) => setTimeout(r, 0));
  }
  async delete(req: Request | string) {
    const url = typeof req === 'string' ? req : req.url;
    return this.entries.delete(url);
  }
}

export type RangeServer = {
  file: Uint8Array;
  ignoreRange?: boolean;
  exposeContentRange?: boolean;
  lastModified?: string;
  calls: Array<{ range: string | null; url?: string }>;
  status?: number;
};

export function rangeFetch(server: RangeServer) {
  return async (input: Request | string, init?: { signal?: AbortSignal }) => {
    const req = typeof input === 'string' ? new Request(input, init) : input;
    const range = req.headers.get('range');
    server.calls.push({ range, url: req.url });
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

export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function loadWorker() {
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
    crypto, AbortController, setTimeout, clearTimeout, Map, Set, Date, JSON, Math, Number, Object,
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
  const fetchRequest = (request: Request) => new Promise<Response>((resolveResponse) => {
    handlers.fetch({ request, respondWith: (response: Promise<Response>) => resolveResponse(response as unknown as Response) });
  });
  const status = () => new Promise<any>((resolveStatus) => {
    handlers.message({ data: { type: 'STATUS_REQUEST' }, source: { postMessage: resolveStatus }, waitUntil: () => undefined });
  });
  /** Put bytes straight into a tier the way the old worker did: no meta rows at all. */
  const seedLegacyEntry = async (cacheName: string, url: string, bytes: Uint8Array) => {
    const cache = await caches.open(cacheName);
    await cache.put(url, new Response(bytes.slice(), { status: 200, headers: { 'content-type': 'video/mp4' } }));
  };
  return { context, hooks, send, cacheNamed, fetchRequest, status, seedLegacyEntry, setFetch: (fn: unknown) => { context.fetch = fn; } };
}

export type Worker = ReturnType<typeof loadWorker>;

/** Exactly what offline-cache.ts does: chunks until complete, verify, assemble. `tier` rides every step when given. */
export async function drive(
  worker: Worker,
  asset: { url: string; sha256: string | null; size: number | null },
  chunkBytes: number,
  tier?: string,
) {
  const t = tier ? { tier } : {};
  const steps: any[] = [];
  let offset = 0;
  for (let i = 0; i < 64; i++) {
    const reply = await worker.send({ type: 'PRECACHE_CHUNK', ...asset, offset, chunkBytes, ...t });
    steps.push(reply);
    if (!reply.ok) return { steps, verify: null, assemble: null };
    offset = reply.nextOffset;
    if (reply.complete) break;
  }
  const verify = await worker.send({ type: 'PRECACHE_VERIFY', url: asset.url, sha256: asset.sha256, ...t });
  if (!verify.ok) return { steps, verify, assemble: null };
  const assemble = await worker.send({ type: 'PRECACHE_ASSEMBLE', url: asset.url, sha256: asset.sha256, ...t });
  return { steps, verify, assemble };
}
