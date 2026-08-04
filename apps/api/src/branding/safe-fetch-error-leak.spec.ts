/**
 * SDE-01 (2026-08-04) — an SSRF refusal must never tell the caller WHY.
 *
 * THE BUG: `SsrfError.message` carries diagnostic detail including the address
 * a hostname resolved to — "DNS for intranet.corp resolved to private range
 * (10.0.0.5)". `/api/v1/proxy/web` is UNAUTHENTICATED (`@Controller(
 * 'api/v1/proxy')` declares no guards; the route is deliberately public
 * because it is loaded as an iframe src) and echoed that string straight back
 * as `Upstream blocked: ${e.message}`.
 *
 * So anyone on the internet could point it at an internal hostname and read
 * back both the fact that it resolved privately and the exact IP — an internal
 * network mapper with no account. The comment above that line already claimed
 * "uniform error for SSRF probing"; the code did the opposite.
 *
 * The fix adds `SsrfError.publicMessage`, a single uniform string used on the
 * wire, while `message` keeps the detail for the server log. These tests pin
 * BOTH halves: the detail must survive for logging, and it must never appear
 * in the public string.
 */

import { SsrfError } from './safe-fetch';

// Values a real refusal would carry — resolved addresses across the ranges the
// guard rejects (RFC1918, loopback, link-local, and the cloud metadata IP that
// is the actual prize on Railway/AWS/GCP).
const LEAKY_MESSAGES = [
  'DNS for intranet.corp resolved to private range (10.0.0.5)',
  'DNS for db.internal resolved to private range (192.168.1.20)',
  'DNS for metadata.google.internal resolved to private range (169.254.169.254)',
  'Private/loopback IP 127.0.0.1 is not allowed',
];

describe('SDE-01 — SsrfError never exposes the resolved address to a caller', () => {
  it('keeps the diagnostic detail on .message (server logs still useful)', () => {
    for (const detail of LEAKY_MESSAGES) {
      expect(new SsrfError(detail).message).toBe(detail);
    }
  });

  it('exposes a publicMessage containing no address, hostname, or reason', () => {
    for (const detail of LEAKY_MESSAGES) {
      const pub = new SsrfError(detail).publicMessage;
      // No IPv4 literal of any kind.
      expect(pub).not.toMatch(/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/);
      // None of the internal hostnames.
      expect(pub).not.toMatch(/intranet|internal|corp|metadata|localhost/i);
      // Not the raw detail, and no hint at which check failed.
      expect(pub).not.toBe(detail);
      expect(pub).not.toMatch(/private|loopback|resolved|DNS/i);
    }
  });

  it('returns the SAME public string regardless of why the URL was refused', () => {
    // This is the property that matters most. Even with the address removed, a
    // caller who can tell "private DNS resolution" apart from "bad scheme" can
    // still enumerate internal hostnames by watching which refusal comes back.
    const distinct = new Set(LEAKY_MESSAGES.map((m) => new SsrfError(m).publicMessage));
    expect(distinct.size).toBe(1);
  });

  it('still allows an explicit publicMessage override, and defaults safely', () => {
    expect(new SsrfError('detail', 'Custom safe text').publicMessage).toBe('Custom safe text');
    // Default must be non-empty — an empty string would render a blank error
    // page rather than an honest refusal.
    expect(new SsrfError('detail').publicMessage.length).toBeGreaterThan(0);
  });
});
