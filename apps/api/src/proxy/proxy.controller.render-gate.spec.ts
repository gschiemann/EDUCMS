jest.mock('../branding/safe-fetch', () => {
  const actual = jest.requireActual('../branding/safe-fetch');
  return { ...actual, safeFetch: jest.fn() };
});

import { ProxyController } from './proxy.controller';
import { safeFetch } from '../branding/safe-fetch';
import { mintRenderCapability } from './render-capability';
import type { RendererService } from './renderer.service';

/**
 * SEC-006 (2026-09-04) — the Chromium gate on `GET /api/v1/proxy/web`.
 *
 * The finding: that route is public (it is an iframe `src`), and in static
 * mode it pointed a `--no-sandbox --single-process` Chromium, in the process
 * that owns emergency delivery, at a URL the CALLER chose. The audit's pass
 * condition was to disable or strictly capability-gate it.
 *
 * These cases pin the two halves of that claim:
 *   1. no valid capability  -> `render()` is never called, and the response
 *      still succeeds via `safeFetch` (a security control that blanks signage
 *      screens gets switched off, so degradation is part of the contract);
 *   2. a valid capability   -> `render()` runs, and only for the URL the
 *      capability was minted for.
 */
const mockedFetch = safeFetch as unknown as jest.Mock;

const UPSTREAM_HTML = '<!doctype html><html><head></head><body>upstream</body></html>';
const SSR_HTML = '<!doctype html><html><head></head><body>rendered-by-chromium</body></html>';
const SECRET = 'test_proxy_render_secret_0123456789abcdef';
const TARGET = 'https://example.com/';

function fakeRes() {
  const headers: Record<string, string> = {};
  return {
    headers,
    body: '' as string,
    statusCode: 200,
    setHeader(k: string, v: string) { headers[k.toLowerCase()] = v; },
    removeHeader(k: string) { delete headers[k.toLowerCase()]; },
    status(c: number) { this.statusCode = c; return this; },
    send(b: string) { this.body = typeof b === 'string' ? b : String(b); return this; },
  };
}

describe('ProxyController — SEC-006 render gate', () => {
  const prevSecret = process.env.PROXY_RENDER_SECRET;
  const prevOverride = process.env.PROXY_SSR_ALLOW_ANONYMOUS;
  let render: jest.Mock;
  let controller: ProxyController;

  beforeAll(() => {
    process.env.PROXY_RENDER_SECRET = SECRET;
  });
  afterAll(() => {
    if (prevSecret === undefined) delete process.env.PROXY_RENDER_SECRET;
    else process.env.PROXY_RENDER_SECRET = prevSecret;
    if (prevOverride === undefined) delete process.env.PROXY_SSR_ALLOW_ANONYMOUS;
    else process.env.PROXY_SSR_ALLOW_ANONYMOUS = prevOverride;
  });

  beforeEach(() => {
    delete process.env.PROXY_SSR_ALLOW_ANONYMOUS;
    (ProxyController as any).warnedAnonymousSsr = false;
    mockedFetch.mockReset();
    mockedFetch.mockResolvedValue({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: Buffer.from(UPSTREAM_HTML, 'utf8'),
      finalUrl: TARGET,
    });
    render = jest.fn().mockResolvedValue({ html: SSR_HTML, finalUrl: TARGET, renderedAt: Date.now() });
    controller = new ProxyController({ render } as unknown as RendererService);
  });

  const cap = (url: string) =>
    mintRenderCapability({
      url,
      tenantId: 'tenant-1',
      principalKind: 'user',
      principalId: 'user-1',
    }).capability;

  it('an ANONYMOUS static request never reaches Chromium, and still serves', async () => {
    const res = fakeRes();
    await controller.proxyWeb(TARGET, undefined, undefined, res as never);

    expect(render).not.toHaveBeenCalled();
    expect(res.headers['x-educms-renderer']).toBe('fetch');
    expect(res.body).toContain('upstream');
    expect(res.body).not.toContain('rendered-by-chromium');
  });

  it('a request with a GARBAGE capability never reaches Chromium, and still serves', async () => {
    const res = fakeRes();
    await controller.proxyWeb(TARGET, undefined, 'rc1.deadbeef.deadbeef', res as never);

    expect(render).not.toHaveBeenCalled();
    expect(res.headers['x-educms-renderer']).toBe('fetch');
    expect(res.body).toContain('upstream');
  });

  it('a capability minted for ANOTHER url does not authorise this one', async () => {
    const res = fakeRes();
    await controller.proxyWeb(TARGET, undefined, cap('https://other.example/'), res as never);

    expect(render).not.toHaveBeenCalled();
    expect(res.body).toContain('upstream');
  });

  it('a VALID capability authorises the render, and carries the principal through', async () => {
    const res = fakeRes();
    await controller.proxyWeb(TARGET, undefined, cap(TARGET), res as never);

    expect(render).toHaveBeenCalledTimes(1);
    expect(render.mock.calls[0][0]).toBe(TARGET);
    expect(render.mock.calls[0][1]).toEqual({
      kind: 'capability',
      tenantId: 'tenant-1',
      principal: 'user:user-1',
    });
    expect(res.headers['x-educms-renderer']).toBe('ssr');
    expect(res.body).toContain('rendered-by-chromium');
  });

  it('INTERACTIVE mode never reaches Chromium even holding a valid capability', async () => {
    // Unchanged pre-existing behaviour, pinned here because it is now also the
    // reason the gate costs the fleet nothing: interactive is the default.
    const res = fakeRes();
    await controller.proxyWeb(TARGET, 'true', cap(TARGET), res as never);

    expect(render).not.toHaveBeenCalled();
    expect(res.headers['x-educms-mode']).toBe('interactive');
  });

  it('PROXY_SSR_ALLOW_ANONYMOUS=1 re-opens the gate, and nothing else does', async () => {
    for (const value of ['0', 'false', 'yes', 'on', '']) {
      process.env.PROXY_SSR_ALLOW_ANONYMOUS = value;
      const res = fakeRes();
      await controller.proxyWeb(TARGET, undefined, undefined, res as never);
      expect(render).not.toHaveBeenCalled();
    }

    process.env.PROXY_SSR_ALLOW_ANONYMOUS = '1';
    const res = fakeRes();
    await controller.proxyWeb(TARGET, undefined, undefined, res as never);
    expect(render).toHaveBeenCalledTimes(1);
    expect(render.mock.calls[0][1].kind).toBe('env-override');
  });
});
