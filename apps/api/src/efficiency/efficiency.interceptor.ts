import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';
import { Request, Response } from 'express';
import { EfficiencyMetricsService } from './efficiency-metrics.service';

/**
 * EfficiencyInterceptor — global NestJS interceptor.
 *
 * Records per-route response bytes, request count, and latency (ms) for
 * every request.
 *
 * ── 2026-09-02 (efficiency audit P0-6) ────────────────────────────────
 * BYTES ARE NOW MEASURED AFTER SERIALISATION. The previous version read
 * `Content-Length` inside a `tap()` — which fires when the handler's
 * observable EMITS, i.e. BEFORE Nest serialises the body and before Express
 * sets the header. Response bytes were therefore recorded as 0 for most
 * JSON responses, which is why the dashboard's "top routes by bytes" was
 * useless. We now wrap `res.write` / `res.end` and count the bytes actually
 * handed to the socket, and we record on the response's `finish` / `close`
 * event rather than on the observable. That also covers piped/streamed
 * bodies (APK downloads, proxied assets) which never had a Content-Length.
 *
 * Overhead per request:
 *  - two Date.now() calls
 *  - one Buffer.byteLength per written chunk
 *  - synchronous map updates on the EfficiencyMetricsService singleton
 *  - ZERO Redis commands. The service accumulates in memory and flushes one
 *    pipeline every ~10 s (previously: 5 awaited Redis commands per request,
 *    ~2.76 M Redis operations/day at observed traffic).
 *
 * Asset/egress detection: /api/v1/assets, /api/v1/proxy, /api/v1/storage,
 * /api/v1/player/apk, /api/v1/player/manager-apk and /api/v1/streaming are
 * flagged as asset requests so egress accounting and cache-hit ratio cover
 * the APK and streaming paths too. A 304 is a cache HIT; a 200 that carried
 * conditional headers is a MISS (it previously counted as a hit, which made
 * a cache-miss storm look healthy).
 *
 * Everything is wrapped in try/catch: observability must never break a real
 * request.
 */

/** Routes whose bytes count toward API egress accounting. */
const ASSET_ROUTE_RE =
  /^(GET|HEAD) \/api\/v1\/(assets|proxy|storage|player\/apk|player\/manager-apk|streaming)(\/|$)/;

/** The two socket-writing methods we wrap, typed without `any`. */
type WriteFn = (...args: unknown[]) => boolean;
type EndFn = (...args: unknown[]) => unknown;

@Injectable()
export class EfficiencyInterceptor implements NestInterceptor {
  constructor(private readonly metrics: EfficiencyMetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    // This is a GLOBAL interceptor, so it also fires for WebSocket gateway
    // handlers. There is no request/response there — `switchToHttp()` hands
    // back the socket client and `req.url` is undefined. Bail out early
    // rather than relying on the catch below.
    if (context.getType() !== 'http') return next.handle();

    const start = Date.now();
    const httpCtx = context.switchToHttp();
    const req = httpCtx.getRequest<Request>();
    const res = httpCtx.getResponse<Response>();

    try {
      // Normalise route: strip query params + collapse UUIDs to ':id'
      const route = normaliseRoute(req.method, req.url);

      const isAsset = ASSET_ROUTE_RE.test(route);
      const hadConditionalHeaders = !!(
        req.headers['if-none-match'] || req.headers['if-modified-since']
      );

      // ── Count the bytes actually written to the socket ──────────────
      let bytesWritten = 0;
      const raw = res as unknown as { write: WriteFn; end: EndFn };
      const originalWrite = raw.write;
      const originalEnd = raw.end;
      raw.write = function patchedWrite(this: unknown, ...args: unknown[]): boolean {
        try {
          bytesWritten += chunkBytes(args[0], args[1]);
        } catch {
          /* never break a real response */
        }
        return originalWrite.apply(this, args);
      };
      raw.end = function patchedEnd(this: unknown, ...args: unknown[]): unknown {
        try {
          // res.end(cb) / res.end(chunk, cb) — a callback is not a chunk.
          if (typeof args[0] !== 'function') bytesWritten += chunkBytes(args[0], args[1]);
        } catch {
          /* never break a real response */
        }
        return originalEnd.apply(this, args);
      };

      // ── Record once, when the response is actually done ─────────────
      // `finish` = body fully handed off; `close` also covers a client that
      // aborted mid-response. Whichever comes first wins; the guard makes it
      // exactly-once.
      let recorded = false;
      const record = () => {
        if (recorded) return;
        recorded = true;
        try {
          const durationMs = Date.now() - start;
          const statusCode = res.statusCode;
          // Fall back to Content-Length only when nothing was observed on
          // the socket (e.g. a response written by a layer we did not wrap).
          let bytes = bytesWritten;
          if (bytes === 0) {
            const cl = Number(res.getHeader('content-length'));
            if (Number.isFinite(cl) && cl > 0) bytes = cl;
          }
          this.metrics.recordRequest({
            route,
            statusCode,
            bytes,
            durationMs,
            isAsset,
            hadConditionalHeaders,
            wasNotModified: statusCode === 304,
          });
        } catch {
          /* observability must never break a real request */
        }
      };
      res.once('finish', record);
      res.once('close', record);
    } catch {
      /* if instrumentation cannot be installed, serve the request anyway */
    }

    return next.handle();
  }
}

/** Byte length of one written chunk, tolerant of every shape Node accepts. */
function chunkBytes(chunk: unknown, encoding: unknown): number {
  if (chunk === null || chunk === undefined) return 0;
  if (typeof chunk === 'string') {
    const enc = typeof encoding === 'string' ? encoding : 'utf8';
    try {
      return Buffer.byteLength(chunk, enc as BufferEncoding);
    } catch {
      return Buffer.byteLength(chunk);
    }
  }
  if (Buffer.isBuffer(chunk)) return chunk.length;
  if (chunk instanceof Uint8Array) return chunk.byteLength;
  return 0;
}

/** Collapse UUIDs and numeric IDs in paths so all /screens/abc123 group together. */
function normaliseRoute(method: string, url: string): string {
  const path = url.split('?')[0]; // strip query string
  const normalised = path
    .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '/:id')
    .replace(/\/\d+/g, '/:id');
  return `${method} ${normalised}`;
}
