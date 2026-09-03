import { EventEmitter } from 'events';
import { of } from 'rxjs';
import { ExecutionContext, CallHandler } from '@nestjs/common';
import { EfficiencyInterceptor } from './efficiency.interceptor';
import { EfficiencyMetricsService } from './efficiency-metrics.service';

/**
 * The interceptor's job is to hand EfficiencyMetricsService NUMBERS THAT ARE
 * TRUE. Before 2026-09-02 it read Content-Length inside a `tap()` that fires
 * BEFORE Nest serialises the body — so nearly every JSON route reported
 * `bytes: 0`, and "top routes by bytes" on the dashboard was noise.
 *
 * These tests pin: bytes are counted post-serialisation from what is written
 * to the socket, exactly once per response, and the asset classifier now
 * covers the APK and streaming paths.
 */

/** Minimal http.ServerResponse stand-in: an emitter with write/end/headers. */
class FakeResponse extends EventEmitter {
  statusCode = 200;
  private headers = new Map<string, string | number>();
  written: number[] = [];

  getHeader(name: string) {
    return this.headers.get(name.toLowerCase());
  }
  setHeader(name: string, value: string | number) {
    this.headers.set(name.toLowerCase(), value);
  }
  write(chunk: unknown, _encoding?: unknown): boolean {
    this.written.push(byteLen(chunk));
    return true;
  }
  end(chunk?: unknown, _encoding?: unknown): unknown {
    if (chunk !== undefined && typeof chunk !== 'function') this.written.push(byteLen(chunk));
    this.emit('finish');
    this.emit('close');
    return this;
  }
}

function byteLen(chunk: unknown): number {
  if (typeof chunk === 'string') return Buffer.byteLength(chunk);
  if (Buffer.isBuffer(chunk)) return chunk.length;
  return 0;
}

function makeContext(
  method: string,
  url: string,
  headers: Record<string, string> = {},
  type: 'http' | 'ws' = 'http',
): { ctx: ExecutionContext; res: FakeResponse } {
  const res = new FakeResponse();
  const req = { method, url, headers };
  const ctx = {
    getType: () => type,
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => res,
    }),
  } as unknown as ExecutionContext;
  return { ctx, res };
}

const nextOf = (value: unknown): CallHandler =>
  ({ handle: () => of(value) }) as unknown as CallHandler;

describe('EfficiencyInterceptor', () => {
  let metrics: { recordRequest: jest.Mock; recordSlowQuery: jest.Mock };
  let interceptor: EfficiencyInterceptor;

  beforeEach(() => {
    metrics = { recordRequest: jest.fn(), recordSlowQuery: jest.fn() };
    interceptor = new EfficiencyInterceptor(
      metrics as unknown as EfficiencyMetricsService,
    );
  });

  it('counts the bytes ACTUALLY written, not the (unset) Content-Length', () => {
    const { ctx, res } = makeContext('GET', '/api/v1/screens');
    interceptor.intercept(ctx, nextOf({ ok: true })).subscribe();

    // Nest serialises + writes AFTER the observable emits — which is exactly
    // where the old implementation measured (and got 0).
    const body = JSON.stringify({ ok: true, padding: 'x'.repeat(500) });
    res.end(body);

    expect(metrics.recordRequest).toHaveBeenCalledTimes(1);
    expect(metrics.recordRequest.mock.calls[0][0].bytes).toBe(Buffer.byteLength(body));
  });

  it('sums a streamed body written in chunks (APK / proxied asset)', () => {
    const { ctx, res } = makeContext('GET', '/api/v1/player/apk/v/113');
    interceptor.intercept(ctx, nextOf(null)).subscribe();

    res.write(Buffer.alloc(4096));
    res.write(Buffer.alloc(4096));
    res.end(Buffer.alloc(1024));

    const call = metrics.recordRequest.mock.calls[0][0];
    expect(call.bytes).toBe(4096 + 4096 + 1024);
    // APK routes now count toward egress accounting.
    expect(call.isAsset).toBe(true);
    expect(call.route).toBe('GET /api/v1/player/apk/v/:id');
  });

  it('records exactly once even though finish AND close both fire', () => {
    const { ctx, res } = makeContext('GET', '/api/v1/screens');
    interceptor.intercept(ctx, nextOf({})).subscribe();
    res.end('{}');
    res.emit('finish');
    res.emit('close');
    expect(metrics.recordRequest).toHaveBeenCalledTimes(1);
  });

  it('flags a 304 as not-modified with zero bytes', () => {
    const { ctx, res } = makeContext('GET', '/api/v1/assets/abc', {
      'if-none-match': 'W/"deadbeef"',
    });
    res.statusCode = 304;
    interceptor.intercept(ctx, nextOf(null)).subscribe();
    res.end();

    const call = metrics.recordRequest.mock.calls[0][0];
    expect(call.wasNotModified).toBe(true);
    expect(call.hadConditionalHeaders).toBe(true);
    expect(call.bytes).toBe(0);
    expect(call.isAsset).toBe(true);
  });

  it('reports a conditional-header 200 as a conditional request that was NOT a 304', () => {
    const { ctx, res } = makeContext('GET', '/api/v1/assets/abc', {
      'if-none-match': 'W/"stale"',
    });
    interceptor.intercept(ctx, nextOf(null)).subscribe();
    res.end(Buffer.alloc(10_000));

    const call = metrics.recordRequest.mock.calls[0][0];
    expect(call.hadConditionalHeaders).toBe(true);
    expect(call.wasNotModified).toBe(false); // → the service counts a MISS
    expect(call.bytes).toBe(10_000);
  });

  it('classifies streaming as an asset route and a normal API route as not', () => {
    const streaming = makeContext('GET', '/api/v1/streaming/channels/abc/play');
    interceptor.intercept(streaming.ctx, nextOf(null)).subscribe();
    streaming.res.end('{}');
    expect(metrics.recordRequest.mock.calls[0][0].isAsset).toBe(true);

    metrics.recordRequest.mockClear();
    const plain = makeContext('POST', '/api/v1/screens/status/fp1');
    interceptor.intercept(plain.ctx, nextOf(null)).subscribe();
    plain.res.end('{}');
    expect(metrics.recordRequest.mock.calls[0][0].isAsset).toBe(false);
  });

  it('falls back to Content-Length when nothing was observed on the socket', () => {
    const { ctx, res } = makeContext('GET', '/api/v1/screens');
    interceptor.intercept(ctx, nextOf(null)).subscribe();
    res.setHeader('content-length', 777);
    res.emit('finish');
    expect(metrics.recordRequest.mock.calls[0][0].bytes).toBe(777);
  });

  it('ignores non-HTTP contexts (WebSocket gateway handlers have no request/response)', () => {
    const { ctx, res } = makeContext('GET', '/realtime', {}, 'ws');
    expect(() => interceptor.intercept(ctx, nextOf({})).subscribe()).not.toThrow();
    res.end('{}');
    expect(metrics.recordRequest).not.toHaveBeenCalled();
  });

  it('never breaks the response when the metrics sink throws', () => {
    metrics.recordRequest.mockImplementation(() => {
      throw new Error('metrics exploded');
    });
    const { ctx, res } = makeContext('GET', '/api/v1/screens');
    interceptor.intercept(ctx, nextOf({})).subscribe();
    expect(() => res.end('{}')).not.toThrow();
  });
});
