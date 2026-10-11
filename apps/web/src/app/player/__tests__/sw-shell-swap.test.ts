/** @jest-environment node */
/**
 * Off-hours update, worker side (2026-10-10), against the REAL worker:
 *   - PRECACHE_SHELL with a port acks { ok } only when the document and
 *     every referenced chunk landed; a missing chunk is `ok: false`
 *   - SHELL_SWAP_ARM makes exactly ONE navigation serve the pinned document
 *     from disk (network untouched); the next is network-first again
 *   - an expired arm is ignored; an arm with nothing pinned falls through
 *   - the media tiers are never touched by any of it
 */
import { loadWorker, ORIGIN } from './swHarness';

const HTML = (chunk: string) =>
  `<!doctype html><html><head><script src="/_next/static/chunks/${chunk}.js"></script>` +
  `<link rel="stylesheet" href="/_next/static/css/app.css"></head><body>player</body></html>`;

type Served = Record<string, { status: number; body: string; type?: string }>;

function networkOf(served: Served, calls: string[]) {
  return async (input: Request | string) => {
    const req = typeof input === 'string' ? new Request(input) : input;
    const path = new URL(req.url).pathname;
    calls.push(path);
    const hit = served[path];
    if (!hit) return new Response('', { status: 404 });
    return new Response(hit.body, { status: hit.status, headers: { 'content-type': hit.type || 'text/plain' } });
  };
}

const SHELL_CACHE = 'edu-player-shell-v9';
const PLAYLIST_CACHE = 'edu-player-playlist-v9';

/** The fetch handler only reads url / method / mode on a navigation. */
const navigation = (path: string) => ({ url: ORIGIN + path, method: 'GET', mode: 'navigate', headers: new Headers() }) as unknown as Request;

describe('PRECACHE_SHELL acknowledges the whole shell', () => {
  it('ok:true when the document and every chunk landed', async () => {
    const w = loadWorker();
    const calls: string[] = [];
    w.setFetch(networkOf({
      '/player': { status: 200, body: HTML('main-1'), type: 'text/html' },
      '/_next/static/chunks/main-1.js': { status: 200, body: 'js1' },
      '/_next/static/css/app.css': { status: 200, body: 'css' },
    }, calls));
    const ack = await w.send({ type: 'PRECACHE_SHELL' });
    expect(ack).toMatchObject({ ok: true, count: 3, added: 2, failures: 0 }); // document pinned in the route pass, two chunks added
    const shell = w.cacheNamed(SHELL_CACHE);
    expect(await shell.match(ORIGIN + '/player')).toBeDefined();
    expect(await shell.match(ORIGIN + '/_next/static/chunks/main-1.js')).toBeDefined();
  });

  it('ok:false when a chunk is missing — a partial shell is kept but not claimed', async () => {
    const w = loadWorker();
    w.setFetch(networkOf({
      '/player': { status: 200, body: HTML('main-2'), type: 'text/html' },
      '/_next/static/css/app.css': { status: 200, body: 'css' },
    }, []));
    const ack = await w.send({ type: 'PRECACHE_SHELL' });
    expect(ack).toMatchObject({ ok: false, failures: 1 });
    expect(await w.cacheNamed(SHELL_CACHE).match(ORIGIN + '/_next/static/css/app.css')).toBeDefined();
  });

  it('ok:false when the document itself cannot be fetched', async () => {
    const w = loadWorker();
    w.setFetch(async () => { throw new Error('offline'); });
    const ack = await w.send({ type: 'PRECACHE_SHELL' });
    expect(ack).toMatchObject({ ok: false });
    expect(ack.failures).toBeGreaterThanOrEqual(1);
  });

  it('a newer build replaces the pinned document and prunes the old chunks', async () => {
    const w = loadWorker();
    w.setFetch(networkOf({
      '/player': { status: 200, body: HTML('old'), type: 'text/html' },
      '/_next/static/chunks/old.js': { status: 200, body: 'old' },
      '/_next/static/css/app.css': { status: 200, body: 'css' },
    }, []));
    await w.send({ type: 'PRECACHE_SHELL' });
    w.setFetch(networkOf({
      '/player': { status: 200, body: HTML('new'), type: 'text/html' },
      '/_next/static/chunks/new.js': { status: 200, body: 'new' },
      '/_next/static/css/app.css': { status: 200, body: 'css' },
    }, []));
    const ack = await w.send({ type: 'PRECACHE_SHELL' });
    expect(ack).toMatchObject({ ok: true });
    const shell = w.cacheNamed(SHELL_CACHE);
    expect(await (await shell.match(ORIGIN + '/player'))!.text()).toContain('new.js');
    expect(await shell.match(ORIGIN + '/_next/static/chunks/new.js')).toBeDefined();
    // `old.js` was never served at runtime (no use stamp) → pruned.
    expect(await shell.match(ORIGIN + '/_next/static/chunks/old.js')).toBeUndefined();
  });
});

describe('SHELL_SWAP_ARM — one navigation from disk', () => {
  async function prepared() {
    const w = loadWorker();
    const calls: string[] = [];
    w.setFetch(networkOf({
      '/player': { status: 200, body: HTML('main-3'), type: 'text/html' },
      '/_next/static/chunks/main-3.js': { status: 200, body: 'js' },
      '/_next/static/css/app.css': { status: 200, body: 'css' },
    }, calls));
    await w.send({ type: 'PRECACHE_SHELL' });
    return { w, calls };
  }

  it('armed → the pinned document is served even with the network dead; the arm is consumed', async () => {
    const { w } = await prepared();
    expect(await w.send({ type: 'SHELL_SWAP_ARM', ttlMs: 60_000 })).toMatchObject({ ok: true });
    let networkHits = 0;
    w.setFetch(async () => { networkHits++; throw new Error('link down'); });
    const res = await w.fetchRequest(navigation('/player?screen=x&_v=1'));
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('main-3.js');
    // The background refresh hit the network once and failed quietly.
    await new Promise((r) => setTimeout(r, 5));
    expect(networkHits).toBe(1);
    // One-shot: the next navigation is network-first again → the offline fallback page, not the pin.
    const again = await w.fetchRequest(navigation('/player?screen=x&_v=2'));
    expect(await again.text()).toContain('main-3.js'); // offline → cached doc fallback (pre-existing behaviour)
    expect(networkHits).toBe(2);
  });

  it('armed with the network up → the pinned document is served (not the network copy) and the pin is refreshed afterwards', async () => {
    const { w } = await prepared();
    await w.send({ type: 'SHELL_SWAP_ARM' });
    const calls: string[] = [];
    w.setFetch(networkOf({ '/player': { status: 200, body: HTML('main-4'), type: 'text/html' } }, calls));
    const res = await w.fetchRequest(navigation('/player'));
    expect(await res.text()).toContain('main-3.js');
    await new Promise((r) => setTimeout(r, 10));
    expect(calls).toEqual(['/player']);
    expect(await (await w.cacheNamed(SHELL_CACHE).match(ORIGIN + '/player'))!.text()).toContain('main-4.js');
  });

  it('an expired arm is ignored (network-first)', async () => {
    const { w } = await prepared();
    await w.send({ type: 'SHELL_SWAP_ARM', ttlMs: 1 });
    await new Promise((r) => setTimeout(r, 5));
    w.setFetch(networkOf({ '/player': { status: 200, body: HTML('main-5'), type: 'text/html' } }, []));
    const res = await w.fetchRequest(navigation('/player'));
    expect(await res.text()).toContain('main-5.js');
  });

  it('armed with nothing pinned falls through to the network', async () => {
    const w = loadWorker();
    await w.send({ type: 'SHELL_SWAP_ARM' });
    w.setFetch(networkOf({ '/player': { status: 200, body: HTML('main-6'), type: 'text/html' } }, []));
    const res = await w.fetchRequest(navigation('/player'));
    expect(await res.text()).toContain('main-6.js');
  });

  it('a bogus ttl is clamped, never refused', async () => {
    const { w } = await prepared();
    expect(await w.send({ type: 'SHELL_SWAP_ARM', ttlMs: 'soon' })).toMatchObject({ ok: true });
    expect(await w.send({ type: 'SHELL_SWAP_ARM', ttlMs: 1e12 })).toMatchObject({ ok: true });
  });

  it('none of it touches the media tiers', async () => {
    const { w } = await prepared();
    await w.seedLegacyEntry(PLAYLIST_CACHE, ORIGIN + '/assets/clip.mp4', new Uint8Array([1, 2, 3]));
    await w.send({ type: 'SHELL_SWAP_ARM' });
    await w.fetchRequest(navigation('/player'));
    await w.send({ type: 'PRECACHE_SHELL' });
    expect(await w.cacheNamed(PLAYLIST_CACHE).match(ORIGIN + '/assets/clip.mp4')).toBeDefined();
  });
});
