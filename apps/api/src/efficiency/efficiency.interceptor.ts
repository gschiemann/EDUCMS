import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { Request, Response } from 'express';
import { EfficiencyMetricsService } from './efficiency-metrics.service';

/**
 * EfficiencyInterceptor — global NestJS interceptor.
 *
 * Records per-route response bytes, request count, and latency (ms) for
 * every request. Overhead is minimal:
 *  - One Date.now() call at entry and exit
 *  - One synchronous map update on the EfficiencyMetricsService singleton
 *  - One best-effort async Redis HINCRBY (fire-and-forget, never awaited
 *    on the request path)
 *
 * Asset/proxy/egress detection: any request to /api/v1/assets, /api/v1/proxy,
 * or /api/v1/storage is flagged as an asset request so egress accounting
 * and cache-hit ratio can be tracked. Conditional headers (If-None-Match /
 * If-Modified-Since) and 304 responses are detected for the cache-hit ratio.
 *
 * No serialisation of the response body is performed — we read
 * Content-Length from the response headers if available, falling back to
 * zero. This keeps overhead at O(1) per request.
 */
@Injectable()
export class EfficiencyInterceptor implements NestInterceptor {
  constructor(private readonly metrics: EfficiencyMetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const start = Date.now();
    const httpCtx = context.switchToHttp();
    const req = httpCtx.getRequest<Request>();
    const res = httpCtx.getResponse<Response>();

    // Normalise route: strip query params + collapse UUIDs to ':id'
    const route = normaliseRoute(req.method, req.url);

    const isAsset = /^(GET|HEAD) \/api\/v1\/(assets|proxy|storage)/.test(route);
    const hadConditionalHeaders = !!(
      req.headers['if-none-match'] ||
      req.headers['if-modified-since']
    );

    return next.handle().pipe(
      tap({
        next: () => {
          const durationMs = Date.now() - start;
          const statusCode = res.statusCode;
          const wasNotModified = statusCode === 304;

          // Prefer Content-Length header; fall back to 0 (safe – never fabricates bytes)
          const cl = res.getHeader('content-length');
          const bytes = cl ? parseInt(String(cl), 10) || 0 : 0;

          this.metrics.recordRequest({
            route,
            statusCode,
            bytes,
            durationMs,
            isAsset,
            hadConditionalHeaders,
            wasNotModified,
          });
        },
        error: () => {
          // Record errors too (bytes=0 for errors is safe — we have no body)
          const durationMs = Date.now() - start;
          this.metrics.recordRequest({
            route,
            statusCode: res.statusCode || 500,
            bytes: 0,
            durationMs,
            isAsset,
            hadConditionalHeaders,
            wasNotModified: false,
          });
        },
      }),
    );
  }
}

/** Collapse UUIDs and numeric IDs in paths so all /screens/abc123 group together. */
function normaliseRoute(method: string, url: string): string {
  const path = url.split('?')[0]; // strip query string
  const normalised = path
    .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '/:id')
    .replace(/\/\d+/g, '/:id');
  return `${method} ${normalised}`;
}
