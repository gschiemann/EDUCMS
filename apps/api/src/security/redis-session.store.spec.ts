import { EventEmitter } from 'events';
import { Logger } from '@nestjs/common';
import {
  DEFAULT_SESSION_TTL_MS,
  SESSION_KEY_PREFIX,
  SessionRedisClient,
  createRedisSessionStore,
  sessionTtlMs,
} from './redis-session.store';

/**
 * Redis session store (efficiency/scale audit 2026-09-02).
 *
 * The store replaces express-session's process-local MemoryStore, which
 * cannot survive a redeploy or be shared between replicas. Two live OAuth
 * handshakes read the session mid-flight (SSO OIDC state/nonce, the Clever
 * nonce mirror), so what matters here is: values round-trip, the TTL follows
 * the rolling cookie, and NO Redis failure is ever surfaced as a request
 * error — a blip must degrade to "no session", never to a 500.
 */

/** Stand-in for express-session's `Store` base (an EventEmitter subclass). */
class FakeStoreBase extends EventEmitter {}

interface StoreSurface {
  get(sid: string, cb: (err?: unknown, session?: unknown) => void): void;
  set(sid: string, session: unknown, cb: (err?: unknown) => void): void;
  touch(sid: string, session: unknown, cb: (err?: unknown) => void): void;
  destroy(sid: string, cb: (err?: unknown) => void): void;
}

class FakeRedis implements SessionRedisClient {
  status = 'ready';
  fail = false;
  readonly data = new Map<string, string>();
  readonly ttls = new Map<string, number>();

  async get(key: string): Promise<string | null> {
    if (this.fail) throw new Error('redis down');
    return this.data.get(key) ?? null;
  }
  async set(key: string, value: string, _mode: 'PX', ttl: number): Promise<unknown> {
    if (this.fail) throw new Error('redis down');
    this.data.set(key, value);
    this.ttls.set(key, ttl);
    return 'OK';
  }
  async pexpire(key: string, ttl: number): Promise<unknown> {
    if (this.fail) throw new Error('redis down');
    this.ttls.set(key, ttl);
    return 1;
  }
  async del(key: string): Promise<unknown> {
    if (this.fail) throw new Error('redis down');
    this.data.delete(key);
    return 1;
  }
}

const silentLogger = (): Logger => {
  const logger = new Logger('spec');
  jest.spyOn(logger, 'warn').mockImplementation(() => undefined);
  jest.spyOn(logger, 'debug').mockImplementation(() => undefined);
  return logger;
};

function build(redis: FakeRedis | null): StoreSurface {
  return createRedisSessionStore(
    FakeStoreBase,
    () => redis,
    silentLogger(),
  ) as unknown as StoreSurface;
}

const get = (store: StoreSurface, sid: string) =>
  new Promise<unknown>((resolve, reject) =>
    store.get(sid, (err, session) => (err ? reject(err) : resolve(session ?? null))),
  );
const set = (store: StoreSurface, sid: string, session: unknown) =>
  new Promise<unknown>((resolve, reject) =>
    store.set(sid, session, (err) => (err ? reject(err) : resolve(undefined))),
  );

afterEach(() => jest.restoreAllMocks());

describe('sessionTtlMs', () => {
  it('mirrors the cookie maxAge so rolling sessions slide together', () => {
    expect(sessionTtlMs({ cookie: { maxAge: 1234 } })).toBe(1234);
    expect(sessionTtlMs({ cookie: { originalMaxAge: 4321 } })).toBe(4321);
  });

  it('falls back to the 8h default main.ts sets', () => {
    expect(sessionTtlMs({})).toBe(DEFAULT_SESSION_TTL_MS);
    expect(sessionTtlMs(null)).toBe(DEFAULT_SESSION_TTL_MS);
    expect(sessionTtlMs({ cookie: { maxAge: -1 } })).toBe(DEFAULT_SESSION_TTL_MS);
  });
});

describe('RedisSessionStore', () => {
  it('round-trips a session — the OIDC state survives a replica hop', async () => {
    const redis = new FakeRedis();
    const store = build(redis);

    await set(store, 'sid-1', {
      cookie: { maxAge: 60_000 },
      ssoOidcState: 'st',
      ssoOidcNonce: 'no',
    });

    expect(redis.data.has(`${SESSION_KEY_PREFIX}sid-1`)).toBe(true);
    expect(redis.ttls.get(`${SESSION_KEY_PREFIX}sid-1`)).toBe(60_000);
    // A DIFFERENT store instance = the other replica reading the same Redis.
    await expect(get(build(redis), 'sid-1')).resolves.toMatchObject({
      ssoOidcState: 'st',
      ssoOidcNonce: 'no',
    });
  });

  it('returns null for an unknown sid', async () => {
    await expect(get(build(new FakeRedis()), 'nope')).resolves.toBeNull();
  });

  it('touch slides the TTL (rolling: true) without rewriting the payload', async () => {
    const redis = new FakeRedis();
    const store = build(redis);
    await set(store, 'sid-2', { cookie: { maxAge: 1_000 }, a: 1 });

    await new Promise<void>((resolve) =>
      store.touch('sid-2', { cookie: { maxAge: 9_000 } }, () => resolve()),
    );

    expect(redis.ttls.get(`${SESSION_KEY_PREFIX}sid-2`)).toBe(9_000);
    await expect(get(store, 'sid-2')).resolves.toMatchObject({ a: 1 });
  });

  it('destroy removes the session', async () => {
    const redis = new FakeRedis();
    const store = build(redis);
    await set(store, 'sid-3', { cookie: { maxAge: 1_000 } });

    await new Promise<void>((resolve) => store.destroy('sid-3', () => resolve()));

    await expect(get(store, 'sid-3')).resolves.toBeNull();
  });

  it('NEVER surfaces a Redis error — a blip must not 500 the request', async () => {
    const redis = new FakeRedis();
    redis.fail = true;
    const store = build(redis);

    // express-session calls next(err) on a store error, which would take the
    // whole dashboard down for the length of a Redis hiccup.
    await expect(get(store, 'sid-4')).resolves.toBeNull();
    await expect(set(store, 'sid-4', { cookie: { maxAge: 1_000 } })).resolves.toBeUndefined();
    await new Promise<void>((resolve) =>
      store.destroy('sid-4', (err) => {
        expect(err ?? null).toBeNull();
        resolve();
      }),
    );
  });

  it('treats a not-ready client as no session rather than an error', async () => {
    const redis = new FakeRedis();
    redis.status = 'connecting';
    await expect(get(build(redis), 'sid-5')).resolves.toBeNull();
  });

  it('treats a corrupt payload as absent instead of throwing', async () => {
    const redis = new FakeRedis();
    redis.data.set(`${SESSION_KEY_PREFIX}sid-6`, '{not json');
    await expect(get(build(redis), 'sid-6')).resolves.toBeNull();
  });

  it('drops an unserialisable session instead of failing the request', async () => {
    const redis = new FakeRedis();
    const store = build(redis);
    const cyclic: Record<string, unknown> = { cookie: { maxAge: 1_000 } };
    cyclic.self = cyclic;

    await expect(set(store, 'sid-7', cyclic)).resolves.toBeUndefined();
    expect(redis.data.size).toBe(0);
  });
});
