jest.mock('node:dns/promises', () => ({ lookup: jest.fn() }));

import { lookup } from 'node:dns/promises';
import { validatePublicUrl, assertPublicUrl, SsrfError } from './safe-fetch';

const mockedLookup = lookup as unknown as jest.Mock;

/**
 * SSRF-01 (2026-08-04) — the two guards are NOT interchangeable.
 *
 * `renderer.service.ts` intercepts every request Puppeteer makes and used to
 * apply only the SYNCHRONOUS `validatePublicUrl` to them, on the stated
 * reasoning that "the top-level URL already passed the full DNS-resolving
 * assertPublicUrl". That is true of the FIRST hop only. A 302 — or a
 * `location.href` assignment — produces a NEW navigation request, and whatever
 * document is current when rendering finishes is what `page.content()` hands
 * back to the caller. So a hostname resolving into a private range became an
 * unauthenticated read-SSRF with the body reflected out of the container.
 *
 * These tests pin the exact property that makes that possible: the synchronous
 * guard inspects an IP LITERAL and nothing else, so a HOSTNAME walks past it.
 * If someone later "simplifies" the renderer back to one guard, this fails.
 */
describe('SSRF guards — validatePublicUrl vs assertPublicUrl', () => {
  beforeEach(() => mockedLookup.mockReset());

  describe('validatePublicUrl (synchronous, no DNS)', () => {
    it('rejects a private IP LITERAL', () => {
      expect(() => validatePublicUrl('http://169.254.169.254/latest/meta-data/')).toThrow(SsrfError);
      expect(() => validatePublicUrl('http://127.0.0.1/')).toThrow(SsrfError);
      expect(() => validatePublicUrl('http://10.0.0.5/')).toThrow(SsrfError);
    });

    it('rejects non-http(s) schemes and non-80/443 ports', () => {
      expect(() => validatePublicUrl('file:///etc/passwd')).toThrow(SsrfError);
      expect(() => validatePublicUrl('http://example.com:22/')).toThrow(SsrfError);
    });

    it('THE GAP: lets a HOSTNAME through without ever consulting DNS', () => {
      // This is not a bug in validatePublicUrl — it is its documented contract
      // (no DNS round-trip). It is only dangerous when used ALONE on a
      // navigation, which is what SSRF-01 was.
      expect(() => validatePublicUrl('http://metadata.attacker.example/')).not.toThrow();
      expect(mockedLookup).not.toHaveBeenCalled();
    });
  });

  describe('assertPublicUrl (resolves DNS)', () => {
    it('rejects a hostname whose A record points into a private range', async () => {
      mockedLookup.mockResolvedValue([{ address: '169.254.169.254', family: 4 }]);
      await expect(assertPublicUrl('http://metadata.attacker.example/')).rejects.toThrow(SsrfError);
    });

    it('rejects when ANY returned address is private, not just the first', async () => {
      mockedLookup.mockResolvedValue([
        { address: '93.184.216.34', family: 4 },
        { address: '10.1.2.3', family: 4 },
      ]);
      await expect(assertPublicUrl('http://split-horizon.example/')).rejects.toThrow(SsrfError);
    });

    it('rejects when DNS returns nothing', async () => {
      mockedLookup.mockResolvedValue([]);
      await expect(assertPublicUrl('http://void.example/')).rejects.toThrow(SsrfError);
    });

    it('fails CLOSED when the lookup itself errors', async () => {
      mockedLookup.mockRejectedValue(new Error('ENOTFOUND'));
      await expect(assertPublicUrl('http://broken.example/')).rejects.toThrow(SsrfError);
    });

    it('allows a hostname that resolves to a public address', async () => {
      mockedLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
      await expect(assertPublicUrl('https://example.com/')).resolves.toBeInstanceOf(URL);
    });

    it('skips the lookup for an IP literal (already checked synchronously)', async () => {
      await expect(assertPublicUrl('https://93.184.216.34/')).resolves.toBeInstanceOf(URL);
      expect(mockedLookup).not.toHaveBeenCalled();
    });
  });
});
