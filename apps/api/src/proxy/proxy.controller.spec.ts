jest.mock('../branding/safe-fetch', () => {
  const actual = jest.requireActual('../branding/safe-fetch');
  return { ...actual, safeFetch: jest.fn() };
});

import { ProxyController } from './proxy.controller';
import { safeFetch } from '../branding/safe-fetch';

/**
 * INJ-001a (2026-08-02) — the WEBPAGE proxy iframe is now sandboxed WITHOUT
 * `allow-same-origin`, so the parent can no longer eval the spatial-nav shim
 * into it. This spec proves the shim is actually IN the proxied document that
 * ships to the kiosk (the whole feature depends on it).
 */
const mockedFetch = safeFetch as unknown as jest.Mock;

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

const UPSTREAM_HTML =
  '<!doctype html><html><head><title>t</title></head><body><a href="/about">about</a></body></html>';

describe('ProxyController — spatial-nav shim injection', () => {
  beforeEach(() => {
    mockedFetch.mockReset();
    mockedFetch.mockResolvedValue({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: Buffer.from(UPSTREAM_HTML, 'utf8'),
      finalUrl: 'https://example.com/',
    });
  });

  // No RendererService => the SSR path is skipped and both modes go through
  // safeFetch, which is what production does for interactive=true anyway.
  const controller = new ProxyController();

  it('injects the shim on an INTERACTIVE-mode request', async () => {
    const res = fakeRes();
    await controller.proxyWeb('https://example.com/', 'true', res as never);

    expect(res.headers['x-educms-mode']).toBe('interactive');
    expect(res.body).toContain('/*VOS-SPATIAL-NAV*/');
    // installed before the upstream body so it exists on first paint
    expect(res.body.indexOf('/*VOS-SPATIAL-NAV*/')).toBeLessThan(res.body.indexOf('<body>'));
    // the hardened channel, not an eval hook
    expect(res.body).toContain('e.source!==window.parent');
    expect(res.body).toContain('PARENTS.indexOf(e.origin)===-1');
    expect(res.body).toContain('CMDS.indexOf(cmd)===-1');
    // opaque-origin storage shim rides along in interactive mode only
    expect(res.body).toContain('/*VOS-OPAQUE-STORAGE*/');
    // the page's own JS is NOT stripped in interactive mode (unchanged)
    expect(res.body).toContain('proxy shim init failed');
  });

  it('injects the shim on a STATIC-mode request too (parity with the old eval path)', async () => {
    const res = fakeRes();
    await controller.proxyWeb('https://example.com/', undefined, res as never);

    expect(res.headers['x-educms-mode']).toBe('static');
    expect(res.body).toContain('/*VOS-SPATIAL-NAV*/');
    // static mode strips the upstream's scripts but must not strip ours
    expect(res.body).not.toContain('/*VOS-OPAQUE-STORAGE*/');
  });

  it('bakes the parent allowlist from server env, never from the request', async () => {
    const res = fakeRes();
    // A hostile ?url= must not be able to widen the shim's allowlist.
    await controller.proxyWeb(
      'https://example.com/?origin=https://evil.example',
      'true',
      res as never,
    );
    const shimStart = res.body.indexOf('/*VOS-SPATIAL-NAV*/');
    const shimEnd = res.body.indexOf('</script>', shimStart);
    const shim = res.body.slice(shimStart, shimEnd);
    expect(shim).not.toContain('evil.example');
    expect(shim).toContain('var PARENTS=[');
  });

  it('keeps the embedding + SSRF-facing response headers unchanged', async () => {
    const res = fakeRes();
    await controller.proxyWeb('https://example.com/', 'true', res as never);
    // RS-01: the `sandbox` DIRECTIVE is the load-bearing part and must never
    // be dropped. vercel.json rewrites /api/v1/* to the API, so this response
    // is same-origin with the dashboard and can be opened as a TOP-LEVEL
    // navigation — where the iframe `sandbox` ATTRIBUTE does not apply. The
    // CSP directive does, forcing an opaque origin so attacker HTML cannot
    // reach the operator's session. Asserted as two properties rather than one
    // literal so header re-ordering cannot silently drop the sandbox.
    const csp = res.headers['content-security-policy'] as string;
    expect(csp).toMatch(/(^|;)\s*sandbox\s+allow-scripts\s*(;|$)/);
    expect(csp).toContain('frame-ancestors *');
    // allow-same-origin would defeat the whole point — it restores our origin.
    expect(csp).not.toContain('allow-same-origin');
    expect(res.headers['x-frame-options']).toBeUndefined();
    expect(res.headers['cache-control']).toContain('no-store');
  });
});
