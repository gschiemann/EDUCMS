/** @jest-environment node */
/**
 * Deploy skew, worker side (2026-10-27 field incident), against the REAL
 * worker: a saved player document is served only when every chunk it names
 * is saved too, and a chunk the network refuses is asked for once more past
 * the HTTP cache. The media tiers are never touched.
 */
import { loadWorker, ORIGIN } from './swHarness';

const SHELL = 'edu-player-shell-v9';
const EMERGENCY = 'edu-player-emergency-v9';
const doc = (chunk: string) =>
  `<!doctype html><html><head><script src="/_next/static/chunks/${chunk}.js"></script></head><body>player ${chunk}</body></html>`;
const navigation = (path = '/player?screen=s') =>
  ({ url: ORIGIN + path, method: 'GET', mode: 'navigate', headers: new Headers() }) as unknown as Request;

async function seedShell(w: ReturnType<typeof loadWorker>, html: string, chunks: string[]) {
  const shell = await w.context.caches.open(SHELL);
  await shell.put(ORIGIN + '/player', new Response(html, { headers: { 'content-type': 'text/html' } }));
  for (const c of chunks) await shell.put(ORIGIN + `/_next/static/chunks/${c}.js`, new Response('js'));
}

describe('saved player document — never one whose chunks are gone', () => {
  it('network down + every chunk saved → the saved document', async () => {
    const w = loadWorker();
    await seedShell(w, doc('d1'), ['d1']);
    w.setFetch(async () => { throw new Error('offline'); });
    const res = await w.fetchRequest(navigation());
    expect(await res.text()).toContain('player d1');
  });

  it('network down + a chunk missing → the self-healing page, never the unbootable document', async () => {
    const w = loadWorker();
    await seedShell(w, doc('d2'), []); // document saved, its chunk never landed
    w.setFetch(async () => { throw new Error('offline'); });
    const res = await w.fetchRequest(navigation());
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).not.toContain('player d2');
    expect(html).toContain('Waiting for network');
  });

  it('host error (402) + a chunk missing → the self-healing page', async () => {
    const w = loadWorker();
    await seedShell(w, doc('d3'), []);
    w.setFetch(async () => new Response('DEPLOYMENT_DISABLED', { status: 402 }));
    expect(await (await w.fetchRequest(navigation())).text()).toContain('Waiting for network');
  });

  it('an armed swap with an incomplete pinned document falls through to the network', async () => {
    const w = loadWorker();
    await seedShell(w, doc('pinned'), []);
    await w.send({ type: 'SHELL_SWAP_ARM', ttlMs: 60_000 });
    w.setFetch(async (input: Request | string) => {
      const path = new URL(typeof input === 'string' ? input : input.url).pathname;
      return path === '/player' ? new Response(doc('live'), { headers: { 'content-type': 'text/html' } }) : new Response('', { status: 404 });
    });
    expect(await (await w.fetchRequest(navigation())).text()).toContain('player live');
  });

  it('online → network-first, unchanged', async () => {
    const w = loadWorker();
    await seedShell(w, doc('old'), ['old']);
    w.setFetch(async () => new Response(doc('new'), { headers: { 'content-type': 'text/html' } }));
    expect(await (await w.fetchRequest(navigation())).text()).toContain('player new');
  });

  it('the emergency tier is untouched by any of it', async () => {
    const w = loadWorker();
    await w.seedLegacyEntry(EMERGENCY, ORIGIN + '/assets/lockdown.mp4', new Uint8Array([9, 9]));
    await seedShell(w, doc('d4'), []);
    w.setFetch(async () => { throw new Error('offline'); });
    await w.fetchRequest(navigation());
    expect(await w.cacheNamed(EMERGENCY).match(ORIGIN + '/assets/lockdown.mp4')).toBeDefined();
  });
});

describe('chunk fetch — one retry past the HTTP cache', () => {
  const chunkReq = (name: string) =>
    ({ url: ORIGIN + `/_next/static/chunks/${name}.js`, method: 'GET', mode: 'no-cors', headers: new Headers() }) as unknown as Request;

  it('a 404 (an HTTP-cache-pinned miss) is re-asked with cache:reload and the fresh copy is served + saved', async () => {
    const w = loadWorker();
    const modes: string[] = [];
    w.setFetch(async (input: Request) => {
      const mode = (input as Request).cache || 'default';
      modes.push(mode);
      return mode === 'reload' ? new Response('real-js', { status: 200 }) : new Response('', { status: 404 });
    });
    const res = await w.fetchRequest(chunkReq('pinned404'));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('real-js');
    expect(modes).toEqual(['default', 'reload']);
    expect(await w.cacheNamed(SHELL).match(ORIGIN + '/_next/static/chunks/pinned404.js')).toBeDefined();
  });

  it('a real 404 costs exactly one extra request and is not saved', async () => {
    const w = loadWorker();
    let calls = 0;
    w.setFetch(async () => { calls++; return new Response('', { status: 404 }); });
    const res = await w.fetchRequest(chunkReq('gone'));
    expect(res.status).toBe(404);
    expect(calls).toBe(2);
    expect(await w.cacheNamed(SHELL).match(ORIGIN + '/_next/static/chunks/gone.js')).toBeUndefined();
  });

  it('a chunk URL carrying ?dpl= (Skew Protection) is served from the entry saved by pathname, offline', async () => {
    const w = loadWorker();
    await (await w.context.caches.open(SHELL)).put(ORIGIN + '/_next/static/chunks/saved.js', new Response('saved-js'));
    w.setFetch(async () => { throw new Error('offline'); });
    const req = { url: ORIGIN + '/_next/static/chunks/saved.js?dpl=abc123', method: 'GET', mode: 'no-cors', headers: new Headers() } as unknown as Request;
    const res = await w.fetchRequest(req);
    expect(await res.text()).toBe('saved-js');
  });

  it('a 200 is never re-asked (negative control)', async () => {
    const w = loadWorker();
    let calls = 0;
    w.setFetch(async () => { calls++; return new Response('js', { status: 200 }); });
    expect((await w.fetchRequest(chunkReq('fine'))).status).toBe(200);
    expect(calls).toBe(1);
  });
});
