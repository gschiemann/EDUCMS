/**
 * SEC-007 — client side of the proof-of-play beacon capability.
 *
 * The two properties that matter here are in tension, so both are pinned:
 *   1. When a capability CAN be obtained, every beacon carries it with a fresh
 *      sequence number (that pair is what the server claims once, in Redis).
 *   2. When it CANNOT — mint 404s, network is down, storage is sandboxed — the
 *      helper returns NO headers rather than throwing or blocking. The beacon
 *      still goes out and the server records it as unverified. Losing counts
 *      entirely would be worse than recording them honestly as unverified.
 */

import {
  beaconHeaders,
  beaconIsVerified,
  postBeacon,
  _resetSportsBeaconForTests,
} from '../sports-beacon';
import { DEVICE_TOKEN_STORAGE_KEY } from '@/app/player/trustGuards';

const GAME = 'game-1';

const CAPS = {
  verified: true,
  expiresAt: Date.now() + 30 * 60_000,
  maxSequence: 1200,
  impression: 'bc1.imp.mac',
  cue: 'bc1.cue.mac',
};

function mockFetchOnce(body: unknown, ok = true) {
  const fn = jest.fn().mockResolvedValue({
    ok,
    json: async () => body,
  });
  (globalThis as { fetch?: unknown }).fetch = fn;
  return fn;
}

beforeEach(() => {
  _resetSportsBeaconForTests();
  window.localStorage.clear();
});

afterEach(() => {
  delete (globalThis as { fetch?: unknown }).fetch;
});

describe('beaconHeaders', () => {
  it('attaches the scope-matched capability and an incrementing sequence', async () => {
    mockFetchOnce(CAPS);

    const a = await beaconHeaders(GAME, 'impression');
    const b = await beaconHeaders(GAME, 'impression');
    const c = await beaconHeaders(GAME, 'cue');

    expect(a['x-venueos-beacon']).toBe(CAPS.impression);
    expect(a['x-venueos-beacon-seq']).toBe('1');
    expect(b['x-venueos-beacon-seq']).toBe('2');
    // Same lease, but the CUE endpoint gets the cue-scoped capability — an
    // impression capability is refused there server-side.
    expect(c['x-venueos-beacon']).toBe(CAPS.cue);
    expect(c['x-venueos-beacon-seq']).toBe('3');
  });

  it('mints ONCE per game even under concurrent beacons (single-flight)', async () => {
    const fetchMock = mockFetchOnce(CAPS);

    const results = await Promise.all([
      beaconHeaders(GAME, 'impression'),
      beaconHeaders(GAME, 'impression'),
      beaconHeaders(GAME, 'impression'),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const seqs = results.map((r) => r['x-venueos-beacon-seq']).sort();
    expect(seqs).toEqual(['1', '2', '3']); // no two beacons share a sequence
  });

  it('sends the device token when this surface is a paired screen', async () => {
    window.localStorage.setItem(DEVICE_TOKEN_STORAGE_KEY, 'device-jwt-value');
    const fetchMock = mockFetchOnce(CAPS);

    await beaconHeaders(GAME, 'impression');

    const init = fetchMock.mock.calls[0][1] as { headers: Record<string, string> };
    expect(init.headers.Authorization).toBe('Bearer device-jwt-value');
    expect(beaconIsVerified(GAME)).toBe(true);
  });

  it('sends NO Authorization header when there is no device credential', async () => {
    const fetchMock = mockFetchOnce({ ...CAPS, verified: false });

    await beaconHeaders(GAME, 'impression');

    const init = fetchMock.mock.calls[0][1] as { headers: Record<string, string> };
    expect(init.headers.Authorization).toBeUndefined();
    expect(beaconIsVerified(GAME)).toBe(false);
  });

  it('returns NO headers when the mint fails — the beacon still goes, unverified', async () => {
    mockFetchOnce({}, false);
    expect(await beaconHeaders(GAME, 'impression')).toEqual({});
  });

  it('returns NO headers when the network throws', async () => {
    (globalThis as { fetch?: unknown }).fetch = jest.fn().mockRejectedValue(new Error('offline'));
    expect(await beaconHeaders(GAME, 'impression')).toEqual({});
  });

  it('returns NO headers for a missing gameId, without calling the API', async () => {
    const fetchMock = mockFetchOnce(CAPS);
    expect(await beaconHeaders('', 'impression')).toEqual({});
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('re-mints once the capability is inside its renewal margin', async () => {
    // Expires in 1 minute — already inside the 5-minute renewal margin, so the
    // very next beacon must go get a fresh one rather than ride it to expiry.
    const fetchMock = mockFetchOnce({ ...CAPS, expiresAt: Date.now() + 60_000 });
    await beaconHeaders(GAME, 'impression');
    await beaconHeaders(GAME, 'impression');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('re-mints when the sequence space is exhausted', async () => {
    const fetchMock = mockFetchOnce({ ...CAPS, maxSequence: 2 });
    await beaconHeaders(GAME, 'impression'); // seq 1
    await beaconHeaders(GAME, 'impression'); // seq 2 — space now full
    const third = await beaconHeaders(GAME, 'impression');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(third['x-venueos-beacon-seq']).toBe('1'); // fresh lease, fresh nonce
  });

  it('posts the mint to the root it was handed (gateway-routed devices)', async () => {
    const fetchMock = mockFetchOnce(CAPS);
    await beaconHeaders(GAME, 'cue', 'https://board.example.com');
    expect(fetchMock.mock.calls[0][0]).toBe(
      `https://board.example.com/api/v1/sports/board/${GAME}/beacon-capability`,
    );
  });

  it('does not double up /api/v1 when the root already carries it', async () => {
    const fetchMock = mockFetchOnce(CAPS);
    await beaconHeaders(GAME, 'cue', 'https://api.example.com/api/v1');
    expect(fetchMock.mock.calls[0][0]).toBe(
      `https://api.example.com/api/v1/sports/board/${GAME}/beacon-capability`,
    );
  });
});

/**
 * SEC-007 residual #1 (2026-09-05) — reacting to the server's verdict.
 *
 * The server-side re-audit added a LIVE screen re-check at beacon time, so a
 * screen revoked / unpaired / rotated mid-lease starts getting
 * `401 BEACON_SCREEN_REVOKED`. Nothing on this side read a beacon response, so
 * the client kept presenting the same dead capability for the rest of the
 * lease — and every one of those impressions was REFUSED, i.e. LOST rather
 * than downgraded, for up to ~25 minutes.
 *
 * The contract these tests pin:
 *   1. a 401 on a capability-carrying beacon DROPS the lease immediately;
 *   2. that beacon is re-posted ONCE with no capability, so the airing is
 *      recorded unverified rather than lost (do-no-harm: downgrade, never
 *      drop);
 *   3. subsequent beacons ride the unverified lane and do NOT re-mint per
 *      beacon (no retry storm);
 *   4. a strict deploy that refuses the anonymous lane too is learned once and
 *      not retried.
 */
describe('postBeacon — the server refused this capability', () => {
  const IMPRESSION_URL = 'https://api.example.com/api/v1/sports/sponsors/sp1/impression';
  const ROOT = 'https://api.example.com';

  /**
   * A fetch double that routes by URL: mint requests answer with `caps`,
   * beacon POSTs answer with whatever `beaconStatuses` says next (the last
   * value repeats).
   */
  interface RouterOpts {
    caps?: unknown;
    /** Read on EVERY mint, so a test can bring the endpoint back mid-case. */
    mintOk?: boolean;
    beaconStatuses: number[];
  }

  function router(opts: RouterOpts) {
    const calls: { url: string; init: RequestInit }[] = [];
    let i = 0;
    const fn = jest.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      if (url.includes('/beacon-capability')) {
        return {
          ok: opts.mintOk !== false,
          status: opts.mintOk === false ? 500 : 200,
          json: async () => opts.caps ?? CAPS,
        };
      }
      const status = opts.beaconStatuses[Math.min(i++, opts.beaconStatuses.length - 1)];
      return { ok: status < 400, status, json: async () => ({ code: 'BEACON_SCREEN_REVOKED' }) };
    });
    (globalThis as { fetch?: unknown }).fetch = fn;
    return { fn, calls, beacons: () => calls.filter((c) => !c.url.includes('/beacon-capability')) };
  }

  // The refusal path logs a named cause outside production. Silence it so a
  // green run reads clean; the behaviour under test is the requests, not the log.
  let warn: jest.SpyInstance;
  beforeEach(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => warn.mockRestore());

  const cap = (c: { init: RequestInit }) =>
    (c.init.headers as Record<string, string>)['x-venueos-beacon'];

  const post = (body: unknown = {}) =>
    postBeacon({ gameId: GAME, scope: 'impression', url: IMPRESSION_URL, body, apiRoot: ROOT });

  it('re-posts the SAME beacon with no capability so the airing is downgraded, not lost', async () => {
    const { beacons } = router({ beaconStatuses: [401, 200] });

    await post({ gameId: GAME, surfaceKind: 'board' });

    const sent = beacons();
    expect(sent).toHaveLength(2);
    // First attempt carried the capability; the retry deliberately does not.
    expect(cap(sent[0])).toBe(CAPS.impression);
    expect(cap(sent[1])).toBeUndefined();
    // Same body both times — the retry records the same airing, unverified.
    expect(sent[1].init.body).toBe(sent[0].init.body);
  });

  it('DROPS the lease, so the next beacon goes unverified instead of re-presenting it', async () => {
    const { beacons } = router({ beaconStatuses: [401, 200, 200] });

    await post();
    await post();

    const sent = beacons();
    expect(sent).toHaveLength(3); // refused + downgrade retry + the next beacon
    expect(cap(sent[2])).toBeUndefined();
    // …and nothing claims a verified screen any more.
    expect(beaconIsVerified(GAME)).toBe(false);
  });

  it('does NOT re-mint per beacon after a refusal — no retry storm', async () => {
    const { calls, beacons } = router({ beaconStatuses: [401, 200] });

    for (let n = 0; n < 8; n++) await post();

    const mints = calls.filter((c) => c.url.includes('/beacon-capability'));
    // Exactly one mint: the original. The refusal opens a cooldown, so the
    // seven beacons that follow ride the unverified lane without asking again.
    expect(mints).toHaveLength(1);
    expect(beacons()).toHaveLength(9); // 8 beacons + 1 downgrade retry
  });

  it('keeps SENDING after a refusal, and never makes more than one extra attempt', async () => {
    // Every beacon 401s, including the capability-free retry.
    const { beacons } = router({ beaconStatuses: [401] });

    await post();
    expect(beacons()).toHaveLength(2); // refused + one downgrade attempt

    await post();
    // The next beacon is still SENT (never suppressed) and gets no second
    // attempt of its own.
    expect(beacons()).toHaveLength(3);
  });

  /**
   * The two cases below pin the `anonymousRefused` LEARNING itself.
   *
   * Negative-checked 2026-09-08, and this is why they exist: deleting EITHER
   * `anonymousRefused.add(...)` call from `postBeacon` broke **nothing** in the
   * suite as it stood — including the case above, whose old title claimed the
   * refusal was "learned, not retried". Within a single cooldown window the
   * two writes are redundant with each other, so the learning is only
   * observable once the client holds a capability AGAIN. That needs fake
   * timers, which is presumably why it was skipped; without it the set was
   * dead weight that read as a tested control.
   */
  it('LEARNS from the refused downgrade, so a later refusal skips its retry', async () => {
    jest.useFakeTimers();
    try {
      const { beacons } = router({ beaconStatuses: [401] }); // strict deploy
      await post();
      expect(beacons()).toHaveLength(2); // refused + the downgrade attempt

      // Past the refusal cooldown, so the next beacon mints a fresh capability
      // and presents it — the only situation in which the learning is visible.
      jest.advanceTimersByTime(6 * 60_000);

      await post();
      // ONE request. Without the learning this pays for a second,
      // guaranteed-401 anonymous attempt on every refusal, forever.
      expect(beacons()).toHaveLength(3);
    } finally {
      jest.useRealTimers();
    }
  });

  it('LEARNS from an anonymous refusal too, even though no capability was carried', async () => {
    jest.useFakeTimers();
    try {
      const opts = { mintOk: false, beaconStatuses: [401] };
      const { beacons } = router(opts);

      // No capability to be had (the mint endpoint is down), so this beacon
      // goes anonymous — and a strict deploy refuses it. That refusal is the
      // one the OTHER branch of postBeacon has to remember.
      await post();
      expect(beacons()).toHaveLength(1);

      // The mint endpoint recovers and its (shorter) cooldown lapses.
      opts.mintOk = true;
      jest.advanceTimersByTime(2 * 60_000);

      await post();
      // The capability is presented and refused — but the anonymous lane is
      // already known dead, so there is no downgrade attempt to pay for.
      expect(beacons()).toHaveLength(2);
    } finally {
      jest.useRealTimers();
    }
  });

  it('leaves a SUCCESSFUL beacon alone — one request, lease intact', async () => {
    const { beacons } = router({ beaconStatuses: [200] });
    await post();
    expect(beacons()).toHaveLength(1);
    expect(beaconIsVerified(GAME)).toBe(true);
  });

  it('does not retry a 409 replay, a 429 or a 5xx — none of those is a dead credential', async () => {
    for (const status of [409, 429, 500, 503]) {
      _resetSportsBeaconForTests();
      const { beacons } = router({ beaconStatuses: [status] });
      await post();
      expect(beacons()).toHaveLength(1);
      // The lease survives: a 503 is the server saying "I could not grade
      // this", not "your credential is dead".
      expect(beaconIsVerified(GAME)).toBe(true);
    }
  });

  it('never throws when the network dies mid-beacon', async () => {
    (globalThis as { fetch?: unknown }).fetch = jest.fn().mockRejectedValue(new Error('offline'));
    await expect(post()).resolves.toBeUndefined();
  });

  it('drops an unserialisable body rather than throwing inside the board', async () => {
    const { fn } = router({ beaconStatuses: [200] });
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    await expect(post(cyclic)).resolves.toBeUndefined();
    expect(fn).not.toHaveBeenCalled();
  });
});

/**
 * A mint that FAILS also opens a (shorter) cooldown. Without it, a board
 * firing an impression every few seconds asks the mint endpoint again on every
 * single beacon for as long as the outage lasts.
 */
describe('mint backoff', () => {
  it('does not re-mint on every beacon while the mint endpoint is down', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({}) });
    (globalThis as { fetch?: unknown }).fetch = fetchMock;

    expect(await beaconHeaders(GAME, 'impression')).toEqual({});
    expect(await beaconHeaders(GAME, 'impression')).toEqual({});
    expect(await beaconHeaders(GAME, 'impression')).toEqual({});

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
