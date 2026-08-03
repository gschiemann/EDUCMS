import { readFileSync } from 'fs';
import { join } from 'path';
import {
  PUSH_EVENT_ID_MAX,
  PUSH_FRESHNESS_WINDOW_MS,
  SENSITIVE_PUSH_TYPES,
  checkSensitivePush,
  isTenantChangeForThisScreen,
} from '../pushGate';

/**
 * R-04 — the SSE fallback used to enforce NONE of the WS path's client-side
 * gates. An on-path attacker can force screens onto SSE by killing the WS
 * upgrade three times, then replay a captured ALL_CLEAR_MESSAGE to keep a real
 * SOS / broadcast suppressed. Both transports now call ONE shared gate and
 * share ONE dedup LRU.
 *
 * R-05 — TENANT_CHANGED de-provisioned any screen that received it, without
 * ever reading the screenId the server signs into the payload.
 */

const NOW = 1_800_000_000_000;
const ctx = (seen = new Map<string, number>(), offset = 0) => ({
  seenEventIds: seen,
  serverClockOffsetMs: offset,
  now: () => NOW,
});

const signed = (over: Record<string, unknown> = {}) => ({
  type: 'ALL_CLEAR_MESSAGE',
  eventId: 'evt-1',
  timestamp: NOW,
  signature: 'deadbeef',
  payload: {},
  ...over,
});

describe('checkSensitivePush — signature presence', () => {
  it('accepts a properly signed, fresh, unseen sensitive frame', () => {
    expect(checkSensitivePush(signed(), ctx())).toEqual({ accepted: true });
  });

  it('DROPS an SSE frame missing `signature`', () => {
    const frame = signed();
    delete (frame as Record<string, unknown>).signature;
    expect(checkSensitivePush(frame, ctx(), 'ALL_CLEAR_MESSAGE'))
      .toEqual({ accepted: false, reason: 'unsigned' });
  });

  it('DROPS an empty or non-string signature', () => {
    expect(checkSensitivePush(signed({ signature: '' }), ctx()).accepted).toBe(false);
    expect(checkSensitivePush(signed({ signature: 123 }), ctx()).accepted).toBe(false);
    expect(checkSensitivePush(signed({ signature: true }), ctx()).accepted).toBe(false);
  });

  it('gates EVERY life-safety type, on both the envelope type and the SSE event name', () => {
    for (const type of SENSITIVE_PUSH_TYPES) {
      const frame = signed({ type });
      delete (frame as Record<string, unknown>).signature;
      expect(checkSensitivePush(frame, ctx()).accepted).toBe(false);
      // An attacker mislabelling the envelope can't dodge the gate: the SSE
      // `event:` name is checked too.
      const disguised = signed({ type: 'SYNC' });
      delete (disguised as Record<string, unknown>).signature;
      expect(checkSensitivePush(disguised, ctx(), type).accepted).toBe(false);
    }
  });

  it('leaves non-sensitive types alone (SYNC/ALL_CLEAR only trigger a manifest re-fetch)', () => {
    expect(checkSensitivePush({ type: 'SYNC' }, ctx())).toEqual({ accepted: true });
    expect(checkSensitivePush({ type: 'ALL_CLEAR' }, ctx())).toEqual({ accepted: true });
    expect(checkSensitivePush({ type: 'REFRESH_WEB' }, ctx())).toEqual({ accepted: true });
    expect(checkSensitivePush({ type: 'GAME_STATE' }, ctx())).toEqual({ accepted: true });
  });
});

describe('checkSensitivePush — freshness', () => {
  it('DROPS a stale-timestamp SSE frame', () => {
    expect(checkSensitivePush(signed({ timestamp: NOW - 60_000 }), ctx(), 'ALL_CLEAR_MESSAGE'))
      .toEqual({ accepted: false, reason: 'stale' });
  });

  it('DROPS a far-future timestamp', () => {
    expect(checkSensitivePush(signed({ timestamp: NOW + 60_000 }), ctx()).accepted).toBe(false);
  });

  it('DROPS a missing / non-numeric timestamp', () => {
    const frame = signed();
    delete (frame as Record<string, unknown>).timestamp;
    expect(checkSensitivePush(frame, ctx()).accepted).toBe(false);
    expect(checkSensitivePush(signed({ timestamp: 'now' }), ctx()).accepted).toBe(false);
    expect(checkSensitivePush(signed({ timestamp: NaN }), ctx()).accepted).toBe(false);
  });

  it('accepts right at the window edge', () => {
    expect(checkSensitivePush(
      signed({ timestamp: NOW - PUSH_FRESHNESS_WINDOW_MS }), ctx(),
    ).accepted).toBe(true);
  });

  it('honours the server-clock offset so a skewed kiosk still gets real alerts', () => {
    // Kiosk clock is 10 minutes behind the server (Android box with no NTP).
    const skew = 600_000;
    const fresh = signed({ timestamp: NOW + skew });
    expect(checkSensitivePush(fresh, ctx(new Map(), 0)).accepted).toBe(false);
    expect(checkSensitivePush(fresh, ctx(new Map(), skew)).accepted).toBe(true);
  });
});

describe('checkSensitivePush — replay, shared across transports', () => {
  it('DROPS a duplicate eventId', () => {
    const seen = new Map<string, number>();
    expect(checkSensitivePush(signed(), ctx(seen)).accepted).toBe(true);
    expect(checkSensitivePush(signed(), ctx(seen)))
      .toEqual({ accepted: false, reason: 'replay' });
  });

  it('THE ATTACK: a frame seen on WS and replayed on SSE is dropped (one shared LRU)', () => {
    const shared = new Map<string, number>();
    const captured = signed({ eventId: 'evt-allclear-42' });
    // 1. Legit delivery over WebSocket.
    expect(checkSensitivePush(captured, ctx(shared)).accepted).toBe(true);
    // 2. Attacker kills the WS upgrade 3× to force SSE, then replays the
    //    captured ALL_CLEAR_MESSAGE to suppress a live alert.
    expect(checkSensitivePush({ ...captured }, ctx(shared), 'ALL_CLEAR_MESSAGE'))
      .toEqual({ accepted: false, reason: 'replay' });
  });

  it('and in the other direction too (SSE first, then WS)', () => {
    const shared = new Map<string, number>();
    const frame = signed({ type: 'SOS', eventId: 'evt-sos-7' });
    expect(checkSensitivePush(frame, ctx(shared), 'SOS').accepted).toBe(true);
    expect(checkSensitivePush({ ...frame }, ctx(shared)).accepted).toBe(false);
  });

  it('distinct eventIds still pass', () => {
    const seen = new Map<string, number>();
    expect(checkSensitivePush(signed({ eventId: 'a' }), ctx(seen)).accepted).toBe(true);
    expect(checkSensitivePush(signed({ eventId: 'b' }), ctx(seen)).accepted).toBe(true);
  });

  it('bounds the LRU', () => {
    const seen = new Map<string, number>();
    for (let i = 0; i < PUSH_EVENT_ID_MAX + 50; i++) {
      checkSensitivePush(signed({ eventId: `e-${i}` }), ctx(seen));
    }
    expect(seen.size).toBeLessThanOrEqual(PUSH_EVENT_ID_MAX);
  });
});

describe('isTenantChangeForThisScreen (R-05)', () => {
  const SELF = 'screen-aaa';

  it('a TENANT_CHANGED for a DIFFERENT screenId is not for us', () => {
    expect(isTenantChangeForThisScreen({ payload: { screenId: 'screen-bbb' } }, SELF)).toBe(false);
  });

  it('a matching one IS for us', () => {
    expect(isTenantChangeForThisScreen({ payload: { screenId: SELF } }, SELF)).toBe(true);
  });

  it('fails CLOSED on a missing / malformed / absent-screenId payload (the old fleet-wipe frame)', () => {
    expect(isTenantChangeForThisScreen({ payload: {} }, SELF)).toBe(false);
    expect(isTenantChangeForThisScreen({}, SELF)).toBe(false);
    expect(isTenantChangeForThisScreen(null, SELF)).toBe(false);
    expect(isTenantChangeForThisScreen({ payload: 'screen-aaa' }, SELF)).toBe(false);
    expect(isTenantChangeForThisScreen({ payload: { screenId: 123 } }, SELF)).toBe(false);
    // Not yet registered → no id to compare → never tear down.
    expect(isTenantChangeForThisScreen({ payload: { screenId: SELF } }, null)).toBe(false);
  });
});

/**
 * Source-contract checks. `checkSensitivePush` being correct is worthless if a
 * future edit to the 9.6k-line player page stops calling it on one transport,
 * or drops the TENANT_CHANGED addressing check — exactly the regressions R-04
 * and R-05 describe. These assert the wiring in the real file.
 */
describe('player/page.tsx wiring', () => {
  const src = readFileSync(join(__dirname, '..', 'page.tsx'), 'utf8');

  it('BOTH transports run the shared gate', () => {
    const calls = src.match(/checkSensitivePush\(/g) || [];
    expect(calls.length).toBeGreaterThanOrEqual(2);
    expect(src).toMatch(/\[Player WS\] dropped \$\{/);
    expect(src).toMatch(/\[Player SSE\] dropped \$\{/);

    // Both transports must emit the LITERAL phrase "stale/future event" for a
    // freshness drop. emergency-path.spec.ts tests 3 and 4 count occurrences of
    // exactly that string to prove the P0-1 gate is neither over-firing on good
    // millisecond timestamps nor loosened to let seconds-precision ones through.
    // A refactor renamed it to "dropped stale sensitive event" on 2026-08-03 and
    // the guard went blind — the gate still worked, but nothing could observe
    // it. Assert the phrase here so a rename fails fast in unit tests instead of
    // silently disarming a life-safety regression guard in a slow E2E job.
    const stalePhrases = src.match(/'stale\/future event'/g) || [];
    expect(stalePhrases.length).toBeGreaterThanOrEqual(2);
    // The SSE `handle()` wrapper must gate before dispatching to the handler.
    expect(src).toMatch(/if \(!gateSse\(name, data\)\) return;/);
  });

  it('the SSE gate shares the WS replay LRU and clock offset', () => {
    const sseGate = src.slice(src.indexOf('const gateSse'), src.indexOf('const handle = (name'));
    expect(sseGate).toContain('recentEventIdsRef.current');
    expect(sseGate).toContain('serverClockOffsetRef.current');
  });

  it('an SSE-only kiosk still learns the server clock (else freshness would drop every alert)', () => {
    expect(src).toMatch(/es\.addEventListener\('AUTH_OK'/);
  });

  it('TENANT_CHANGED teardown is gated on this screen being the addressee', () => {
    const branch = src.slice(src.indexOf("if (msg.type === 'TENANT_CHANGED')"));
    const guard = branch.indexOf('isTenantChangeForThisScreen');
    const wipe = branch.indexOf("localStorage.removeItem('edu_device_token')");
    expect(guard).toBeGreaterThan(-1);
    expect(wipe).toBeGreaterThan(guard); // guard (and its early return) comes first
    expect(branch.slice(guard, wipe)).toContain('return;');
  });

  it('the API root is resolved through the validated guard, not raw localStorage', () => {
    const fn = src.slice(src.indexOf('function getApiRoot()'), src.indexOf('function getApiRoot()') + 1200);
    expect(fn).toContain('resolveApiRoot(');
    expect(fn).not.toMatch(/localStorage\.(getItem|setItem)\(\s*'edu_api_root'/);
  });
});
