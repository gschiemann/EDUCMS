import { Logger } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';
import { ALL_PRESETS, ensureSystemPresets } from './ensure-system-presets';

/**
 * The boot seed's cross-replica advisory lock (2026-09-22).
 *
 * Every production boot logged `prisma:error … Failed to deserialize column of
 * type 'void'`. The seed took its lock with `$queryRaw\`SELECT
 * pg_advisory_lock(424242)\``; `pg_advisory_lock` returns void, Prisma threw
 * AFTER the statement ran, so the lock was held while the code believed it was
 * not, the unlock was skipped, and the lock stayed on a pooled connection. A
 * second replica booting alongside would have waited on it indefinitely.
 *
 * These specs run the REAL ensureSystemPresets against a fake Prisma client
 * that models the three behaviours the bug lived in. Each was reproduced on
 * Postgres 16 + Prisma 5.22 before it was written down here:
 *
 *   1. `$queryRaw` of a void-returning function runs the statement and THEN
 *      throws P2010 "Failed to deserialize column of type 'void'" — whatever
 *      the statement did (take a lock) stays done. `$executeRaw` returns a row
 *      count and never deserializes a column.
 *   2. The pool promises nothing about which connection a top-level query lands
 *      on. The fake is the pessimistic pool — every top-level query gets a new
 *      connection — so session state (a session lock, a session SET) never
 *      carries from one top-level query to the next, and a transaction-scoped
 *      lock taken outside a transaction is gone when its own statement ends.
 *      (Measured: five concurrent `pg_advisory_unlock` calls on one client, one
 *      landed on the holder, four returned false.)
 *   3. An interactive `$transaction` pins ONE connection; a transaction lock
 *      taken on it is released at COMMIT or ROLLBACK. A lock held elsewhere is
 *      waited on for `lock_timeout` and then fails 55P03; without a
 *      `lock_timeout` the wait never ends.
 */

// The key the old session lock used. Keeping it is deliberate: session and
// transaction advisory locks on one key exclude each other, so during the
// rolling deploy that ships the fix, new code still waits for old code.
const SEED_LOCK_KEY = '424242';
// A second replica that is already seeding (or old code still holding the lock).
const OTHER_REPLICA = 'replica-A';
// The production seed's measured run time (2026-09-22 deploy log: "All 459
// system presets present." 18:52:46 → "Pinned 4 …" 18:55:19).
const PRODUCTION_SEED_MS = 152_000;

type Holder = { conn: string; scope: 'session' | 'xact' };
type TxState = { lockTimeoutMs?: number };
type Kind = 'execute' | 'query';
type TxOptions = { maxWait?: number; timeout?: number };
type RawFn = (
  strings: TemplateStringsArray | string,
  ...values: unknown[]
) => Promise<unknown>;
type ModelDelegate = Record<string, (args?: unknown) => Promise<unknown>>;
type FakeClient = {
  $executeRaw: RawFn;
  $queryRaw: RawFn;
  $executeRawUnsafe: RawFn;
  $queryRawUnsafe: RawFn;
  $transaction: (fn: unknown, opts?: TxOptions) => Promise<unknown>;
  template: ModelDelegate;
  templateZone: ModelDelegate;
};

function prismaError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

function sqlOf(
  strings: TemplateStringsArray | string,
  values: unknown[],
): string {
  if (typeof strings === 'string') return strings;
  return strings.reduce(
    (sql, part, i) => sql + part + (i < values.length ? String(values[i]) : ''),
    '',
  );
}

function toMs(amount: string, unit: string | undefined): number {
  const n = Number(amount);
  if (unit === 'min') return n * 60_000;
  if (unit === 's') return n * 1_000;
  return n; // ms is lock_timeout's default unit
}

class FakePostgres {
  private readonly holders = new Map<string, Holder>();
  private connSeq = 0;

  /** Every model query the reconcile made, and whether the seed lock was held then. */
  readonly seedQueries: Array<{
    model: string;
    op: string;
    args: unknown;
    lockHeld: boolean;
  }> = [];
  /** `$transaction` options, in call order. */
  readonly txOptions: TxOptions[] = [];
  /** lock_timeout values set LOCALLY on a transaction, in ms. */
  readonly localLockTimeoutsMs: number[] = [];
  /** Session-level settings — they outlive the query and ride the pooled connection. */
  readonly leakedSessionSettings: string[] = [];
  unboundedWaits = 0;
  xactLocksOutsideTransaction = 0;

  // Behaviour switches.
  failTransactionStart = false;
  expireTransactionBeforeCommit = false;
  failSeedRead = false;

  newConn(prefix: string): string {
    this.connSeq += 1;
    return `${prefix}-${this.connSeq}`;
  }

  holdElsewhere(key: string): void {
    this.holders.set(key, { conn: OTHER_REPLICA, scope: 'session' });
  }

  holderOf(key: string): Holder | undefined {
    return this.holders.get(key);
  }

  seedLockHeld(): boolean {
    const h = this.holders.get(SEED_LOCK_KEY);
    return !!h && h.conn !== OTHER_REPLICA;
  }

  /** COMMIT or ROLLBACK on `conn`: its transaction-scoped locks go; session locks stay. */
  endTransaction(conn: string): void {
    for (const [key, h] of [...this.holders]) {
      if (h.conn === conn && h.scope === 'xact') this.holders.delete(key);
    }
  }

  private tryAcquire(
    key: string,
    conn: string,
    scope: Holder['scope'],
    tx?: TxState,
  ): boolean {
    const h = this.holders.get(key);
    if (h && h.conn !== conn) return false;
    if (scope === 'xact' && !tx) {
      // Autocommit: the statement's own transaction ends with the statement.
      this.xactLocksOutsideTransaction += 1;
      return true;
    }
    if (!h) this.holders.set(key, { conn, scope });
    else if (scope === 'session') h.scope = 'session'; // a session hold outlives the xact one
    return true;
  }

  raw(sql: string, conn: string, kind: Kind, tx?: TxState): unknown {
    const rows = (row: Record<string, unknown>) =>
      kind === 'execute' ? 1 : [row];

    const local =
      sql.match(
        /set_config\(\s*'lock_timeout'\s*,\s*'?\s*(\d+)\s*(ms|s|min)?\s*'?\s*,\s*true\s*\)/i,
      ) ??
      sql.match(
        /SET\s+LOCAL\s+lock_timeout\s*(?:=|TO)\s*'?\s*(\d+)\s*(ms|s|min)?\s*'?/i,
      );
    if (local) {
      // SET LOCAL outside a transaction block does nothing in Postgres.
      if (tx) {
        tx.lockTimeoutMs = toMs(local[1], local[2]);
        this.localLockTimeoutsMs.push(tx.lockTimeoutMs);
      }
      return rows({ set_config: local[0] });
    }
    if (
      /set_config\(\s*'lock_timeout'[^)]*,\s*false\s*\)|\bSET\s+(SESSION\s+)?lock_timeout/i.test(
        sql,
      )
    ) {
      this.leakedSessionSettings.push(sql);
      return rows({ set_config: sql });
    }

    const unlock = sql.match(/pg_advisory_unlock\(\s*(\d+)\s*\)/);
    if (unlock) {
      const h = this.holders.get(unlock[1]);
      const released = !!h && h.conn === conn && h.scope === 'session';
      if (released) this.holders.delete(unlock[1]);
      return rows({ pg_advisory_unlock: released });
    }

    const tryLock = sql.match(/pg_try_advisory_(xact_)?lock\(\s*(\d+)\s*\)/);
    if (tryLock) {
      const locked = this.tryAcquire(
        tryLock[2],
        conn,
        tryLock[1] ? 'xact' : 'session',
        tx,
      );
      return rows({ locked });
    }

    const lock = sql.match(/pg_advisory_(xact_)?lock\(\s*(\d+)\s*\)/);
    if (lock) {
      if (!this.tryAcquire(lock[2], conn, lock[1] ? 'xact' : 'session', tx)) {
        if (tx?.lockTimeoutMs !== undefined) {
          throw prismaError(
            'P2010',
            'Invalid `prisma.$executeRaw()` invocation:\n\n\nRaw query failed. Code: `55P03`. ' +
              'Message: `ERROR: canceling statement due to lock timeout`',
          );
        }
        this.unboundedWaits += 1;
        throw new Error(
          'FAKE: this lock call would wait forever — no lock_timeout was set',
        );
      }
      if (kind === 'query' && !/::/.test(sql)) {
        // The statement ran (the lock is held); THEN the void column failed.
        throw prismaError(
          'P2010',
          "Invalid `prisma.$queryRaw()` invocation:\n\n\nRaw query failed. Code: `N/A`. Message: `Failed to deserialize column of type 'void'. If you're using $queryRaw and this column is explicitly marked as `Unsupported` in your Prisma schema, try casting this column to any supported Prisma type such as `String`.`",
        );
      }
      return rows({});
    }

    throw new Error(`FAKE: unmodelled SQL: ${sql}`);
  }

  model(model: string): ModelDelegate {
    const call = (op: string, args: unknown): Promise<unknown> => {
      this.seedQueries.push({ model, op, args, lockHeld: this.seedLockHeld() });
      if (this.failSeedRead && model === 'template' && op === 'findMany') {
        return Promise.reject(
          new Error('Connection reset by peer (simulated blip)'),
        );
      }
      if (op === 'findMany') return Promise.resolve([]);
      if (op === 'findUnique' || op === 'findFirst')
        return Promise.resolve(null);
      if (op === 'updateMany' || op === 'deleteMany')
        return Promise.resolve({ count: 0 });
      return Promise.resolve({});
    };
    return new Proxy({} as ModelDelegate, {
      get: (_target, op) => (args?: unknown) => call(String(op), args),
    });
  }

  client(): FakeClient {
    // A promise, like Prisma's: a fake error thrown by raw() becomes a rejection.
    const rawOn =
      (conn: () => string, kind: Kind, tx?: TxState): RawFn =>
      (strings, ...values) =>
        new Promise((resolve) =>
          resolve(this.raw(sqlOf(strings, values), conn(), kind, tx)),
        );

    return {
      $executeRaw: rawOn(() => this.newConn('pool'), 'execute'),
      $queryRaw: rawOn(() => this.newConn('pool'), 'query'),
      $executeRawUnsafe: rawOn(() => this.newConn('pool'), 'execute'),
      $queryRawUnsafe: rawOn(() => this.newConn('pool'), 'query'),
      $transaction: async (fn, opts) => {
        if (typeof fn !== 'function')
          throw new Error('FAKE: only interactive transactions are modelled');
        this.txOptions.push(opts ?? {});
        if (this.failTransactionStart) {
          throw prismaError(
            'P2028',
            'Transaction API error: Unable to start a transaction in the given time.',
          );
        }
        const conn = this.newConn('tx');
        const state: TxState = {};
        const tx = {
          $executeRaw: rawOn(() => conn, 'execute', state),
          $queryRaw: rawOn(() => conn, 'query', state),
          $executeRawUnsafe: rawOn(() => conn, 'execute', state),
          $queryRawUnsafe: rawOn(() => conn, 'query', state),
          template: this.model('template'),
          templateZone: this.model('templateZone'),
        };
        try {
          const out = await (fn as (t: typeof tx) => Promise<unknown>)(tx);
          if (this.expireTransactionBeforeCommit) {
            throw prismaError(
              'P2028',
              'Transaction API error: Transaction already closed: A commit cannot be executed on an expired transaction.',
            );
          }
          this.endTransaction(conn); // COMMIT
          return out;
        } catch (e) {
          this.endTransaction(conn); // ROLLBACK (Prisma also rolls back an expired one)
          throw e;
        }
      },
      template: this.model('template'),
      templateZone: this.model('templateZone'),
    };
  }

  prismaService(): PrismaService {
    return { client: this.client() } as unknown as PrismaService;
  }
}

/** How many times the reconcile started: its first query is the existing-id read. */
function seedRuns(pg: FakePostgres): number {
  return pg.seedQueries.filter(
    (q) =>
      q.model === 'template' &&
      q.op === 'findMany' &&
      JSON.stringify((q.args as { where?: unknown } | undefined)?.where) ===
        JSON.stringify({ isSystem: true }),
  ).length;
}

describe('ensureSystemPresets — cross-replica advisory lock', () => {
  let warn: jest.SpyInstance;

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('reproduces the production bug: a void lock through $queryRaw throws, yet the lock is held, and an unlock on the pool misses it', async () => {
    // Self-test of the fake against the exact statements the seed used to run.
    const pg = new FakePostgres();
    const client = pg.client();

    await expect(
      client.$queryRaw`SELECT pg_advisory_lock(424242)`,
    ).rejects.toThrow("Failed to deserialize column of type 'void'");
    // Held anyway — by a SESSION on a pooled connection.
    expect(pg.holderOf(SEED_LOCK_KEY)?.scope).toBe('session');
    expect(pg.holderOf(SEED_LOCK_KEY)?.conn).toMatch(/^pool-/);

    await expect(
      client.$queryRaw`SELECT pg_advisory_unlock(424242)`,
    ).resolves.toEqual([{ pg_advisory_unlock: false }]);
    expect(pg.holderOf(SEED_LOCK_KEY)).toBeDefined(); // still held: leaked
  });

  it('takes the lock without throwing, holds it for the whole reconcile, and leaves nothing held afterwards', async () => {
    const pg = new FakePostgres();

    await ensureSystemPresets(pg.prismaService());

    expect(warn).not.toHaveBeenCalled(); // no P2010, no fallback, no failed pass
    expect(seedRuns(pg)).toBe(1);
    // The reconcile really ran (459 creates on the empty fake DB, and more) …
    expect(pg.seedQueries.filter((q) => q.op === 'create')).toHaveLength(
      ALL_PRESETS.length,
    );
    // … and every one of its queries ran while this replica held the lock.
    expect(pg.seedQueries.filter((q) => !q.lockHeld)).toEqual([]);
    // Released on the connection that took it — nothing left on the pool.
    expect(pg.holderOf(SEED_LOCK_KEY)).toBeUndefined();
    expect(pg.xactLocksOutsideTransaction).toBe(0);
    expect(pg.leakedSessionSettings).toEqual([]);
    expect(pg.unboundedWaits).toBe(0);
  });

  it("sizes the lock-holding transaction for the real seed, not Prisma's 5-second default", async () => {
    const pg = new FakePostgres();

    await ensureSystemPresets(pg.prismaService());

    const [opts] = pg.txOptions;
    const [waitMs] = pg.localLockTimeoutsMs;
    // The wait for another replica is bounded, and covers at least one seed.
    expect(waitMs).toBeGreaterThanOrEqual(PRODUCTION_SEED_MS);
    // The holder outlives a full wait PLUS a full production seed; past its
    // timeout Prisma rolls it back and the lock would drop mid-seed.
    expect(opts.timeout).toBeGreaterThan(waitMs + PRODUCTION_SEED_MS);
    // Boot is the pool's busiest moment — more than Prisma's 2 s default.
    expect(opts.maxWait).toBeGreaterThan(2_000);
  });

  it('releases the lock even when the reconcile fails, and does not run it twice', async () => {
    const pg = new FakePostgres();
    pg.failSeedRead = true;

    await expect(
      ensureSystemPresets(pg.prismaService()),
    ).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('System preset seed failed (continuing anyway)'),
    );
    expect(seedRuns(pg)).toBe(1);
    expect(pg.holderOf(SEED_LOCK_KEY)).toBeUndefined();
  });

  it('waits a BOUNDED time for a replica that is already seeding, then seeds anyway', async () => {
    // Another replica (or old code during the rolling deploy) holds the key.
    // Before the fix this call waited forever on one of the pool's connections.
    const pg = new FakePostgres();
    pg.holdElsewhere(SEED_LOCK_KEY);

    await expect(
      ensureSystemPresets(pg.prismaService()),
    ).resolves.toBeUndefined();

    expect(pg.unboundedWaits).toBe(0);
    // Every pass is idempotent and P2002 is handled: the booting (newest) code
    // still gets its pass rather than skipping on a lock it could not have.
    expect(seedRuns(pg)).toBe(1);
    expect(warn).toHaveBeenCalledWith(
      expect.stringMatching(/lock not taken.*55P03.*seeding without it/),
    );
    // The other replica's lock is untouched, and this one left nothing of its own.
    expect(pg.holderOf(SEED_LOCK_KEY)).toEqual({
      conn: OTHER_REPLICA,
      scope: 'session',
    });
    expect(pg.leakedSessionSettings).toEqual([]);
  });

  it('seeds without the lock when no connection is free to hold it (boot-time pool pressure)', async () => {
    const pg = new FakePostgres();
    pg.failTransactionStart = true;

    await expect(
      ensureSystemPresets(pg.prismaService()),
    ).resolves.toBeUndefined();

    expect(seedRuns(pg)).toBe(1);
    expect(warn).toHaveBeenCalledWith(
      expect.stringMatching(/lock not taken.*P2028.*seeding without it/),
    );
    expect(pg.holderOf(SEED_LOCK_KEY)).toBeUndefined();
  });

  it('does not seed a second time when only the release was irregular (holder outlived its timeout)', async () => {
    const pg = new FakePostgres();
    pg.expireTransactionBeforeCommit = true;

    await expect(
      ensureSystemPresets(pg.prismaService()),
    ).resolves.toBeUndefined();

    expect(seedRuns(pg)).toBe(1);
    expect(pg.seedQueries.filter((q) => !q.lockHeld)).toEqual([]);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('its lock was released early'),
    );
    expect(pg.holderOf(SEED_LOCK_KEY)).toBeUndefined();
  });
});
