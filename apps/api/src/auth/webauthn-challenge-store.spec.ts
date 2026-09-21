/**
 * The single-use challenge store. BOTH backends are exercised through the one
 * interface, with the same table of assertions, because the memory fallback
 * is what a Redis-less deploy actually runs — an untested fallback is a
 * fallback that silently accepts replays.
 *
 * The Redis double is a faithful in-memory model of `SET … PX` + `GETDEL`,
 * not a jest.fn() that returns whatever the test wants: the property under
 * test IS the atomicity of read-and-delete, and a stub that just returns a
 * value cannot demonstrate it.
 */

import {
  MemoryWebAuthnChallengeStore,
  RedisWebAuthnChallengeStore,
  challengeKey,
  resolveChallengeStore,
  WEBAUTHN_CHALLENGE_TTL_MS,
  __resetChallengeStoreWarningForTests,
  type WebAuthnChallengeRecord,
  type WebAuthnChallengeRedis,
  type WebAuthnChallengeStore,
} from './webauthn-challenge-store';

/** A minimal but HONEST ioredis model: real TTLs, real atomic GETDEL. */
class FakeRedis implements WebAuthnChallengeRedis {
  status = 'ready';
  readonly store = new Map<string, { value: string; expiresAt: number }>();
  now = Date.now();
  setCalls = 0;

  async set(
    key: string,
    value: string,
    _mode: 'PX',
    ttlMs: number,
  ): Promise<unknown> {
    this.setCalls += 1;
    this.store.set(key, { value, expiresAt: this.now + ttlMs });
    return 'OK';
  }

  async getdel(key: string): Promise<string | null> {
    const hit = this.store.get(key);
    // Atomic: the value leaves the store in the same step it is read.
    this.store.delete(key);
    if (!hit || hit.expiresAt <= this.now) return null;
    return hit.value;
  }
}

function record(
  overrides: Partial<WebAuthnChallengeRecord> = {},
): WebAuthnChallengeRecord {
  return {
    challenge: 'Y2hhbGxlbmdlLWJ5dGVz',
    rpID: 'app.venueos.example',
    origin: 'https://app.venueos.example',
    userId: 'user-1',
    issuedAt: 1_700_000_000_000,
    ...overrides,
  };
}

describe('challengeKey — purpose and subject binding', () => {
  it('a purpose change or a subject change is a DIFFERENT key', () => {
    // This is the whole of "bound to purpose + subject": a registration
    // challenge cannot be spent at the login endpoint, and one user's
    // challenge cannot be spent by another, because neither can address it.
    expect(challengeKey('reg', 'u1')).not.toBe(challengeKey('mfa', 'u1'));
    expect(challengeKey('mfa', 'u1')).not.toBe(challengeKey('mfa', 'u2'));
    expect(challengeKey('login', 'c1')).not.toBe(challengeKey('reg', 'c1'));
  });

  it('is namespaced so it cannot collide with another feature key', () => {
    expect(challengeKey('reg', 'u1')).toMatch(/^vos:webauthn:reg:u1$/);
  });
});

/**
 * One table of behaviours, run against both implementations. Anything that
 * holds for Redis must hold for memory, or a Redis-less deploy is weaker
 * than the one we tested.
 */
describe.each([
  [
    'memory',
    () => ({
      store: new MemoryWebAuthnChallengeStore() as WebAuthnChallengeStore,
      redis: null as FakeRedis | null,
    }),
  ],
  [
    'redis',
    () => {
      const redis = new FakeRedis();
      return {
        store: new RedisWebAuthnChallengeStore(redis) as WebAuthnChallengeStore,
        redis,
      };
    },
  ],
])('%s backend', (_name, make) => {
  let store: WebAuthnChallengeStore;
  let redis: FakeRedis | null;

  beforeEach(() => {
    const made = make();
    store = made.store;
    redis = made.redis;
  });

  it('round-trips a record with the relying party pinned to it', async () => {
    const rec = record();
    await store.put(challengeKey('reg', 'user-1'), rec);
    // rpID + origin come back EXACTLY as stored — verify uses these, not a
    // fresh resolution, so a ceremony cannot start on one origin and finish
    // on another.
    expect(await store.take(challengeKey('reg', 'user-1'))).toEqual(rec);
  });

  it('IS SINGLE-USE — a second take of the same key returns null', async () => {
    await store.put(challengeKey('login', 'c1'), record({ userId: null }));
    expect(await store.take(challengeKey('login', 'c1'))).not.toBeNull();
    // The replay hole: if this returned the record again, a captured
    // assertion could be presented twice.
    expect(await store.take(challengeKey('login', 'c1'))).toBeNull();
  });

  it('spends the record even when the verification that follows would fail', async () => {
    // `take` destroys unconditionally. A challenge left in place on a failed
    // verify would give an attacker unlimited attempts against one nonce.
    await store.put(challengeKey('mfa', 'user-1'), record());
    await store.take(challengeKey('mfa', 'user-1'));
    expect(await store.take(challengeKey('mfa', 'user-1'))).toBeNull();
  });

  it('two concurrent takes — exactly ONE gets the record', async () => {
    await store.put(challengeKey('login', 'race'), record({ userId: null }));
    const [a, b] = await Promise.all([
      store.take(challengeKey('login', 'race')),
      store.take(challengeKey('login', 'race')),
    ]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
  });

  it('returns null for a key that was never written', async () => {
    expect(await store.take(challengeKey('reg', 'nobody'))).toBeNull();
  });

  it('a later put REPLACES the earlier record — last ceremony wins', async () => {
    await store.put(
      challengeKey('reg', 'user-1'),
      record({ challenge: 'first' }),
    );
    await store.put(
      challengeKey('reg', 'user-1'),
      record({ challenge: 'second' }),
    );
    expect((await store.take(challengeKey('reg', 'user-1')))?.challenge).toBe(
      'second',
    );
    // And the superseded one is gone, not merely shadowed.
    expect(await store.take(challengeKey('reg', 'user-1'))).toBeNull();
  });

  it('EXPIRES — a record past its TTL is not returned', async () => {
    const key = challengeKey('reg', 'user-1');
    await store.put(key, record(), WEBAUTHN_CHALLENGE_TTL_MS);
    if (redis) {
      redis.now += WEBAUTHN_CHALLENGE_TTL_MS + 1;
    } else {
      jest
        .spyOn(Date, 'now')
        .mockReturnValue(Date.now() + WEBAUTHN_CHALLENGE_TTL_MS + 1);
    }
    try {
      expect(await store.take(key)).toBeNull();
    } finally {
      jest.restoreAllMocks();
    }
  });

  it('honours a short explicit TTL', async () => {
    const key = challengeKey('mfa', 'user-1');
    await store.put(key, record(), 2_000);
    if (redis) {
      redis.now += 2_500;
    } else {
      jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 2_500);
    }
    try {
      expect(await store.take(key)).toBeNull();
    } finally {
      jest.restoreAllMocks();
    }
  });
});

describe('RedisWebAuthnChallengeStore — failure behaviour', () => {
  it('a GETDEL error FAILS CLOSED (null), never a fall-through to memory', async () => {
    const redis: WebAuthnChallengeRedis = {
      status: 'ready',
      set: async () => 'OK',
      getdel: async () => {
        throw new Error('connection reset');
      },
    };
    // Redis may or may not have consumed the challenge; we cannot tell. The
    // only safe answer is "no" — the user retries. Falling back to a memory
    // copy would be a second, independently spendable record.
    expect(
      await new RedisWebAuthnChallengeStore(redis).take(
        challengeKey('login', 'x'),
      ),
    ).toBeNull();
  });

  it('refuses a stored value that is not a well-formed record', async () => {
    const redis = new FakeRedis();
    const store = new RedisWebAuthnChallengeStore(redis);
    for (const junk of ['not json', '{}', '{"challenge":"c"}', 'null', '[]']) {
      redis.store.set('k', { value: junk, expiresAt: redis.now + 60_000 });
      expect(await store.take('k')).toBeNull();
    }
  });

  it('writes with a PX millisecond TTL', async () => {
    const redis = new FakeRedis();
    const spy = jest.spyOn(redis, 'set');
    await new RedisWebAuthnChallengeStore(redis).put('k', record(), 1234);
    expect(spy).toHaveBeenCalledWith('k', expect.any(String), 'PX', 1234);
  });
});

describe('resolveChallengeStore — backend selection', () => {
  beforeEach(() => __resetChallengeStoreWarningForTests());

  it('uses Redis when the client is ready', () => {
    expect(resolveChallengeStore(new FakeRedis())).toBeInstanceOf(
      RedisWebAuthnChallengeStore,
    );
  });

  it('falls back to memory when there is no Redis on this deploy', () => {
    // CLAUDE.md: Redis is optional and the API must keep working without it.
    // A Redis-only store would make passkeys silently unusable.
    expect(resolveChallengeStore(null)).toBeInstanceOf(
      MemoryWebAuthnChallengeStore,
    );
    expect(resolveChallengeStore(undefined)).toBeInstanceOf(
      MemoryWebAuthnChallengeStore,
    );
  });

  it('falls back when the client exists but is not ready', () => {
    const connecting = new FakeRedis();
    connecting.status = 'connecting';
    expect(resolveChallengeStore(connecting)).toBeInstanceOf(
      MemoryWebAuthnChallengeStore,
    );
  });

  it('falls back when the client cannot do GETDEL (an old Redis/driver)', () => {
    // Without an atomic read-and-delete there is no single-use guarantee, so
    // the degraded-but-correct memory store is better than a get+del pair.
    const noGetdel = {
      status: 'ready',
      set: async () => 'OK',
    } as unknown as WebAuthnChallengeRedis;
    expect(resolveChallengeStore(noGetdel)).toBeInstanceOf(
      MemoryWebAuthnChallengeStore,
    );
  });

  it('the memory fallback is SHARED across calls, so put and take agree', async () => {
    // Two different requests resolve the store independently; if each got a
    // fresh map, no Redis-less ceremony could ever complete.
    await resolveChallengeStore(null).put(
      challengeKey('login', 'shared'),
      record({ userId: null }),
    );
    expect(
      await resolveChallengeStore(null).take(challengeKey('login', 'shared')),
    ).not.toBeNull();
  });
});

// ── A Redis server older than 6.2 has no GETDEL (2026-09-21) ─────────────
describe('RedisWebAuthnChallengeStore — server without GETDEL', () => {
  const RECORD = { challenge: 'c', rpID: 'venue.test', origin: 'https://venue.test', userId: 'u1', issuedAt: 1 };

  function oldServer() {
    const data = new Map<string, string>();
    const calls: string[] = [];
    const redis: any = {
      status: 'ready',
      set: async (k: string, v: string) => { data.set(k, v); return 'OK'; },
      getdel: async () => { calls.push('getdel'); throw new Error("ERR unknown command 'GETDEL', with args beginning with: "); },
      multi: () => {
        const queued: Array<() => unknown> = [];
        const tx: any = {
          get: (k: string) => { queued.push(() => data.get(k) ?? null); return tx; },
          del: (k: string) => { queued.push(() => (data.delete(k) ? 1 : 0)); return tx; },
          exec: async () => { calls.push('multi'); return queued.map((fn) => [null, fn()] as [null, unknown]); },
        };
        return tx;
      },
    };
    return { redis, calls, data };
  }

  it('falls back to an atomic MULTI GET+DEL and stays SINGLE-USE', async () => {
    const { redis, calls, data } = oldServer();
    const store = new RedisWebAuthnChallengeStore(redis);
    await store.put('k', RECORD);
    expect(await store.take('k')).toMatchObject({ challenge: 'c', rpID: 'venue.test' });
    expect(data.has('k')).toBe(false);
    expect(await store.take('k')).toBeNull(); // the replay
    expect(calls).toContain('multi');
  });

  it('any OTHER Redis error still fails closed — never a fallback, never a second copy', async () => {
    const { redis, calls } = oldServer();
    redis.getdel = async () => { calls.push('getdel'); throw new Error('ECONNRESET'); };
    const store = new RedisWebAuthnChallengeStore(redis);
    await store.put('k', RECORD);
    expect(await store.take('k')).toBeNull();
    expect(calls).not.toContain('multi');
  });
});
