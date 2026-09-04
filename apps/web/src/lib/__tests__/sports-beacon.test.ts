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
