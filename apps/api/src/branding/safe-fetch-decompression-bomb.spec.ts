/**
 * SF-01 (2026-09-02, adversarial security re-audit) — DECOMPRESSION BOMB.
 *
 * `safeFetch`'s streaming byte cap counts bytes ON THE WIRE. The
 * `content-encoding` decode that follows had NO output limit, so a hostile
 * upstream could answer a few hundred KB of gzip that inflates to gigabytes
 * and exhaust the API process — the same process that owns emergency fan-out.
 *
 * Reachable from 22 call sites; `/api/v1/proxy/web` and `/api/v1/feeds/*` are
 * UNAUTHENTICATED, so no account is needed: point either at a host you
 * control that answers `Content-Encoding: gzip`.
 *
 * These tests drive the REAL decode path (the transport is faked, the zlib
 * call is not) with a 10 MB-of-zeros gzip that compresses to ~10 KB.
 */

jest.mock('node:dns/promises', () => ({ lookup: jest.fn() }));
jest.mock('node:http', () => {
  const { EventEmitter: EE } = require('node:events');
  return {
    request: (_url: unknown, _opts: unknown, cb: (res: any) => void) => {
      const req: any = new EE();
      req.end = () => {
        const res: any = new EE();
        res.statusCode = 200;
        res.headers = (global as any).__sfStubHeaders;
        res.resume = () => undefined;
        // Deliver on a later tick so the caller has attached its listeners.
        setImmediate(() => {
          res.emit('data', (global as any).__sfStubBody);
          res.emit('end');
        });
        cb(res);
      };
      req.destroy = () => undefined;
      req.write = () => true;
      return req;
    },
  };
});

import * as zlib from 'node:zlib';
import type * as httpTypes from 'node:http';
import { lookup } from 'node:dns/promises';
import { safeFetch, FetchTooLargeError, decodedByteCeiling } from './safe-fetch';

const mockedLookup = lookup as unknown as jest.Mock;

/** A public address so the SSRF pre-checks pass; the transport is faked above. */
const PUBLIC_IP = '93.184.216.34';

/** Point the faked transport at a specific body + headers. */
function stubHttpResponse(body: Buffer, headers: httpTypes.IncomingHttpHeaders) {
  (global as any).__sfStubBody = body;
  (global as any).__sfStubHeaders = headers;
  return () => {
    delete (global as any).__sfStubBody;
    delete (global as any).__sfStubHeaders;
  };
}

describe('safeFetch — decompression bomb (SF-01)', () => {
  beforeEach(() => {
    mockedLookup.mockReset();
    mockedLookup.mockResolvedValue([{ address: PUBLIC_IP, family: 4 }]);
  });

  it('decodedByteCeiling bounds the decode at 12x the wire cap, hard-capped at 24 MB', () => {
    expect(decodedByteCeiling(512 * 1024)).toBe(12 * 512 * 1024);
    expect(decodedByteCeiling(1_500_000)).toBe(12 * 1_500_000);
    // 5 MB x 12 = 60 MB -> clamped to the absolute ceiling.
    expect(decodedByteCeiling(5 * 1024 * 1024)).toBe(24 * 1024 * 1024);
    expect(decodedByteCeiling(8 * 1024 * 1024)).toBe(24 * 1024 * 1024);
    // An explicit override can only ever tighten it, never raise it.
    expect(decodedByteCeiling(512 * 1024, 1024)).toBe(1024);
    expect(decodedByteCeiling(512 * 1024, 999 * 1024 * 1024)).toBe(24 * 1024 * 1024);
  });

  it('REFUSES a gzip body that inflates past the ceiling (never allocates it)', async () => {
    // 10 MB of zeros gzips to a few KB. With maxBytes = 64 KB the ceiling is
    // 768 KB, so this is a ~13x-over-ceiling bomb delivered in ~10 KB.
    const bomb = zlib.gzipSync(Buffer.alloc(10 * 1024 * 1024, 0));
    expect(bomb.length).toBeLessThan(64 * 1024); // it really does fit the wire cap

    const restore = stubHttpResponse(bomb, {
      'content-type': 'text/html',
      'content-encoding': 'gzip',
    });
    try {
      await expect(
        safeFetch('http://bomb.example/', { maxBytes: 64 * 1024 }),
      ).rejects.toBeInstanceOf(FetchTooLargeError);
    } finally {
      restore();
    }
  });

  it('REFUSES the same bomb under deflate and brotli', async () => {
    const raw = Buffer.alloc(10 * 1024 * 1024, 0);
    for (const [enc, buf] of [
      ['deflate', zlib.deflateSync(raw)],
      ['br', zlib.brotliCompressSync(raw)],
    ] as const) {
      const restore = stubHttpResponse(buf, {
        'content-type': 'text/html',
        'content-encoding': enc,
      });
      try {
        await expect(
          safeFetch('http://bomb.example/', { maxBytes: 64 * 1024 }),
        ).rejects.toBeInstanceOf(FetchTooLargeError);
      } finally {
        restore();
      }
    }
  });

  it('still decodes an ordinary compressible page (no regression)', async () => {
    const page = Buffer.from('<html>' + 'a'.repeat(200_000) + '</html>', 'utf8');
    const restore = stubHttpResponse(zlib.gzipSync(page), {
      'content-type': 'text/html',
      'content-encoding': 'gzip',
    });
    try {
      const r = await safeFetch('http://ok.example/', { maxBytes: 64 * 1024 });
      expect(r.body.length).toBe(page.length);
      expect(r.body.subarray(0, 6).toString()).toBe('<html>');
    } finally {
      restore();
    }
  });

  it('keeps the pre-existing raw-bytes fallback for a MALFORMED encoding', async () => {
    // Not a size problem — a corrupt stream. Behaviour must be unchanged:
    // return the raw bytes rather than throw.
    const junk = Buffer.from('not actually gzip at all');
    const restore = stubHttpResponse(junk, {
      'content-type': 'text/html',
      'content-encoding': 'gzip',
    });
    try {
      const r = await safeFetch('http://junk.example/', { maxBytes: 64 * 1024 });
      expect(r.body.equals(junk)).toBe(true);
    } finally {
      restore();
    }
  });
});
