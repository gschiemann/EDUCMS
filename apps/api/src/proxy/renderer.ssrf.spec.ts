/**
 * SEC-006 regression suite — the renderer's SSRF surface.
 *
 * The finding: `/api/v1/proxy/web` is public and unauthenticated, and the
 * renderer only ran the DNS-resolving `assertPublicUrl` on NAVIGATIONS. A
 * hostile page could therefore name `internal.attacker.example` (an A record
 * on 10.x / 127.0.0.1 / 169.254.169.254) as an <img>, <script>, fetch or form
 * target and Chromium would connect from inside the production container,
 * even though navigating to the identical host was blocked.
 *
 * Everything here drives the REAL `RendererService` with a fake puppeteer
 * page, so the assertions are about the shipped guard, not a re-implementation
 * of it.
 */

// Resolver mock — `safe-fetch`'s `assertPublicUrl` calls this.
jest.mock('node:dns/promises', () => ({ lookup: jest.fn() }));

import type { Browser } from 'puppeteer-core';
import { lookup } from 'node:dns/promises';
import { RendererService, type BrowserLauncher } from './renderer.service';

const mockedLookup = lookup as unknown as jest.Mock;

/**
 * The service loads puppeteer through the `loadPuppeteer()` seam (a real
 * dynamic import is un-mockable under ts-jest + `module: nodenext`). We
 * subclass to hand it a fake launcher; everything else — the request guard,
 * the peer check, the budgets, the breaker — is the shipped code.
 */
const launch = jest.fn();
class TestRenderer extends RendererService {
  protected override async loadPuppeteer(): Promise<BrowserLauncher> {
    return { launch: (options) => launch(options) as Promise<Browser> };
  }
}

/** Hostname → address the fake resolver hands back. */
const DNS: Record<string, string> = {
  'good.example': '93.184.216.34',
  'cdn.good.example': '93.184.216.35',
  // The attack: a name that resolves INTO the container's own network.
  'internal.attacker.example': '10.0.0.5',
  'metadata.attacker.example': '169.254.169.254',
  'azure.attacker.example': '168.63.129.16',
  'loopback.attacker.example': '127.0.0.1',
  'ula.attacker.example': 'fd00::1',
};

interface FakeRequest {
  resourceType: () => string;
  url: () => string;
  isNavigationRequest: () => boolean;
  abort: jest.Mock;
  continue: jest.Mock;
}

function fakeRequest(url: string, resourceType = 'image', navigation = false): FakeRequest {
  return {
    resourceType: () => resourceType,
    url: () => url,
    isNavigationRequest: () => navigation,
    abort: jest.fn(async () => undefined),
    continue: jest.fn(async () => undefined),
  };
}

function fakeResponse(url: string, ip: string, contentLength?: number) {
  return {
    url: () => url,
    remoteAddress: () => ({ ip, port: 443 }),
    headers: () => (contentLength === undefined ? {} : { 'content-length': String(contentLength) }),
  };
}

interface HarnessOpts {
  /** Requests the "page" makes once `goto` is called. */
  subrequests?: FakeRequest[];
  /** Responses the "page" receives (drives connected-peer verification). */
  responses?: ReturnType<typeof fakeResponse>[];
  html?: string;
  finalUrl?: string;
}

function makePage(opts: HarnessOpts) {
  const handlers = new Map<string, (arg: unknown) => unknown>();
  const page = {
    setUserAgent: jest.fn(async () => undefined),
    setViewport: jest.fn(async () => undefined),
    setRequestInterception: jest.fn(async () => undefined),
    on: (event: string, fn: (arg: unknown) => unknown) => {
      handlers.set(event, fn);
    },
    goto: jest.fn(async () => {
      const onRequest = handlers.get('request');
      if (onRequest) {
        for (const req of opts.subrequests ?? []) await onRequest(req);
      }
      const onResponse = handlers.get('response');
      if (onResponse) {
        for (const res of opts.responses ?? []) await onResponse(res);
      }
      return undefined;
    }),
    content: jest.fn(async () => opts.html ?? '<html><body>ok</body></html>'),
    url: () => opts.finalUrl ?? 'https://good.example/',
    close: jest.fn(async () => undefined),
  };
  return page;
}

function makeService(opts: HarnessOpts) {
  const page = makePage(opts);
  launch.mockReset();
  launch.mockResolvedValue({ newPage: async () => page, close: async () => undefined });
  const svc = new TestRenderer();
  return { svc, page };
}

describe('RendererService — SEC-006 SSRF guards', () => {
  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    mockedLookup.mockReset();
    mockedLookup.mockImplementation(async (hostname: string) => {
      const addr = DNS[hostname];
      if (!addr) throw new Error(`ENOTFOUND ${hostname}`);
      return [{ address: addr, family: addr.includes(':') ? 6 : 4 }];
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  /**
   * Drive a render to completion under fake timers. Two phases so the guards
   * are exercised at realistic virtual timings: drain microtasks first (every
   * intercepted request is an await), then jump the clock past the service's
   * 2s post-load grace. Total virtual time stays well under both the 10s DNS
   * verdict TTL and the 25s render budget, so neither fires incidentally.
   */
  async function renderNow(svc: RendererService, url: string) {
    // SEC-006 — `render` now requires a grant. These tests exercise the SSRF /
    // exposure guards, which sit BELOW the gate, so they present the grant the
    // controller would have built from a valid capability.
    const p = svc.render(url, {
      kind: 'capability',
      tenantId: 'tenant-under-test',
      principal: 'user:tester',
    });
    for (let i = 0; i < 2500; i++) await Promise.resolve();
    jest.advanceTimersByTime(3_000);
    for (let i = 0; i < 500; i++) await Promise.resolve();
    return p;
  }

  it('BLOCKS a non-navigation subresource whose HOSTNAME resolves privately', async () => {
    const hostile = fakeRequest('https://internal.attacker.example/secrets', 'image', false);
    const benign = fakeRequest('https://cdn.good.example/logo.png', 'image', false);
    const { svc } = makeService({ subrequests: [hostile, benign] });

    const result = await renderNow(svc, 'https://good.example/');

    // THE REGRESSION: this used to call continue() because the hostname is
    // not an IP literal and the request is not a navigation.
    expect(hostile.abort).toHaveBeenCalled();
    expect(hostile.continue).not.toHaveBeenCalled();
    // A genuinely public sub-resource on a different host still loads.
    expect(benign.continue).toHaveBeenCalled();
    expect(benign.abort).not.toHaveBeenCalled();
    // …and the render itself still succeeds — we block the request, we do not
    // fail the whole page for it.
    expect(result).not.toBeNull();
  });

  it.each([
    ['cloud metadata', 'https://metadata.attacker.example/latest/meta-data/'],
    ['azure wireserver', 'https://azure.attacker.example/metadata/instance'],
    ['loopback', 'https://loopback.attacker.example/admin'],
    ['ipv6 unique-local', 'https://ula.attacker.example/'],
  ])('BLOCKS a %s subresource by resolved address', async (_label, url) => {
    const hostile = fakeRequest(url, 'script', false);
    const { svc } = makeService({ subrequests: [hostile] });

    await renderNow(svc, 'https://good.example/');

    expect(hostile.abort).toHaveBeenCalled();
    expect(hostile.continue).not.toHaveBeenCalled();
  });

  it.each([
    ['fetch/XHR', 'fetch'],
    ['form target (document sub-request)', 'document'],
    ['stylesheet', 'stylesheet'],
    ['xhr', 'xhr'],
  ])('BLOCKS a private-resolving %s request', async (_label, resourceType) => {
    const hostile = fakeRequest('https://internal.attacker.example/x', resourceType, false);
    const { svc } = makeService({ subrequests: [hostile] });

    await renderNow(svc, 'https://good.example/');

    expect(hostile.abort).toHaveBeenCalled();
    expect(hostile.continue).not.toHaveBeenCalled();
  });

  it('BLOCKS a private IP LITERAL subresource (pre-existing guard still holds)', async () => {
    const hostile = fakeRequest('http://169.254.169.254/latest/meta-data/', 'image', false);
    const { svc } = makeService({ subrequests: [hostile] });

    await renderNow(svc, 'https://good.example/');

    expect(hostile.abort).toHaveBeenCalled();
    // A literal never reaches the resolver — the synchronous half catches it.
    expect(mockedLookup).not.toHaveBeenCalledWith('169.254.169.254', expect.anything());
  });

  it('FAILS CLOSED when the subresource host cannot be resolved', async () => {
    const unknown = fakeRequest('https://nxdomain.attacker.example/x', 'image', false);
    const { svc } = makeService({ subrequests: [unknown] });

    await renderNow(svc, 'https://good.example/');

    expect(unknown.abort).toHaveBeenCalled();
    expect(unknown.continue).not.toHaveBeenCalled();
  });

  it('resolves each distinct host ONCE per render (the verdict cache still works)', async () => {
    const reqs = Array.from({ length: 12 }, () =>
      fakeRequest('https://cdn.good.example/asset.png', 'image', false),
    );
    const { svc } = makeService({ subrequests: reqs });

    await renderNow(svc, 'https://good.example/');

    const cdnLookups = mockedLookup.mock.calls.filter((c) => c[0] === 'cdn.good.example');
    expect(cdnLookups).toHaveLength(1);
    for (const r of reqs) expect(r.continue).toHaveBeenCalled();
  });

  it('DISCARDS the whole render when Chromium connected to a private peer (rebinding)', async () => {
    // The guard passed — our resolver said public — but Chromium's own lookup
    // landed on 10.0.0.5. The body must never reach the caller.
    const { svc } = makeService({
      subrequests: [fakeRequest('https://cdn.good.example/a.png', 'image', false)],
      responses: [fakeResponse('https://cdn.good.example/a.png', '10.0.0.5')],
      html: '<html><body>INTERNAL SECRET</body></html>',
    });

    const result = await renderNow(svc, 'https://good.example/');

    expect(result).toBeNull();
  });

  it('DISCARDS the render when the connected peer is an IPv6 loopback in bracketed form', async () => {
    const { svc } = makeService({
      responses: [fakeResponse('https://good.example/', '[::1]')],
    });

    expect(await renderNow(svc, 'https://good.example/')).toBeNull();
  });

  it('KEEPS a render whose peers are all public', async () => {
    const { svc } = makeService({
      responses: [
        fakeResponse('https://good.example/', '93.184.216.34', 1024),
        fakeResponse('https://cdn.good.example/a.png', '93.184.216.35', 2048),
      ],
    });

    const result = await renderNow(svc, 'https://good.example/');
    expect(result).not.toBeNull();
    expect(result?.html).toContain('ok');
  });

  it('DISCARDS a render whose FINAL url resolves privately (redirect chased mid-render)', async () => {
    const { svc } = makeService({ finalUrl: 'https://internal.attacker.example/loot' });

    expect(await renderNow(svc, 'https://good.example/')).toBeNull();
  });

  it('DISCARDS a render whose declared response bytes blow the cap', async () => {
    const { svc } = makeService({
      responses: [fakeResponse('https://good.example/huge.bin', '93.184.216.34', 64 * 1024 * 1024)],
    });

    expect(await renderNow(svc, 'https://good.example/')).toBeNull();
  });

  it('DISCARDS a render whose HTML exceeds the size cap', async () => {
    const { svc } = makeService({ html: 'x'.repeat(9 * 1024 * 1024) });

    expect(await renderNow(svc, 'https://good.example/')).toBeNull();
  });

  it('POISONS the render past the per-render request cap', async () => {
    const reqs = Array.from({ length: 320 }, () =>
      fakeRequest('https://cdn.good.example/a.png', 'image', false),
    );
    const { svc } = makeService({ subrequests: reqs });

    expect(await renderNow(svc, 'https://good.example/')).toBeNull();
    // Everything past the ceiling is refused rather than forwarded.
    expect(reqs[319].abort).toHaveBeenCalled();
    expect(reqs[319].continue).not.toHaveBeenCalled();
  });

  it('rejects the TOP-LEVEL url by resolved address before launching a browser', async () => {
    const { svc } = makeService({});
    expect(await renderNow(svc, 'https://internal.attacker.example/')).toBeNull();
    expect(launch).not.toHaveBeenCalled();
  });

  it('does NOT launch Chromium with --ignore-certificate-errors', async () => {
    const { svc } = makeService({});
    await renderNow(svc, 'https://good.example/');

    expect(launch).toHaveBeenCalled();
    const args: string[] = launch.mock.calls[0][0].args;
    expect(args).not.toContain('--ignore-certificate-errors');
  });

  it('opens the circuit breaker after repeated failures and stops launching', async () => {
    // Every render fails the final-URL check, so each one counts as a failure.
    const { svc } = makeService({ finalUrl: 'https://internal.attacker.example/loot' });

    for (let i = 0; i < 5; i++) {
      // Distinct URLs so the negative result is never served from cache.
      expect(await renderNow(svc, `https://good.example/${i}`)).toBeNull();
    }
    const launchesBefore = launch.mock.calls.length;

    expect(await renderNow(svc, 'https://good.example/after')).toBeNull();
    expect(launch.mock.calls.length).toBe(launchesBefore);
  });
});
