/**
 * renderTrust — render-proof trust derivation unit tests (2026-08-24).
 *
 * Pins the fresh/stale/unknown/offline matrix for the Screens-list
 * render-trust line: a screen must NEVER read as "painting" off a fresh
 * ping alone, a stale-but-reachable screen must ALWAYS surface as the
 * money state ('not-painting'), an unreported verdict must NEVER read as
 * an alarm, and an unreachable screen must defer entirely to its existing
 * offline treatment (no double-alarm).
 */
import { deriveRenderTrust, RENDER_STALE_AFTER_MS } from '../renderTrust';

const ONLINE = { status: 'ONLINE' };

describe('deriveRenderTrust — precomputed renderHealth path', () => {
  it('ONLINE + renderHealth OK → painting', () => {
    expect(
      deriveRenderTrust({ ...ONLINE, renderHealth: 'OK', renderStale: false }),
    ).toBe('painting');
  });

  it('THE MONEY STATE: ONLINE + renderHealth STALE → not-painting', () => {
    // The exact frozen-kiosk case: device answers the heartbeat (ONLINE)
    // but the renderer has wedged. renderStale === true is load-bearing.
    expect(
      deriveRenderTrust({ ...ONLINE, renderHealth: 'STALE', renderStale: true }),
    ).toBe('not-painting');
  });

  it('renderHealth STALE alone (no renderStale bool) still → not-painting', () => {
    expect(deriveRenderTrust({ ...ONLINE, renderHealth: 'STALE' })).toBe('not-painting');
  });

  it('renderStale === true wins even if renderHealth is missing/other', () => {
    expect(deriveRenderTrust({ ...ONLINE, renderStale: true })).toBe('not-painting');
    expect(
      deriveRenderTrust({ ...ONLINE, renderHealth: 'OK', renderStale: true }),
    ).toBe('not-painting');
  });

  it('ONLINE + renderHealth UNKNOWN → unknown (never an alarm)', () => {
    expect(
      deriveRenderTrust({ ...ONLINE, renderHealth: 'UNKNOWN', renderStale: false }),
    ).toBe('unknown');
  });

  it('a fresh ping (ONLINE) ALONE never produces "painting"', () => {
    // The whole point: ONLINE without a positive OK render-proof must not
    // read as the proof-backed green state.
    const inputs = [
      { ...ONLINE },
      { ...ONLINE, renderHealth: 'UNKNOWN' as const },
      { ...ONLINE, renderHealth: null },
    ];
    for (const input of inputs) {
      expect(deriveRenderTrust(input)).not.toBe('painting');
    }
  });
});

describe('deriveRenderTrust — offline gate (no double-alarm)', () => {
  it('OFFLINE wins regardless of render-proof', () => {
    expect(
      deriveRenderTrust({ status: 'OFFLINE', renderHealth: 'OK', renderStale: false }),
    ).toBe('offline');
    // Even a stale-render verdict on an unreachable box reads as offline,
    // not not-painting — render-proof only speaks for reachable screens.
    expect(
      deriveRenderTrust({ status: 'OFFLINE', renderHealth: 'STALE', renderStale: true }),
    ).toBe('offline');
  });

  it('PENDING / REVOKED (not ONLINE) → offline bucket', () => {
    expect(deriveRenderTrust({ status: 'PENDING' })).toBe('offline');
    expect(deriveRenderTrust({ status: 'REVOKED', renderHealth: 'OK' })).toBe('offline');
  });

  it('missing/undefined status → offline (fail closed, never a stray alarm)', () => {
    expect(deriveRenderTrust({ renderHealth: 'STALE', renderStale: true })).toBe('offline');
    expect(deriveRenderTrust({})).toBe('offline');
  });
});

describe('deriveRenderTrust — fallback path (renderHealth absent entirely)', () => {
  it('ONLINE + no renderHealth + lastRenderedAtMs fresh → painting', () => {
    const now = 1_000_000;
    expect(
      deriveRenderTrust({ ...ONLINE, lastRenderedAtMs: now - 10_000, nowMs: now }),
    ).toBe('painting');
  });

  it('ONLINE + no renderHealth + lastRenderedAtMs stale (>= window) → not-painting', () => {
    const now = 1_000_000;
    expect(
      deriveRenderTrust({
        ...ONLINE,
        lastRenderedAtMs: now - RENDER_STALE_AFTER_MS,
        nowMs: now,
      }),
    ).toBe('not-painting');
    expect(
      deriveRenderTrust({
        ...ONLINE,
        lastRenderedAtMs: now - (RENDER_STALE_AFTER_MS + 1),
        nowMs: now,
      }),
    ).toBe('not-painting');
  });

  it('ONLINE + no renderHealth + lastRenderedAtMs just under the window → painting', () => {
    const now = 1_000_000;
    expect(
      deriveRenderTrust({
        ...ONLINE,
        lastRenderedAtMs: now - (RENDER_STALE_AFTER_MS - 1),
        nowMs: now,
      }),
    ).toBe('painting');
  });

  it('ONLINE + no renderHealth + no lastRenderedAtMs → unknown (never a false alarm)', () => {
    expect(deriveRenderTrust({ ...ONLINE })).toBe('unknown');
    expect(deriveRenderTrust({ ...ONLINE, lastRenderedAtMs: null })).toBe('unknown');
  });
});
