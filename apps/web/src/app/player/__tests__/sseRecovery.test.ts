import { readFileSync } from 'fs';
import { join } from 'path';
import {
  SSE_FAILURES_BEFORE_HTTP_POLL,
  SSE_RETRY_BASE_MS,
  SSE_RETRY_MAX_MS,
  onSseError,
} from '../sseRecovery';

/**
 * 2026-11-14 — the push channel must survive the two ways it died in the field
 * on 2026-11-13 (see sseRecovery.ts and the connect() comment in page.tsx):
 *   1. a ticketed SSE stream's 15-minute rotation replayed an expired ticket,
 *      and the second error ended the SSE tier for the session (Houston Free
 *      Standing Kiosk: 14 h without a push channel);
 *   2. a gateway-mode screen dialled its WebSocket through the web origin,
 *      which cannot carry one (Houston Menu Board Left: 4.5 h, zero dials
 *      reaching the API).
 */

const lo = () => 0;
const hi = () => 1;

describe('onSseError — the policy', () => {
  it('always closes the EventSource, on the very first error', () => {
    expect(onSseError(1, lo).close).toBe(true);
    expect(onSseError(7, hi).close).toBe(true);
  });

  it('a routine rotation (one error) re-opens within seconds and does not arm the HTTP poll', () => {
    const d = onSseError(1, hi);
    expect(d.engageHttpPoll).toBe(false);
    expect(d.retryInMs).toBeLessThanOrEqual(SSE_RETRY_BASE_MS);
    expect(onSseError(1, lo).retryInMs).toBe(SSE_RETRY_BASE_MS / 2);
  });

  it('arms the HTTP poll floor from the second consecutive error — and still retries SSE', () => {
    const d = onSseError(SSE_FAILURES_BEFORE_HTTP_POLL, lo);
    expect(d.engageHttpPoll).toBe(true);
    expect(d.retryInMs).toBeGreaterThan(0);
    expect(Number.isFinite(d.retryInMs)).toBe(true);
  });

  it('backs off exponentially with jitter inside [ceiling/2, ceiling]', () => {
    for (let n = 1; n <= 8; n++) {
      const ceiling = Math.min(SSE_RETRY_MAX_MS, SSE_RETRY_BASE_MS * 2 ** (n - 1));
      expect(onSseError(n, lo).retryInMs).toBe(Math.round(ceiling / 2));
      expect(onSseError(n, hi).retryInMs).toBe(ceiling);
    }
  });

  it('never waits longer than the ceiling, however long the streak', () => {
    for (const n of [9, 20, 1_000, Number.MAX_SAFE_INTEGER]) {
      const d = onSseError(n, hi);
      expect(d.retryInMs).toBe(SSE_RETRY_MAX_MS);
      expect(d.engageHttpPoll).toBe(true);
    }
  });

  it('treats a nonsense counter as a first error rather than throwing or stalling', () => {
    for (const n of [0, -3, Number.NaN, Number.POSITIVE_INFINITY]) {
      const d = onSseError(n, lo);
      expect(d.close).toBe(true);
      expect(d.retryInMs).toBe(SSE_RETRY_BASE_MS / 2);
      expect(d.engageHttpPoll).toBe(false);
    }
  });

  it('clamps a misbehaving random source', () => {
    expect(onSseError(1, () => -5).retryInMs).toBe(SSE_RETRY_BASE_MS / 2);
    expect(onSseError(1, () => 9).retryInMs).toBe(SSE_RETRY_BASE_MS);
  });
});

describe('player/page.tsx — the wiring (source-text guards)', () => {
  const src = readFileSync(join(__dirname, '..', 'page.tsx'), 'utf8');

  /** The body of `name(...)` up to its closing brace at column 0. */
  const fnBody = (signature: string) => {
    const start = src.indexOf(signature);
    expect(start).toBeGreaterThan(-1);
    const end = src.indexOf('\n}\n', start);
    expect(end).toBeGreaterThan(start);
    return src.slice(start, end);
  };

  it('the WebSocket is dialled on the DIRECT origin, never through getApiRoot (the gateway cannot carry it)', () => {
    const dial = src.match(/const wsUrl = ([^\n]+)/);
    expect(dial).not.toBeNull();
    expect(dial![1]).toMatch(/^getDirectApiRoot\(\)\.replace\(\/\^http\/, 'ws'\) \+ '\/realtime';$/);
    expect(src).not.toMatch(/getApiRoot\(\)\.replace\(\/\^http\/, ?'ws'\)/);
  });

  it('getDirectApiRoot never consults the gateway mode', () => {
    const fn = fnBody('function getDirectApiRoot()');
    expect(fn).toContain('resolveApiRoot(');
    expect(fn).not.toContain('apiOriginState(');
    expect(fn).not.toContain('gatewayApiRoot(');
  });

  it('es.onerror closes the EventSource unconditionally and re-opens through tryOpenSse with a fresh ticket', () => {
    const start = src.indexOf('es.onerror = () => {');
    expect(start).toBeGreaterThan(-1);
    const end = src.indexOf('\n      };\n', start);
    expect(end).toBeGreaterThan(start);
    const handler = src.slice(start, end);

    expect(handler).toContain('onSseError(sseFailCountRef.current)');
    const close = handler.indexOf('es.close()');
    expect(close).toBeGreaterThan(-1);
    // The close must not sit behind a failure-count condition again — that
    // let the browser replay an expired ticket, which WAS the second error.
    expect(handler.slice(0, close)).not.toMatch(/if \(sseFailCountRef\.current\s*>=/);
    expect(handler).toContain('void tryOpenSse()');
    expect(handler.indexOf('void tryOpenSse()')).toBeGreaterThan(close);
  });

  it('every teardown of the realtime effect cancels a pending SSE re-open', () => {
    const clears = src.match(/if \(sseRetryRef\.current\) \{ clearTimeout\(sseRetryRef\.current\); sseRetryRef\.current = null; \}/g) ?? [];
    // AUTH_OK (the WS owns realtime again) and the effect cleanup.
    expect(clears.length).toBeGreaterThanOrEqual(2);
  });
});
