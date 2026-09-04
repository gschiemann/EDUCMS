/**
 * SEC-006 — the render capability, and the gate that consumes it.
 *
 * The property under test is narrow and load-bearing: an anonymous caller
 * cannot get `/api/v1/proxy/web` to drive Chromium, and a capability minted
 * for one URL cannot render a different one.
 */
import {
  mintRenderCapability,
  verifyRenderCapability,
  RENDER_CAPABILITY_TTL_MS,
} from './render-capability';

const SECRET = 'test_proxy_render_secret_0123456789abcdef';

describe('render capability', () => {
  const prevSecret = process.env.PROXY_RENDER_SECRET;

  beforeAll(() => {
    process.env.PROXY_RENDER_SECRET = SECRET;
  });
  afterAll(() => {
    if (prevSecret === undefined) delete process.env.PROXY_RENDER_SECRET;
    else process.env.PROXY_RENDER_SECRET = prevSecret;
  });

  const mint = (url: string) =>
    mintRenderCapability({
      url,
      tenantId: 'tenant-1',
      principalKind: 'user',
      principalId: 'user-1',
    }).capability;

  it('round-trips for the URL it was minted for', () => {
    const url = 'https://example.com/page?a=1';
    const verdict = verifyRenderCapability(mint(url), url);
    expect(verdict.ok).toBe(true);
    if (verdict.ok) {
      expect(verdict.claims.t).toBe('tenant-1');
      expect(verdict.claims.k).toBe('user');
      expect(verdict.claims.s).toBe('user-1');
    }
  });

  it('REFUSES a capability presented for a DIFFERENT url', () => {
    // The whole point: one legitimately-minted capability must not become a
    // general licence to render anything.
    const cap = mint('https://example.com/allowed');
    expect(verifyRenderCapability(cap, 'https://evil.example/attack')).toEqual({
      ok: false,
      reason: 'url_mismatch',
    });
  });

  it('binds byte-for-byte — a trailing slash is a different target', () => {
    const cap = mint('https://example.com/page');
    expect(verifyRenderCapability(cap, 'https://example.com/page/').ok).toBe(false);
  });

  it('refuses a missing, malformed or foreign-version capability', () => {
    const url = 'https://example.com/';
    expect(verifyRenderCapability(undefined, url)).toEqual({ ok: false, reason: 'missing' });
    expect(verifyRenderCapability('', url)).toEqual({ ok: false, reason: 'missing' });
    expect(verifyRenderCapability('not-a-capability', url)).toEqual({ ok: false, reason: 'malformed' });
    expect(verifyRenderCapability('rc9.aaa.bbb', url)).toEqual({ ok: false, reason: 'version' });
    expect(verifyRenderCapability('x'.repeat(4096), url)).toEqual({ ok: false, reason: 'oversized' });
  });

  it('refuses a tampered payload (signature covers the claims)', () => {
    const url = 'https://example.com/';
    const cap = mint(url);
    const [v, body, sig] = cap.split('.');
    const forged = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    forged.t = 'other-tenant';
    const swapped = Buffer.from(JSON.stringify(forged), 'utf8').toString('base64url');
    expect(verifyRenderCapability(`${v}.${swapped}.${sig}`, url)).toEqual({
      ok: false,
      reason: 'bad_signature',
    });
  });

  it('refuses one signed with a different secret', () => {
    const url = 'https://example.com/';
    process.env.PROXY_RENDER_SECRET = 'a_completely_different_secret_value_x';
    const foreign = mint(url);
    process.env.PROXY_RENDER_SECRET = SECRET;
    expect(verifyRenderCapability(foreign, url)).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('expires', () => {
    const url = 'https://example.com/';
    const now = Date.now();
    const cap = mintRenderCapability({
      url,
      tenantId: null,
      principalKind: 'device',
      principalId: 'screen-1',
      now,
    }).capability;
    expect(verifyRenderCapability(cap, url, { now: now + RENDER_CAPABILITY_TTL_MS - 1_000 }).ok).toBe(true);
    expect(verifyRenderCapability(cap, url, { now: now + RENDER_CAPABILITY_TTL_MS + 1_000 })).toEqual({
      ok: false,
      reason: 'expired',
    });
  });
});
