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

  /**
   * HTTP-01 / XSS-01 (2026-08-04) — the NON-HTML relay branch escaped RS-01.
   *
   * RS-01 sandboxed the HTML path and the error path. The relay `return`s
   * before both, so it shipped attacker-controlled bytes under an
   * attacker-controlled Content-Type from an origin that vercel.json makes
   * SAME-ORIGIN with the dashboard.
   */
  describe('non-HTML relay branch containment', () => {
    function relaying(contentType: string, body = 'BYTES') {
      mockedFetch.mockResolvedValue({
        status: 200,
        contentType,
        body: Buffer.from(body, 'utf8'),
        finalUrl: 'https://example.com/x',
      });
    }

    it('applies a sandbox CSP + nosniff to a relayed sub-resource', async () => {
      relaying('image/png');
      const res = fakeRes();
      await controller.proxyWeb('https://example.com/x.png', undefined, res as never);

      const csp = res.headers['content-security-policy'] as string;
      expect(csp).toMatch(/(^|;)\s*sandbox\s*(;|$)/);
      // This branch relays images/CSS/JSON — nothing here should ever execute.
      expect(csp).not.toContain('allow-scripts');
      expect(csp).not.toContain('allow-same-origin');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
    });

    it('refuses to relay SVG under its own MIME (it is a script-bearing document)', async () => {
      relaying('image/svg+xml', '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
      const res = fakeRes();
      await controller.proxyWeb('https://example.com/x.svg', undefined, res as never);

      expect(res.headers['content-type']).toBe('application/octet-stream');
      expect(res.headers['content-disposition']).toBe('attachment');
    });

    it('does the same for the other document-renderable XML types', async () => {
      for (const ct of ['text/xml', 'application/xml', 'text/xsl']) {
        relaying(ct);
        const res = fakeRes();
        await controller.proxyWeb('https://example.com/x', undefined, res as never);
        expect(res.headers['content-type']).toBe('application/octet-stream');
      }
    });

    it('leaves an ordinary relayed type intact', async () => {
      relaying('application/json');
      const res = fakeRes();
      await controller.proxyWeb('https://example.com/x.json', undefined, res as never);
      expect(res.headers['content-type']).toBe('application/json');
      expect(res.headers['content-disposition']).toBeUndefined();
    });

    it('routes a CASE-VARIANT html content-type into the sandboxed HTML path, not the relay', async () => {
      // The branch test used the raw upstream value, so `TEXT/HTML` missed both
      // .includes() checks and fell into the relay — the one place HTML must
      // never land.
      relaying('TEXT/HTML; charset=utf-8', '<html><body>hi</body></html>');
      const res = fakeRes();
      await controller.proxyWeb('https://example.com/', undefined, res as never);

      expect(res.headers['x-educms-mode']).toBe('static');
      expect(res.body).toContain('/*VOS-SPATIAL-NAV*/');
    });
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
