import { clientIpFromRequest } from './client-ip';

/**
 * Unit tests for the shared client-IP resolver (security P1, 2026-07-07).
 * Mirrors the throttler tracker's stability contract — the SAME client must
 * resolve to the SAME IP even when Railway appends varying internal hops — and
 * adds the socket fallback + null cases specific to this helper (used by
 * AuditLog / RequestLog / Screen `ipAddress`, which allow null).
 */
function req(xff: unknown, ip?: string, socket?: string) {
  return {
    headers: { 'x-forwarded-for': xff },
    ip,
    socket: { remoteAddress: socket },
  };
}

describe('clientIpFromRequest', () => {
  it('returns the leftmost X-Forwarded-For entry (the original client)', () => {
    expect(
      clientIpFromRequest(req('216.241.83.102, 152.233.76.9', '152.233.76.9')),
    ).toBe('216.241.83.102');
  });

  it('is STABLE for the same client even when trailing internal hops rotate', () => {
    // The exact Railway condition: same real client, different internal hop
    // (and thus different req.ip) each request. The resolved IP must not move,
    // or AuditLog forensics + the throttle key would fragment.
    const a = clientIpFromRequest(req('216.241.83.102, 10.0.4.7', '10.0.4.7'));
    const b = clientIpFromRequest(req('216.241.83.102, 10.0.9.2', '10.0.9.2'));
    const c = clientIpFromRequest(
      req('216.241.83.102, 172.16.1.5', '172.16.1.5'),
    );
    expect([a, b, c]).toEqual([
      '216.241.83.102',
      '216.241.83.102',
      '216.241.83.102',
    ]);
    expect(new Set([a, b, c]).size).toBe(1);
  });

  it('trims whitespace around the chosen entry', () => {
    expect(clientIpFromRequest(req('  203.0.113.9 , 10.0.0.1'))).toBe(
      '203.0.113.9',
    );
  });

  it('handles an array-valued x-forwarded-for header', () => {
    expect(clientIpFromRequest(req(['203.0.113.9, 10.0.0.1', '10.0.0.2']))).toBe(
      '203.0.113.9',
    );
  });

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

  it('single-entry XFF equals req.ip (common case unchanged)', () => {
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
