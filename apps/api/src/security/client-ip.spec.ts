import { clientIpFromRequest, __resetTrustedProxyHopCache } from './client-ip';

/**
 * Unit tests for the shared client-IP resolver.
 *
 * TWO properties must hold simultaneously, and the two bugs in this helper's
 * history each broke exactly one of them:
 *
 *   STABLE (2026-07-07)      — the same client resolves to the same address
 *                              even as Railway's trailing internal hop rotates.
 *                              Broken → the per-IP throttle key moved on every
 *                              request, the shared counter never reached the
 *                              cap, and no brute-force 429 ever fired.
 *   UNSPOOFABLE (ACC-08,     — a client-supplied X-Forwarded-For cannot change
 *   2026-08-01)                which entry we pick. Broken → an attacker
 *                              rotated the throttle key at will (same effect
 *                              as above) AND forged the `ip` recorded in the
 *                              AuditLog row for an emergency trigger.
 *
 * The fix that satisfies both: select the entry at the trusted-proxy hop
 * position counted FROM THE RIGHT. Trusted proxies append addresses they
 * observed at the TCP layer; anything a client sends is a PREFIX and is never
 * read. Default hop count is 2 (Railway edge + one internal hop), matching the
 * measured production chain.
 */
function req(xff: unknown, ip?: string, socket?: string) {
  return {
    headers: { 'x-forwarded-for': xff },
    ip,
    socket: { remoteAddress: socket },
  };
}

describe('clientIpFromRequest', () => {
  const prevHops = process.env.TRUSTED_PROXY_HOPS;
  beforeEach(() => {
    delete process.env.TRUSTED_PROXY_HOPS; // exercise the default (2)
    __resetTrustedProxyHopCache();
  });
  afterAll(() => {
    if (prevHops === undefined) delete process.env.TRUSTED_PROXY_HOPS;
    else process.env.TRUSTED_PROXY_HOPS = prevHops;
    __resetTrustedProxyHopCache();
  });

  it('picks the client entry at the trusted-hop position, not the rotating hop', () => {
    // The exact header observed live: [client, edge]. req.ip resolved to the
    // rightmost (internal) entry — the 2026-07-07 bug.
    expect(
      clientIpFromRequest(req('216.241.83.102, 152.233.76.9', '152.233.76.9')),
    ).toBe('216.241.83.102');
  });

  // ── STABILITY (2026-07-07 — must not regress) ──────────────────────────
  it('is STABLE for the same client even when trailing internal hops rotate', () => {
    const a = clientIpFromRequest(req('216.241.83.102, 10.0.4.7', '10.0.4.7'));
    const b = clientIpFromRequest(req('216.241.83.102, 10.0.9.2', '10.0.9.2'));
    const c = clientIpFromRequest(req('216.241.83.102, 172.16.1.5', '172.16.1.5'));
    expect([a, b, c]).toEqual([
      '216.241.83.102',
      '216.241.83.102',
      '216.241.83.102',
    ]);
    expect(new Set([a, b, c]).size).toBe(1);
  });

  // ── UNSPOOFABILITY (ACC-08) ────────────────────────────────────────────
  describe('X-Forwarded-For injection (ACC-08)', () => {
    // Honest chain for client 216.241.83.102 is [client, edge] (len 2).
    // Whatever the client sends arrives as a PREFIX of that.
    const spoof = (injected: string) =>
      clientIpFromRequest(
        req(`${injected}, 216.241.83.102, 152.233.76.9`, '152.233.76.9'),
      );

    it('ignores a single injected entry and still resolves the real client', () => {
      expect(spoof('1.2.3.4')).toBe('216.241.83.102');
    });

    it('ignores a LONG injected prefix (chain padding)', () => {
      expect(
        clientIpFromRequest(
          req(
            '1.1.1.1, 2.2.2.2, 3.3.3.3, 4.4.4.4, 216.241.83.102, 152.233.76.9',
            '152.233.76.9',
          ),
        ),
      ).toBe('216.241.83.102');
    });

    it('CANNOT be used to rotate the key: 100 different injected values, one bucket', () => {
      // This is the property the throttle depends on. Under the previous
      // leftmost-XFF rule every one of these produced a DIFFERENT key, so the
      // shared counter never accumulated and the cap never fired.
      const keys = new Set(
        Array.from({ length: 100 }, (_, i) => spoof(`10.9.${i}.${i}`)),
      );
      expect(keys.size).toBe(1);
      expect([...keys][0]).toBe('216.241.83.102');
    });

    it('cannot forge the audit IP by sending a second X-Forwarded-For header', () => {
      // Node exposes repeated headers as an array. Reading only the first
      // element would let an attacker prepend a whole extra chain; the
      // resolver concatenates in order instead.
      expect(
        clientIpFromRequest(
          req(['9.9.9.9, 8.8.8.8', '216.241.83.102, 152.233.76.9'], '152.233.76.9'),
        ),
      ).toBe('216.241.83.102');
    });
  });

  // ── Configuration ──────────────────────────────────────────────────────
  it('honors TRUSTED_PROXY_HOPS for a deployment with a different chain', () => {
    process.env.TRUSTED_PROXY_HOPS = '3';
    __resetTrustedProxyHopCache();
    // Chain [FAKE, client, cdn, edge] — three appenders in front of us.
    expect(
      clientIpFromRequest(req('1.2.3.4, 203.0.113.9, 10.0.0.1, 10.0.0.2')),
    ).toBe('203.0.113.9');
  });

  it('ignores a nonsensical hop count (<1) and uses the default', () => {
    process.env.TRUSTED_PROXY_HOPS = '0'; // would mean "trust the rightmost"
    __resetTrustedProxyHopCache();
    expect(clientIpFromRequest(req('216.241.83.102, 152.233.76.9'))).toBe(
      '216.241.83.102',
    );
  });

  // ── Normalization (a key that differs by form fragments the counter) ────
  it('trims whitespace around the chosen entry', () => {
    expect(clientIpFromRequest(req('  203.0.113.9 , 10.0.0.1'))).toBe(
      '203.0.113.9',
    );
  });

  it('normalizes IPv4-mapped IPv6 and strips ports', () => {
    expect(clientIpFromRequest(req(undefined, '::ffff:203.0.113.9'))).toBe(
      '203.0.113.9',
    );
    expect(clientIpFromRequest(req('203.0.113.9:51514, 10.0.0.1'))).toBe(
      '203.0.113.9',
    );
    expect(clientIpFromRequest(req('[2001:db8::1]:443, 10.0.0.1'))).toBe(
      '2001:db8::1',
    );
  });

  // ── Fallbacks ──────────────────────────────────────────────────────────
  it('falls back to req.ip when there is no XFF header', () => {
    expect(clientIpFromRequest(req(undefined, '198.51.100.7'))).toBe(
      '198.51.100.7',
    );
  });

  it('falls back to the raw socket address when req.ip is empty', () => {
    // Device/screen registration path used req.ip || req.socket.remoteAddress.
    expect(clientIpFromRequest(req(undefined, undefined, '198.51.100.9'))).toBe(
      '198.51.100.9',
    );
  });

  it('single-entry XFF is unchanged (chain shorter than the hop count)', () => {
    // Not behind the full chain (dev / direct hit) — clamp to the leftmost.
    expect(clientIpFromRequest(req('99.65.178.111', '99.65.178.111'))).toBe(
      '99.65.178.111',
    );
  });

  it('returns null (never throws) when nothing is resolvable', () => {
    expect(clientIpFromRequest({})).toBeNull();
    expect(clientIpFromRequest(undefined)).toBeNull();
    expect(clientIpFromRequest(req('', undefined))).toBeNull();
  });
});

/**
 * BUG 3 (2026-09-02) — the SAME-ORIGIN GATEWAY hop.
 *
 * A device whose network cannot reach this API directly runs its control
 * plane through the Next middleware gateway on the web origin. That hop
 * appends VERCEL'S egress address to X-Forwarded-For, so the normal
 * right-counted rule would resolve EVERY gateway device in the fleet to one
 * shared address: one throttle key for all of them (per-IP brute-force caps
 * collapse — bug 1's consequence, fleet-wide) and an AuditLog `ipAddress`
 * naming Vercel instead of whoever fired a district-wide lockdown.
 *
 * The gateway therefore forwards the real client IP with a shared secret.
 * These tests pin the only property that makes that safe: the forwarded IP is
 * honored ON A SECRET MATCH AND NEVER OTHERWISE — a wrong or missing secret
 * falls back to the normal rule, never to a client-supplied value.
 */
describe('clientIpFromRequest — same-origin gateway hop', () => {
  const SECRET = 'gateway-shared-secret-for-tests-0123456789';
  const prevSecret = process.env.GATEWAY_SHARED_SECRET;
  const prevHops = process.env.TRUSTED_PROXY_HOPS;

  /**
   * The chain a GATEWAY device produces: Vercel's egress address is the
   * "client" as far as Railway can see, then Railway's internal hop. With the
   * default hop count of 2 the normal rule picks `203.0.113.50` — Vercel.
   */
  const GATEWAY_XFF = '203.0.113.50, 152.233.76.9';
  const VERCEL_EGRESS = '203.0.113.50';
  const REAL_DEVICE_IP = '99.65.178.111';

  function gatewayReq(secret: string | undefined, forwardedIp: string | undefined) {
    const headers: Record<string, unknown> = { 'x-forwarded-for': GATEWAY_XFF };
    if (secret !== undefined) headers['x-venueos-gw-secret'] = secret;
    if (forwardedIp !== undefined) headers['x-venueos-gw-client-ip'] = forwardedIp;
    return { headers, ip: '152.233.76.9', socket: { remoteAddress: '152.233.76.9' } };
  }

  beforeEach(() => {
    delete process.env.TRUSTED_PROXY_HOPS; // default 2 = the measured chain
    __resetTrustedProxyHopCache();
    process.env.GATEWAY_SHARED_SECRET = SECRET;
  });
  afterAll(() => {
    if (prevSecret === undefined) delete process.env.GATEWAY_SHARED_SECRET;
    else process.env.GATEWAY_SHARED_SECRET = prevSecret;
    if (prevHops === undefined) delete process.env.TRUSTED_PROXY_HOPS;
    else process.env.TRUSTED_PROXY_HOPS = prevHops;
    __resetTrustedProxyHopCache();
  });

  it('DIRECT Railway chain is untouched by the gateway feature', () => {
    expect(clientIpFromRequest(req('216.241.83.102, 152.233.76.9', '152.233.76.9'))).toBe(
      '216.241.83.102',
    );
  });

  it('GATEWAY chain + VALID secret resolves the REAL device IP', () => {
    expect(clientIpFromRequest(gatewayReq(SECRET, REAL_DEVICE_IP))).toBe(REAL_DEVICE_IP);
  });

  it('GATEWAY chain with a WRONG secret ignores the forwarded IP', () => {
    // Falls back to the normal right-counted rule — Vercel's egress, which is
    // wrong-but-safe. It must NEVER be the caller-supplied value.
    const got = clientIpFromRequest(
      gatewayReq('not-the-secret-but-same-length-0123456789', '1.2.3.4'),
    );
    expect(got).toBe(VERCEL_EGRESS);
    expect(got).not.toBe('1.2.3.4');
  });

  it('GATEWAY headers with NO secret at all are ignored', () => {
    const got = clientIpFromRequest(gatewayReq(undefined, '1.2.3.4'));
    expect(got).toBe(VERCEL_EGRESS);
    expect(got).not.toBe('1.2.3.4');
  });

  it('the feature is OFF when GATEWAY_SHARED_SECRET is unset', () => {
    delete process.env.GATEWAY_SHARED_SECRET;
    expect(clientIpFromRequest(gatewayReq('anything', '1.2.3.4'))).toBe(VERCEL_EGRESS);
  });

  it('a too-short configured secret is refused (that is not a credential)', () => {
    process.env.GATEWAY_SHARED_SECRET = 'short';
    expect(clientIpFromRequest(gatewayReq('short', '1.2.3.4'))).toBe(VERCEL_EGRESS);
  });

  it('a valid secret carrying a JUNK forwarded IP falls through, never returns junk', () => {
    expect(clientIpFromRequest(gatewayReq(SECRET, 'not-an-ip'))).toBe(VERCEL_EGRESS);
    expect(clientIpFromRequest(gatewayReq(SECRET, ''))).toBe(VERCEL_EGRESS);
  });

  it('normalizes the forwarded IP (port + IPv4-mapped IPv6) so the throttle key is stable', () => {
    expect(clientIpFromRequest(gatewayReq(SECRET, '99.65.178.111:51514'))).toBe(REAL_DEVICE_IP);
    expect(clientIpFromRequest(gatewayReq(SECRET, '::ffff:99.65.178.111'))).toBe(REAL_DEVICE_IP);
  });

  it('a client that sets the gateway headers itself on a DIRECT request gains nothing', () => {
    const headers: Record<string, unknown> = {
      'x-forwarded-for': '216.241.83.102, 152.233.76.9',
      'x-venueos-gw-secret': 'guess',
      'x-venueos-gw-client-ip': '10.0.0.1',
    };
    expect(clientIpFromRequest({ headers })).toBe('216.241.83.102');
  });
});
