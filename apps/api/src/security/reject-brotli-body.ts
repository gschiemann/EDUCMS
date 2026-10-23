/**
 * Refuse Brotli-compressed REQUEST bodies before any body parser runs
 * (2026-10-23, CVE-2026-111497 "Node2Shell").
 *
 * Node's bundled Brotli decoder had an out-of-bounds write that permits
 * remote code execution (fixed in Node 22.23.4 / 24.22.1 / 26.12.1). Express 5's
 * body parser decompresses `Content-Encoding: br` request bodies by default,
 * so before the patched runtime is everywhere ANY unauthenticated POST could
 * reach the decoder. The Node upgrade is the fix; this is the second layer,
 * kept because no VenueOS client compresses a request body — not the
 * dashboard, not the web player, not either APK — so refusing `br` costs
 * nothing and closes the next decoder bug of this class before it is found.
 *
 * Only `br` is refused: gzip/deflate keep working for any integration that
 * sends them.
 */
import type { NextFunction, Request, Response } from 'express';

export function hasBrotliContentEncoding(header: string | string[] | undefined): boolean {
  const value = Array.isArray(header) ? header.join(',') : header ?? '';
  return value.split(',').some((token) => token.trim().toLowerCase() === 'br');
}

export function rejectBrotliRequestBody(req: Request, res: Response, next: NextFunction): void {
  if (hasBrotliContentEncoding(req.headers['content-encoding'])) {
    res.status(415).json({
      statusCode: 415,
      code: 'UNSUPPORTED_CONTENT_ENCODING',
      message: 'Brotli-compressed request bodies are not accepted.',
    });
    return;
  }
  next();
}
