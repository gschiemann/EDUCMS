import { ClientIpThrottlerGuard } from './client-ip-throttler.guard';

/**
 * Unit tests for the stable-tracker override (security P1, 2026-07-07).
 *
 * We can't easily construct a real ThrottlerGuard (needs options + storage +
 * reflector), and `getTracker` is a pure function of the request object, so we
 * exercise it against a prototype instance with the two private fields the
 * method reads stubbed. This proves the CONTRACT that matters: the same client
 * yields the SAME tracker even when Railway appends varying internal hops —
 * which is exactly what the shared Redis counter needs to accumulate.
 */
function makeGuard(): { getTracker: (req: any) => Promise<string> } {
  const g = Object.create(
    ClientIpThrottlerGuard.prototype,
  ) as ClientIpThrottlerGuard;
  // Silence + satisfy the one-shot diagnostic log.
  (g as any).ipLogger = { warn: () => undefined };
  (g as any).diagLogged = 999; // skip diag logging in tests
  return { getTracker: (req: any) => (g as any).getTracker(req) };
}

function req(xff: unknown, ip?: string, ips?: string[]) {
  return { headers: { 'x-forwarded-for': xff }, ip, ips };
}

describe('ClientIpThrottlerGuard.getTracker', () => {
  it('keys on the trusted-hop X-Forwarded-For entry, not a rotating hop', async () => {
    const { getTracker } = makeGuard();
    // Chain [client, edge] with one attacker-injected prefix entry. With the
    // default hop count of 2 the client sits at index len-2.
    const t = await getTracker(
      req('99.65.178.111, 10.0.0.1, 10.0.0.2', '10.0.0.1'),
    );
    expect(t).toBe('10.0.0.1');
  });

  // ACC-08 (2026-08-01): the throttle key must not be attacker-movable. The
  // previous leftmost-XFF rule let a client rotate it with a header, which
  // reinstated the very bug this guard exists to fix — the shared counter
  // never accumulated and the brute-force cap never fired.
  it('is UNSPOOFABLE: an injected X-Forwarded-For cannot rotate the key', async () => {
    const { getTracker } = makeGuard();
    const keys = new Set<string>();
    for (let i = 0; i < 50; i++) {
      // Attacker varies the prefix per request; honest chain is unchanged.
      keys.add(
        await getTracker(req(`203.0.113.${i}, 99.65.178.111, 10.0.4.7`, '10.0.4.7')),
      );
    }
    expect(keys.size).toBe(1); // one bucket → the cap can actually fire
    expect([...keys][0]).toBe('99.65.178.111');
  });

  it('is STABLE for the same client even when trailing internal hops rotate', async () => {
    const { getTracker } = makeGuard();
    // Same real client, different varying internal proxy hops each request —
    // the exact Railway condition that made req.ip (and thus the throttle key)
    // rotate. The tracker must NOT move.
    const a = await getTracker(req('99.65.178.111, 10.0.4.7', '10.0.4.7'));
    const b = await getTracker(req('99.65.178.111, 10.0.9.2', '10.0.9.2'));
    const c = await getTracker(req('99.65.178.111, 172.16.1.5', '172.16.1.5'));
    expect(a).toBe('99.65.178.111');
    expect(b).toBe('99.65.178.111');
    expect(c).toBe('99.65.178.111');
    expect(new Set([a, b, c]).size).toBe(1); // one bucket → counter accumulates
  });

  it('trims whitespace around the chosen entry', async () => {
    const { getTracker } = makeGuard();
    expect(await getTracker(req('  203.0.113.9 , 10.0.0.1'))).toBe('203.0.113.9');
  });

  it('concatenates repeated x-forwarded-for headers instead of reading only the first', async () => {
    // Reading array[0] would let an attacker send a SECOND header to shift the
    // chain and move the key. The full chain here is
    // [203.0.113.9, 10.0.0.1, 10.0.0.2] → index len-2.
    const { getTracker } = makeGuard();
    expect(
      await getTracker(req(['203.0.113.9, 10.0.0.1', '10.0.0.2'])),
    ).toBe('10.0.0.1');
  });

  it('falls back to req.ip when there is no XFF header', async () => {
    const { getTracker } = makeGuard();
    expect(await getTracker(req(undefined, '198.51.100.7'))).toBe(
      '198.51.100.7',
    );
  });

  it('never throws and returns "unknown" when nothing is resolvable', async () => {
    const { getTracker } = makeGuard();
    await expect(getTracker({} as any)).resolves.toBe('unknown');
    await expect(getTracker(req('', undefined))).resolves.toBe('unknown');
  });

  it('single-entry XFF equals req.ip (common case is unchanged)', async () => {
    const { getTracker } = makeGuard();
    // A normal client sends no XFF; Railway sets a single entry = the client IP.
    expect(await getTracker(req('99.65.178.111', '99.65.178.111'))).toBe(
      '99.65.178.111',
    );
  });
});
