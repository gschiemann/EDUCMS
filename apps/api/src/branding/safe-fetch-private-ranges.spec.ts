/**
 * SEC-006 (2026-09-04) — the shared private/unsafe address denylist.
 *
 * `isPrivateIp` is the single verdict function behind `validatePublicUrl`,
 * `assertPublicUrl`, `safeFetch`'s connect-time pin, the template zone-URL
 * guard and (as of SEC-006) the renderer's connected-peer check. A gap here is
 * a gap in every one of them, so the ranges get their own table-driven suite.
 */

import { isPrivateIp, validatePublicUrl, SsrfError } from './safe-fetch';

describe('isPrivateIp — cloud metadata endpoints', () => {
  it.each([
    // Already covered by 169.254/16, pinned so a refactor cannot lose it.
    ['AWS/GCP/DO IMDS', '169.254.169.254'],
    ['AWS ECS task metadata', '169.254.170.2'],
    // NOT in any RFC-1918 / link-local range — the SEC-006 gap.
    ['Azure WireServer', '168.63.129.16'],
    ['Alibaba metadata', '100.100.100.200'],
    ['Oracle legacy metadata', '192.0.0.192'],
  ])('denies %s (%s)', (_label, ip) => {
    expect(isPrivateIp(ip)).toBe(true);
  });

  it('does not over-reach into the surrounding public prefix', () => {
    // 168.63.0.0/16 is otherwise ordinary space — only the WireServer host is
    // denied, so a customer whose CDN lives nearby is unaffected.
    expect(isPrivateIp('168.63.129.17')).toBe(false);
    expect(isPrivateIp('168.62.129.16')).toBe(false);
  });
});

describe('isPrivateIp — IPv4 ranges', () => {
  it.each([
    ['loopback', '127.0.0.1'],
    ['this-network', '0.0.0.0'],
    ['rfc1918 /8', '10.1.2.3'],
    ['rfc1918 /12 low', '172.16.0.1'],
    ['rfc1918 /12 high', '172.31.255.254'],
    ['rfc1918 /16', '192.168.1.1'],
    ['link-local', '169.254.1.1'],
    ['CGNAT', '100.64.0.1'],
    ['6to4 relay anycast', '192.88.99.1'],
    ['benchmarking 198.18/15', '198.18.0.1'],
    ['benchmarking 198.19/16', '198.19.255.254'],
    ['TEST-NET-1', '192.0.2.5'],
    ['TEST-NET-2', '198.51.100.5'],
    ['TEST-NET-3', '203.0.113.5'],
    ['multicast', '224.0.0.1'],
    ['broadcast', '255.255.255.255'],
  ])('denies %s (%s)', (_label, ip) => {
    expect(isPrivateIp(ip)).toBe(true);
  });

  it.each([
    ['example.com', '93.184.216.34'],
    ['cloudflare dns', '1.1.1.1'],
    ['google dns', '8.8.8.8'],
    ['just outside rfc1918 /12', '172.32.0.1'],
    ['just outside CGNAT', '100.128.0.1'],
    ['just outside benchmarking', '198.20.0.1'],
  ])('allows %s (%s)', (_label, ip) => {
    expect(isPrivateIp(ip)).toBe(false);
  });
});

describe('isPrivateIp — IPv6 ranges', () => {
  it.each([
    ['loopback', '::1'],
    ['unspecified', '::'],
    ['link-local fe80', 'fe80::1'],
    // fe80::/10 spans fe80 THROUGH febf — the old check only saw `fe80:`.
    ['link-local fe90', 'fe90::1'],
    ['link-local feaf', 'feaf::1'],
    ['link-local febf', 'febf::1'],
    ['link-local with zone index', 'fe80::1%eth0'],
    ['unique local fc00::/7', 'fd00::1'],
    ['unique local fc-half', 'fc12::1'],
    ['multicast', 'ff02::1'],
    ['NAT64 well-known prefix', '64:ff9b::7f00:1'],
    ['ipv4-mapped loopback, dotted', '::ffff:127.0.0.1'],
    ['ipv4-mapped rfc1918, dotted', '::ffff:10.0.0.1'],
    // The hex tail form of the SAME addresses — the SEC-006 gap.
    ['ipv4-mapped loopback, hex tail', '::ffff:7f00:1'],
    ['ipv4-mapped metadata, hex tail', '::ffff:a9fe:a9fe'],
    ['ipv4-compatible loopback, hex tail', '::7f00:1'],
  ])('denies %s (%s)', (_label, ip) => {
    expect(isPrivateIp(ip)).toBe(true);
  });

  it.each([
    ['public v6', '2606:4700:4700::1111'],
    ['ipv4-mapped public, dotted', '::ffff:93.184.216.34'],
    ['ipv4-mapped public, hex tail', '::ffff:5db8:d822'],
    // fec0::/10 is deprecated site-local, not link-local — must not be
    // swept up by the fe8-feb matcher.
    ['not link-local (fec0)', 'fec0::1'],
  ])('allows %s (%s)', (_label, ip) => {
    expect(isPrivateIp(ip)).toBe(false);
  });
});

describe('validatePublicUrl — literals reachable through the URL parser', () => {
  it.each([
    ['dotted loopback', 'http://127.0.0.1/'],
    // WHATWG normalises every legacy IPv4 spelling, so these arrive at the
    // range check already in dotted form.
    ['decimal-encoded loopback', 'http://2130706433/'],
    ['octal-encoded loopback', 'http://0177.0.0.1/'],
    ['hex-encoded loopback', 'http://0x7f000001/'],
    ['bracketed ipv6 loopback', 'http://[::1]/'],
    ['azure wireserver', 'http://168.63.129.16/metadata/instance'],
  ])('rejects %s', (_label, url) => {
    expect(() => validatePublicUrl(url)).toThrow(SsrfError);
  });

  it('still accepts an ordinary public URL', () => {
    expect(validatePublicUrl('https://example.com/page').hostname).toBe('example.com');
  });
});
