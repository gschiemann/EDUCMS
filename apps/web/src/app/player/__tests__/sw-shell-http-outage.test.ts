/** @jest-environment node */
import { loadWorker, ORIGIN } from './swHarness';

const SHELL = 'edu-player-shell-v9';
const PLAYLIST = 'edu-player-playlist-v9';
const HTML = '<!doctype html><html><body>LAST WORKING PLAYER<script src="/_next/static/chunks/last-good.js"></script></body></html>';
const navigation = () => ({ url: ORIGIN + '/player?screen=own', method: 'GET', mode: 'navigate', headers: new Headers() }) as unknown as Request;

describe('player cold boot while its host returns an HTTP outage', () => {
  it.each([402, 403, 404, 429, 500, 502, 503])('HTTP %s serves the saved shell and preserves downloaded media', async (status) => {
    const w = loadWorker();
    w.setFetch(async () => new Response('DEPLOYMENT_DISABLED', { status }));
    await (await w.context.caches.open(SHELL)).put(ORIGIN + '/player', new Response(HTML, { headers: { 'content-type': 'text/html' } }));
    await w.seedLegacyEntry(PLAYLIST, ORIGIN + '/assets/clip.mp4', new Uint8Array([1, 2, 3]));
    const res = await w.fetchRequest(navigation());
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(HTML);
    expect(await (await w.cacheNamed(SHELL).match(ORIGIN + '/player'))!.text()).toBe(HTML);
    expect(await w.cacheNamed(PLAYLIST).match(ORIGIN + '/assets/clip.mp4')).toBeDefined();
  });

  it('with no saved shell, returns the self-recovering document instead of the hosting error', async () => {
    const w = loadWorker();
    w.setFetch(async () => new Response('DEPLOYMENT_DISABLED', { status: 402 }));
    const res = await w.fetchRequest(navigation());
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('Waiting for network');
    expect(html).not.toContain('DEPLOYMENT_DISABLED');
    expect(await w.cacheNamed(SHELL).match(ORIGIN + '/player')).toBeUndefined();
  });

  it('returns to the current hosted player after recovery', async () => {
    const w = loadWorker();
    await (await w.context.caches.open(SHELL)).put(ORIGIN + '/player', new Response(HTML));
    w.setFetch(async () => new Response('DEPLOYMENT_DISABLED', { status: 402 }));
    expect(await (await w.fetchRequest(navigation())).text()).toBe(HTML);
    const recovered = HTML.replace('LAST WORKING', 'RECOVERED');
    w.setFetch(async () => new Response(recovered));
    expect(await (await w.fetchRequest(navigation())).text()).toBe(recovered);
  });
});
