import { LEASE, LeaderLeaseService, leadThisTick } from './leader-lease.service';
import { RedisService } from './redis.service';

/**
 * Leader-lease proof (efficiency/scale audit 2026-09-02, finding L3).
 *
 * The three facts a reviewer must be able to check without a second Railway
 * replica in front of them:
 *
 *   1. TWO REPLICAS → ONE TICK. Two LeaderLeaseService instances against the
 *      same Redis, and exactly one of them does the work.
 *   2. THE LEADER DIES → THE OTHER TAKES OVER, with a HIGHER fencing token,
 *      and a mid-flight tick from the dead leader can tell it is stale.
 *   3. REDIS DOWN → BOTH RUN. Binding rule 1: the lease never degrades to
 *      "do nothing", because that would silently stop every background
 *      worker on the single-replica deploys that have no Redis at all.
 *
 * Backed by an in-memory Redis stand-in that implements the commands the
 * lease's Lua uses (GET / SET+PX / PEXPIRE / INCR / DEL) with real TTL
 * expiry against a controllable clock, so ownership and expiry are exercised
 * rather than mocked away.
 */

let nowMs = 1_700_000_000_000;
const advance = (ms: number) => {
  nowMs += ms;
};

/** In-memory Redis with millisecond TTLs, keyed off the mocked clock. */
class FakeRedis {
  status = 'ready';
  /** Rejects every eval when true — the "Redis is erroring" case. */
  failing = false;
  private store = new Map<string, { value: string; expiresAt: number | null }>();

  private live(key: string): { value: string; expiresAt: number | null } | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    return entry;
  }

  /**
   * Interprets the three lease scripts by shape. Each branch mirrors the Lua
   * line for line; what is under test is the DISTRIBUTED behaviour, not a
   * Lua interpreter.
   */
  async eval(script: string, numKeys: number, ...args: Array<string | number>): Promise<unknown> {
    if (this.failing) throw new Error('redis down');
    const keys = args.slice(0, numKeys).map(String);
    const argv = args.slice(numKeys).map(String);
    const owner = argv[0];
    const ttl = Number(argv[1]);
    const current = this.live(keys[0]);
    const heldBy = current ? current.value.split('|')[0] : null;

    if (script.includes("redis.call('INCR'")) {
      // acquire-or-renew
      if (current) {
        if (heldBy !== owner) return '';
        current.expiresAt = Date.now() + ttl;
        return current.value;
      }
      const fenceKey = keys[1];
      const fence = Number(this.store.get(fenceKey)?.value ?? '0') + 1;
      this.store.set(fenceKey, { value: String(fence), expiresAt: null });
      const value = `${owner}|${fence}`;
      this.store.set(keys[0], { value, expiresAt: Date.now() + ttl });
      return value;
    }
    if (script.includes("redis.call('DEL'")) {
      if (current && heldBy === owner) {
        this.store.delete(keys[0]);
        return 1;
      }
      return 0;
    }
    // renew-only
    if (current && heldBy === owner) {
      current.expiresAt = Date.now() + ttl;
      return 1;
    }
    return 0;
  }
}

const NAME = 'spec:worker';
const created: LeaderLeaseService[] = [];

function serviceOn(fake: FakeRedis | null): LeaderLeaseService {
  const service = new LeaderLeaseService({ publisher: fake } as unknown as RedisService);
  created.push(service);
  return service;
}

beforeEach(() => {
  nowMs = 1_700_000_000_000;
  jest.spyOn(Date, 'now').mockImplementation(() => nowMs);
});

afterEach(async () => {
  // Stops each service's heartbeat interval as well as releasing its leases.
  for (const service of created.splice(0)) await service.onModuleDestroy();
  jest.restoreAllMocks();
});

describe('LeaderLeaseService', () => {
  it('gives the lease to exactly ONE of two replicas', async () => {
    const redis = new FakeRedis();
    const a = serviceOn(redis);
    const b = serviceOn(redis);

    const first = await a.tryAcquire(NAME);
    const second = await b.tryAcquire(NAME);

    expect(first).toMatchObject({ leader: true, degraded: false });
    expect(second).toMatchObject({ leader: false, degraded: false });
  });

  it('runs the tick body ONCE across two replicas', async () => {
    const redis = new FakeRedis();
    const a = serviceOn(redis);
    const b = serviceOn(redis);
    let ticks = 0;

    await a.runExclusive(NAME, async () => {
      ticks += 1;
    });
    await b.runExclusive(NAME, async () => {
      ticks += 1;
    });

    expect(ticks).toBe(1);
  });

  it('holds the SAME fence across repeated ticks (leadership is sticky)', async () => {
    const redis = new FakeRedis();
    const a = serviceOn(redis);

    const first = await a.tryAcquire(NAME, { ttlMs: 10_000 });
    advance(4_000); // past the round-trip damper (ttl/3), inside the TTL
    const second = await a.tryAcquire(NAME, { ttlMs: 10_000 });

    expect(second.leader).toBe(true);
    expect(second.fence).toBe(first.fence);
  });

  it('hands over to the standby when the leader dies, with a HIGHER fence', async () => {
    const redis = new FakeRedis();
    const a = serviceOn(redis);
    const b = serviceOn(redis);

    const leader = await a.tryAcquire(NAME, { ttlMs: 10_000 });
    expect(leader.leader).toBe(true);
    expect((await b.tryAcquire(NAME, { ttlMs: 10_000 })).leader).toBe(false);

    // "a" dies hard: no release, no heartbeat. Only the TTL frees the lease.
    (a as unknown as { destroyed: boolean }).destroyed = true;
    advance(11_000);

    const promoted = await b.tryAcquire(NAME, { ttlMs: 10_000 });
    expect(promoted.leader).toBe(true);
    // Strictly increasing across an ownership change, so a write from the old
    // leader's term is recognisable as stale.
    expect(promoted.fence).toBeGreaterThan(leader.fence);
  });

  it('releases on shutdown so a rolling deploy fails over without waiting a TTL', async () => {
    const redis = new FakeRedis();
    const a = serviceOn(redis);
    const b = serviceOn(redis);

    await a.tryAcquire(NAME, { ttlMs: 600_000 });
    await a.onModuleDestroy();
    // Enough to clear b's stand-down cache (ttl/3 of ITS request), nowhere
    // near the 10-minute lease TTL — the handover comes from the release.
    advance(1_000);

    const promoted = await b.tryAcquire(NAME, { ttlMs: 3_000 });
    expect(promoted.leader).toBe(true);
    expect(a.heldNames()).toEqual([]);
  });

  it('ASSUMES leadership on every replica when Redis is absent', async () => {
    const a = serviceOn(null);
    const b = serviceOn(null);

    // Binding rule 1: a deploy with no Redis (local dev, Railway without the
    // plugin) must keep running every worker, not silently stop them.
    expect(await a.tryAcquire(NAME)).toMatchObject({ leader: true, degraded: true, fence: 0 });
    expect(await b.tryAcquire(NAME)).toMatchObject({ leader: true, degraded: true, fence: 0 });
  });

  it('ASSUMES leadership when Redis is reachable but erroring', async () => {
    const redis = new FakeRedis();
    redis.failing = true;
    const a = serviceOn(redis);

    expect(await a.tryAcquire(NAME)).toMatchObject({ leader: true, degraded: true });
  });

  it('says so in the log when it degrades — once per window, not per tick', async () => {
    const a = serviceOn(null);
    const warn = jest
      .spyOn((a as unknown as { logger: { warn: (m: string) => void } }).logger, 'warn')
      .mockImplementation(() => undefined);

    await a.tryAcquire(NAME);
    await a.tryAcquire(NAME);
    await a.tryAcquire(NAME);

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('DEGRADED');
  });

  it('fences: holdsFence goes false once the term is over', async () => {
    const redis = new FakeRedis();
    const a = serviceOn(redis);
    const b = serviceOn(redis);

    const term = await a.tryAcquire(NAME, { ttlMs: 10_000 });
    expect(a.holdsFence(NAME, term.fence)).toBe(true);

    await a.onModuleDestroy();
    advance(1_000);
    await b.tryAcquire(NAME, { ttlMs: 10_000 });

    // A tick that was mid-flight when the lease moved can see that its term
    // ended and bail before writing.
    expect(a.holdsFence(NAME, term.fence)).toBe(false);
  });

  it('holdsFence stays true in degraded mode (there is no cluster to fence)', async () => {
    const a = serviceOn(null);
    const status = await a.tryAcquire(NAME);
    expect(a.holdsFence(NAME, status.fence)).toBe(true);
  });

  it('runExclusive skips the body entirely for a follower', async () => {
    const redis = new FakeRedis();
    const a = serviceOn(redis);
    const b = serviceOn(redis);
    await a.tryAcquire(NAME);

    const ran = jest.fn();
    const result = await b.runExclusive(NAME, async () => {
      ran();
      return 'worked';
    });

    expect(ran).not.toHaveBeenCalled();
    expect(result).toBeUndefined();
  });

  it('damps repeated ticks to one Redis round trip per heartbeat window', async () => {
    const redis = new FakeRedis();
    const evalSpy = jest.spyOn(redis, 'eval');
    const a = serviceOn(redis);

    // A 1 Hz worker (sports clock advance) must not cost one Redis call per
    // second per replica; the local record is authoritative inside the
    // window the heartbeat covers.
    await a.tryAcquire(NAME, { ttlMs: 30_000 });
    for (let i = 0; i < 9; i++) {
      advance(1_000);
      expect((await a.tryAcquire(NAME, { ttlMs: 30_000 })).leader).toBe(true);
    }

    expect(evalSpy).toHaveBeenCalledTimes(1);
  });

  it('registers every lease name exactly once', () => {
    const names = Object.values(LEASE);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('module wiring', () => {
  /**
   * Every leased worker injects the service as `@Optional()`, so a missing
   * provider does not throw — it silently produces an unleased worker that
   * double-fires on a second replica. RealtimeModule is @Global, so exporting
   * it there is what makes it reachable from billing / pos / notifications /
   * sports / analytics without each of them importing anything. Pin both
   * halves rather than trusting a comment.
   */
  it('RealtimeModule provides AND exports LeaderLeaseService', () => {
    // Required lazily: importing the module at file scope drags in the WS
    // gateway and its secrets, which this spec has no business booting.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { RealtimeModule } = require('./realtime.module') as { RealtimeModule: object };
    const providers = Reflect.getMetadata('providers', RealtimeModule) as unknown[];
    const exported = Reflect.getMetadata('exports', RealtimeModule) as unknown[];

    expect(providers).toContain(LeaderLeaseService);
    expect(exported).toContain(LeaderLeaseService);
    expect(Reflect.getMetadata('__module:global__', RealtimeModule)).toBe(true);
  });
});

describe('leadThisTick', () => {
  it('treats a missing lease service as a DEGRADED leader, never a skip', async () => {
    expect(await leadThisTick(undefined, LEASE.POS_SYNC)).toMatchObject({
      leader: true,
      degraded: true,
    });
  });

  it('delegates to the service when one is wired', async () => {
    const a = serviceOn(new FakeRedis());
    const status = await leadThisTick(a, LEASE.POS_SYNC);
    expect(status).toMatchObject({ leader: true, degraded: false });
    expect(status.fence).toBeGreaterThan(0);
  });
});
